import { useCallback, useEffect, useRef, useState } from 'react'
import { emit, listen } from '@tauri-apps/api/event'
import { LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi'
import { Menu } from '@tauri-apps/api/menu'
import { currentMonitor, cursorPosition, getCurrentWindow } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { message } from '@tauri-apps/plugin-dialog'
import { register, unregisterAll, type ShortcutEvent } from '@tauri-apps/plugin-global-shortcut'
import { exit } from '@tauri-apps/plugin-process'
import { EVENT_ASK_REQUESTED, EVENT_BUBBLE_HIDE, EVENT_BUBBLE_SHOW, EVENT_SETTINGS_UPDATED, EVENT_STATE_CHANGED, type CompanionState } from '../shared/events'
import { imageUrl } from '../shared/images'
import { appendAssistantMessage } from '../shared/memory'
import { checkProactiveMoment } from '../shared/proactive'
import { captureScreen } from '../shared/screenshot'
import { loadSettings, type AppSettings } from '../shared/settings'

const MAX_SIDE = 240
const SCREEN_MARGIN = 16
const CHAT_GAP = 12
const CHAT_WIDTH = 360
const CHAT_HEIGHT = 240
const BUBBLE_WIDTH = 280
const BUBBLE_HEIGHT = 140
const ALPHA_THRESHOLD = 10
const HIT_TEST_INTERVAL_MS = 40

interface DisplaySize {
  w: number
  h: number
}

async function openSettingsWindow(): Promise<void> {
  const settingsWindow = await WebviewWindow.getByLabel('settings')
  await settingsWindow?.show()
  await settingsWindow?.setFocus()
}

async function positionNearCompanion(win: WebviewWindow, width: number, height: number): Promise<void> {
  const companion = getCurrentWindow()
  const [position, size, monitor, scale] = await Promise.all([
    companion.outerPosition(),
    companion.outerSize(),
    currentMonitor(),
    companion.scaleFactor(),
  ])
  const w = Math.round(width * scale)
  const h = Math.round(height * scale)
  const gap = Math.round(CHAT_GAP * scale)
  let x = position.x + Math.round(size.width / 2) - Math.round(w / 2)
  let y = position.y - h - gap
  if (monitor) {
    const area = monitor.workArea
    if (y < area.position.y) y = position.y + size.height + gap
    x = Math.min(Math.max(x, area.position.x), area.position.x + area.size.width - w)
    y = Math.min(Math.max(y, area.position.y), area.position.y + area.size.height - h)
  }
  await win.setPosition(new PhysicalPosition(x, y))
}

async function openChatWindow(): Promise<void> {
  const chat = await WebviewWindow.getByLabel('chat')
  if (!chat) return
  await positionNearCompanion(chat, CHAT_WIDTH, CHAT_HEIGHT)
  await emit(EVENT_BUBBLE_HIDE)
  await emit(EVENT_ASK_REQUESTED)
  await chat.show()
  await chat.setFocus()
}

async function openBubbleWindow(topic: string): Promise<void> {
  const bubble = await WebviewWindow.getByLabel('bubble')
  if (!bubble) return
  await positionNearCompanion(bubble, BUBBLE_WIDTH, BUBBLE_HEIGHT)
  await emit(EVENT_BUBBLE_SHOW, topic)
  await bubble.show()
}

export function Companion() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [state, setState] = useState<CompanionState>('idle')
  const [imageSrc, setImageSrc] = useState('')
  const [displaySize, setDisplaySize] = useState<DisplaySize | null>(null)

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const stateRef = useRef(state)
  stateRef.current = state
  const maskRef = useRef<ImageData | null>(null)
  const sizeRef = useRef<DisplaySize | null>(null)
  const positionedRef = useRef(false)

  useEffect(() => {
    getCurrentWindow()
      .setIgnoreCursorEvents(true)
      .catch((err) => console.error('setIgnoreCursorEvents:', err))
    loadSettings().then(setSettings, (err) => console.error('Failed to load settings:', err))
    const unlistenSettings = listen<AppSettings>(EVENT_SETTINGS_UPDATED, (event) => setSettings(event.payload))
    const unlistenState = listen<CompanionState>(EVENT_STATE_CHANGED, (event) => setState(event.payload))
    return () => {
      unlistenSettings.then((fn) => fn())
      unlistenState.then((fn) => fn())
    }
  }, [])

  const companionImage = settings?.images.companion ?? ''
  const thinkingImage = settings?.images.thinking ?? ''
  const speakingImage = settings?.images.speaking ?? ''
  const activeImage =
    (state === 'thinking' && thinkingImage) || (state === 'speaking' && speakingImage) || companionImage

  useEffect(() => {
    if (!activeImage) return
    let cancelled = false
    imageUrl(activeImage).then(
      (url) => {
        if (!cancelled) setImageSrc(url)
      },
      (err) => console.error('Failed to resolve image URL:', err),
    )
    return () => {
      cancelled = true
    }
  }, [activeImage])

  const hotkey = settings?.behavior.hotkey
  useEffect(() => {
    if (!hotkey) return
    ;(async () => {
      await unregisterAll()
      try {
        await register(hotkey, (event: ShortcutEvent) => {
          if (event.state === 'Pressed') {
            openChatWindow().catch((err) => console.error('Failed to open chat:', err))
          }
        })
      } catch (err) {
        console.error(`Failed to register hotkey "${hotkey}":`, err)
        await message(
          `Failed to register the global hotkey "${hotkey}" — it may already be in use by another application. Choose a different combination in the settings.`,
          { title: 'AI Companion', kind: 'error' },
        )
      }
    })().catch((err) => console.error('Error while registering the hotkey:', err))
  }, [hotkey])

  useEffect(() => {
    const win = getCurrentWindow()
    let busy = false
    let lastIgnore: boolean | null = null
    const id = window.setInterval(async () => {
      if (busy) return
      busy = true
      try {
        const mask = maskRef.current
        const size = sizeRef.current
        if (!mask || !size) return
        const [cursor, winPosition, scale] = await Promise.all([
          cursorPosition(),
          win.outerPosition(),
          win.scaleFactor(),
        ])
        const x = (cursor.x - winPosition.x) / scale
        const y = (cursor.y - winPosition.y) / scale
        let ignore = true
        if (x >= 0 && y >= 0 && x < size.w && y < size.h) {
          const px = Math.min(mask.width - 1, Math.floor((x * mask.width) / size.w))
          const py = Math.min(mask.height - 1, Math.floor((y * mask.height) / size.h))
          ignore = mask.data[(py * mask.width + px) * 4 + 3] < ALPHA_THRESHOLD
        }
        if (ignore !== lastIgnore) {
          lastIgnore = ignore
          await win.setIgnoreCursorEvents(ignore)
        }
      } catch (err) {
        console.error('Cursor hit-test error:', err)
      } finally {
        busy = false
      }
    }, HIT_TEST_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const enabled = settings?.proactive.enabled
    const minutes = settings?.proactive.intervalMinutes
    if (!enabled || !minutes) return
    let busy = false
    const id = window.setInterval(async () => {
      if (busy || stateRef.current === 'thinking') return
      busy = true
      try {
        const chat = await WebviewWindow.getByLabel('chat')
        const bubble = await WebviewWindow.getByLabel('bubble')
        if (!chat || !bubble) return
        if ((await chat.isVisible()) || (await bubble.isVisible())) return
        const cfg = settingsRef.current
        if (!cfg) return
        const dataUrl = await captureScreen()
        const topic = await checkProactiveMoment(cfg.llm, cfg.behavior.systemPrompt, dataUrl)
        if (!topic) return
        if ((await chat.isVisible()) || (await bubble.isVisible())) return
        await appendAssistantMessage(topic)
        await openBubbleWindow(topic)
      } catch (err) {
        console.error('Proactive check error:', err)
      } finally {
        busy = false
      }
    }, minutes * 60_000)
    return () => window.clearInterval(id)
  }, [settings?.proactive.enabled, settings?.proactive.intervalMinutes])

  const handleImageLoad = useCallback(async (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget
    try {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      maskRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height)
    } catch (err) {
      console.error('Failed to sample the alpha mask; the window stays fully interactive:', err)
      maskRef.current = null
      await getCurrentWindow().setIgnoreCursorEvents(false)
    }

    const ratio = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const size = {
      w: Math.max(1, Math.round(img.naturalWidth * ratio)),
      h: Math.max(1, Math.round(img.naturalHeight * ratio)),
    }
    sizeRef.current = size
    setDisplaySize(size)

    const win = getCurrentWindow()
    await win.setSize(new LogicalSize(size.w, size.h))
    if (!positionedRef.current) {
      positionedRef.current = true
      const monitor = await currentMonitor()
      if (monitor) {
        const area = monitor.workArea
        const margin = Math.round(SCREEN_MARGIN * monitor.scaleFactor)
        await win.setPosition(
          new PhysicalPosition(
            area.position.x + area.size.width - Math.round(size.w * monitor.scaleFactor) - margin,
            area.position.y + area.size.height - Math.round(size.h * monitor.scaleFactor) - margin,
          ),
        )
      }
      await win.show()
    }
  }, [])

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    if (event.button !== 0 || settingsRef.current?.behavior.lockPosition) return
    getCurrentWindow()
      .startDragging()
      .catch((err) => console.error('startDragging:', err))
  }, [])

  const handleContextMenu = useCallback(async (event: React.MouseEvent) => {
    event.preventDefault()
    try {
      const menu = await Menu.new({
        items: [
          { id: 'settings', text: 'Settings', action: () => void openSettingsWindow() },
          { id: 'exit', text: 'Exit', action: () => void exit(0) },
        ],
      })
      await menu.popup()
    } catch (err) {
      console.error('Failed to show the context menu:', err)
    }
  }, [])

  if (!imageSrc) return null

  return (
    <img
      className="block cursor-grab select-none active:cursor-grabbing"
      src={imageSrc}
      crossOrigin="anonymous"
      draggable={false}
      onLoad={(event) => void handleImageLoad(event)}
      onMouseDown={handleMouseDown}
      onContextMenu={(event) => void handleContextMenu(event)}
      style={displaySize ? { width: displaySize.w, height: displaySize.h } : undefined}
      alt=""
    />
  )
}
