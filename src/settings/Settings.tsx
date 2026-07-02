import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import { ImageOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { EVENT_SETTINGS_UPDATED } from '../shared/events'
import { importImage, imageUrl, removeImage } from '../shared/images'
import { loadSettings, saveSettings, type AppSettings, type ImageSettings } from '../shared/settings'
import { HotkeyRecorder } from './HotkeyRecorder'

type ImageSlot = keyof ImageSettings

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}

function SwitchRow({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function ImagePreview({ fileName }: { fileName: string }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!fileName) {
      setUrl('')
      return
    }
    let cancelled = false
    imageUrl(fileName).then(
      (resolved) => {
        if (!cancelled) setUrl(resolved)
      },
      (err) => console.error('Failed to resolve preview URL:', err),
    )
    return () => {
      cancelled = true
    }
  }, [fileName])
  return (
    <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed text-muted-foreground">
      {url ? <img src={url} alt="" className="max-h-full max-w-full object-contain" /> : <ImageOff className="size-5" strokeWidth={1.5} />}
    </div>
  )
}

export function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const persistedImagesRef = useRef<ImageSettings>({ companion: '', thinking: '' })

  useEffect(() => {
    loadSettings().then(
      (loaded) => {
        setSettings(loaded)
        persistedImagesRef.current = { ...loaded.images }
      },
      (err) => console.error('Failed to load settings:', err),
    )
    const unlistenSettings = listen<AppSettings>(EVENT_SETTINGS_UPDATED, (event) => {
      setSettings(event.payload)
      persistedImagesRef.current = { ...event.payload.images }
    })
    const unlistenClose = getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault()
      getCurrentWindow()
        .hide()
        .catch((err) => console.error('Failed to hide settings window:', err))
    })
    return () => {
      unlistenSettings.then((fn) => fn())
      unlistenClose.then((fn) => fn())
    }
  }, [])

  const update = useCallback(
    <S extends keyof AppSettings>(section: S, patch: Partial<AppSettings[S]>) => {
      setStatus('')
      setSettings((prev) => (prev ? { ...prev, [section]: { ...prev[section], ...patch } } : prev))
    },
    [],
  )

  const pickImage = useCallback(
    async (slot: ImageSlot) => {
      if (!settings) return
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif'] }],
      })
      if (!selected) return
      setBusy(true)
      try {
        const imported = await importImage(selected)
        const current = settings.images[slot]
        if (current && current !== persistedImagesRef.current[slot]) await removeImage(current)
        update('images', { [slot]: imported })
      } catch (err) {
        console.error('Failed to import image:', err)
        setStatus('Failed to import the image.')
      } finally {
        setBusy(false)
      }
    },
    [settings, update],
  )

  const save = useCallback(async () => {
    if (!settings) return
    setBusy(true)
    try {
      await saveSettings(settings)
      const previous = persistedImagesRef.current
      const referenced = new Set([settings.images.companion, settings.images.thinking])
      for (const old of [previous.companion, previous.thinking]) {
        if (old && !referenced.has(old)) await removeImage(old)
      }
      persistedImagesRef.current = { ...settings.images }
      setStatus('Saved.')
    } catch (err) {
      console.error('Failed to save settings:', err)
      setStatus('Failed to save settings.')
    } finally {
      setBusy(false)
    }
  }, [settings])

  if (!settings) return null

  const statusIsError = status.startsWith('Failed')

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 bg-background p-6 text-foreground">
      <h1 className="text-lg font-semibold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">LLM connection</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label="Base URL" htmlFor="llm-base-url">
            <Input
              id="llm-base-url"
              type="text"
              value={settings.llm.baseUrl}
              onChange={(event) => update('llm', { baseUrl: event.target.value })}
            />
          </Field>
          <Field label="API Key" htmlFor="llm-api-key">
            <Input
              id="llm-api-key"
              type="password"
              value={settings.llm.apiKey}
              onChange={(event) => update('llm', { apiKey: event.target.value })}
            />
          </Field>
          <Field label="Model" htmlFor="llm-model">
            <Input
              id="llm-model"
              type="text"
              value={settings.llm.model}
              onChange={(event) => update('llm', { model: event.target.value })}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Voice (Fish Audio)</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <SwitchRow
            id="tts-enabled"
            label="Speak responses"
            checked={settings.tts.enabled}
            onCheckedChange={(checked) => update('tts', { enabled: checked })}
          />
          <Field label="API Key" htmlFor="tts-api-key">
            <Input
              id="tts-api-key"
              type="password"
              value={settings.tts.apiKey}
              onChange={(event) => update('tts', { apiKey: event.target.value })}
            />
          </Field>
          <Field label="Voice reference ID" htmlFor="tts-reference-id">
            <Input
              id="tts-reference-id"
              type="text"
              value={settings.tts.referenceId}
              onChange={(event) => update('tts', { referenceId: event.target.value })}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Behavior</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label="System prompt" htmlFor="behavior-system-prompt">
            <Textarea
              id="behavior-system-prompt"
              value={settings.behavior.systemPrompt}
              onChange={(event) => update('behavior', { systemPrompt: event.target.value })}
            />
          </Field>
          <Field label="Global hotkey">
            <HotkeyRecorder value={settings.behavior.hotkey} onChange={(hotkey) => update('behavior', { hotkey })} />
          </Field>
          <SwitchRow
            id="lock-position"
            label="Lock position (prevent dragging the companion)"
            checked={settings.behavior.lockPosition}
            onCheckedChange={(checked) => update('behavior', { lockPosition: checked })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Images</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center gap-3">
            <ImagePreview fileName={settings.images.companion} />
            <Button variant="outline" size="sm" onClick={() => void pickImage('companion')} disabled={busy}>
              Replace main…
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <ImagePreview fileName={settings.images.thinking} />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void pickImage('thinking')} disabled={busy}>
                {settings.images.thinking ? 'Replace thinking…' : 'Choose thinking…'}
              </Button>
              {settings.images.thinking && (
                <Button variant="ghost" size="sm" onClick={() => update('images', { thinking: '' })} disabled={busy}>
                  Remove
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mt-auto flex items-center gap-3 pt-2">
        <Button onClick={() => void save()} disabled={busy}>
          Save
        </Button>
        <Button variant="outline" onClick={() => void getCurrentWindow().hide()}>
          Close
        </Button>
        {status && <span className={cn('text-sm', statusIsError ? 'text-destructive' : 'text-muted-foreground')}>{status}</span>}
      </div>
    </div>
  )
}
