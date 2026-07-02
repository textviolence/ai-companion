import { useCallback, useEffect, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import { exit } from '@tauri-apps/plugin-process'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { importImage, imageUrl, removeImage } from '../shared/images'
import { loadSettings, saveSettings } from '../shared/settings'

export function Onboarding() {
  const [fileName, setFileName] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested(() => void exit(0))
    return () => {
      unlisten.then((fn) => fn())
    }
  }, [])

  const pickImage = useCallback(async () => {
    setError('')
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif'] }],
    })
    if (!selected) return
    setBusy(true)
    try {
      const imported = await importImage(selected)
      if (fileName) await removeImage(fileName)
      setFileName(imported)
      setPreviewUrl(await imageUrl(imported))
    } catch (err) {
      console.error('Failed to import image:', err)
      setError('Failed to import the image.')
    } finally {
      setBusy(false)
    }
  }, [fileName])

  const finish = useCallback(async () => {
    setBusy(true)
    try {
      const settings = await loadSettings()
      settings.images.companion = fileName
      await saveSettings(settings)
      await getCurrentWindow().hide()
    } catch (err) {
      console.error('Failed to save settings:', err)
      setError('Failed to save settings.')
      setBusy(false)
    }
  }, [fileName])

  return (
    <div className="flex h-screen items-center justify-center bg-background p-6 text-foreground">
      <Card className="w-full max-w-sm border-none shadow-none">
        <CardHeader className="text-center">
          <CardTitle className="text-lg">Choose a companion</CardTitle>
          <CardDescription>PNG, JPG, or GIF — the image will live on your desktop.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <div className="flex h-56 w-56 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border text-muted-foreground">
            {previewUrl ? (
              <img src={previewUrl} alt="Companion preview" className="max-h-full max-w-full object-contain" />
            ) : (
              <ImageOff className="size-8" strokeWidth={1.5} />
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          <Button variant="outline" className="w-full" onClick={() => void pickImage()} disabled={busy}>
            Choose an image…
          </Button>
          <Button className="w-full" onClick={() => void finish()} disabled={!fileName || busy}>
            Continue
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
