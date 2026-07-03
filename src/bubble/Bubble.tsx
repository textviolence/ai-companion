import { useCallback, useEffect, useRef, useState } from 'react'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { EVENT_BUBBLE_HIDE, EVENT_BUBBLE_SHOW, EVENT_SETTINGS_UPDATED, EVENT_STATE_CHANGED } from '../shared/events'
import { DEFAULT_SETTINGS, loadSettings, type AppSettings } from '../shared/settings'
import { speak, stopSpeech } from '../shared/tts'

const AUTO_HIDE_MS = 20_000

export function Bubble() {
  const [topic, setTopic] = useState('')
  const [ttsError, setTtsError] = useState('')

  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS)
  const hideTimerRef = useRef<number | undefined>(undefined)
  const generationRef = useRef(0)

  const clearHideTimer = useCallback(() => {
    window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = undefined
  }, [])

  const scheduleHide = useCallback(() => {
    clearHideTimer()
    hideTimerRef.current = window.setTimeout(() => {
      stopSpeech()
      getCurrentWindow()
        .hide()
        .catch((err) => console.error('Failed to hide bubble window:', err))
    }, AUTO_HIDE_MS)
  }, [clearHideTimer])

  const interruptCurrent = useCallback(() => {
    generationRef.current += 1
    stopSpeech()
    clearHideTimer()
    emit(EVENT_STATE_CHANGED, 'idle').catch((err) => console.error('Failed to emit idle state:', err))
    return generationRef.current
  }, [clearHideTimer])

  const finishSpeaking = useCallback(
    (settings: AppSettings, text: string, generation: number) => {
      if (settings.tts.enabled && settings.tts.apiKey) {
        emit(EVENT_STATE_CHANGED, 'speaking').catch((err) => console.error('Failed to emit speaking state:', err))
        speak(settings.tts, text)
          .catch((err) => {
            console.error('Speech failed:', err)
            setTtsError(err instanceof Error ? err.message : String(err))
          })
          .finally(() => {
            if (generationRef.current === generation) {
              scheduleHide()
              emit(EVENT_STATE_CHANGED, 'idle').catch((err) => console.error('Failed to emit idle state:', err))
            }
          })
      } else {
        scheduleHide()
        emit(EVENT_STATE_CHANGED, 'idle').catch((err) => console.error('Failed to emit idle state:', err))
      }
    },
    [scheduleHide],
  )

  const hideBubble = useCallback(() => {
    interruptCurrent()
    getCurrentWindow()
      .hide()
      .catch((err) => console.error('Failed to hide bubble window:', err))
  }, [interruptCurrent])

  const showTopic = useCallback(
    (nextTopic: string) => {
      const generation = interruptCurrent()
      setTopic(nextTopic)
      setTtsError('')
      finishSpeaking(settingsRef.current, nextTopic, generation)
    },
    [interruptCurrent, finishSpeaking],
  )

  useEffect(() => {
    loadSettings().then(
      (loaded) => {
        settingsRef.current = loaded
      },
      (err) => console.error('Failed to load settings:', err),
    )
    const unlistenSettings = listen<AppSettings>(EVENT_SETTINGS_UPDATED, (event) => {
      settingsRef.current = event.payload
    })
    const unlistenShow = listen<string>(EVENT_BUBBLE_SHOW, (event) => showTopic(event.payload))
    const unlistenHide = listen(EVENT_BUBBLE_HIDE, hideBubble)
    return () => {
      unlistenSettings.then((fn) => fn())
      unlistenShow.then((fn) => fn())
      unlistenHide.then((fn) => fn())
    }
  }, [showTopic, hideBubble])

  return (
    <div className="h-screen w-screen p-2">
      <div className="h-full w-full overflow-y-auto">
        <div className="max-w-full whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm bg-muted px-3 py-1.5 text-sm shadow-lg">
          {topic}
          {ttsError && (
            <div className="mt-1 whitespace-pre-wrap break-words text-xs text-destructive">🔇 Voice failed: {ttsError}</div>
          )}
        </div>
      </div>
    </div>
  )
}
