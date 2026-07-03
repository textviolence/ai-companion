import { fetch } from '@tauri-apps/plugin-http'
import type { TtsSettings } from './settings'

const FISH_TTS_URL = 'https://api.fish.audio/v1/tts'
const FISH_MODEL = 's2.1-pro-free'

let currentAudio: HTMLAudioElement | null = null
let currentUrl: string | null = null
let onStopped: (() => void) | null = null

export async function speak(cfg: TtsSettings, text: string): Promise<void> {
  stopSpeech()
  const response = await fetch(FISH_TTS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
      model: FISH_MODEL,
    },
    body: JSON.stringify({
      text,
      format: 'mp3',
      ...(cfg.referenceId ? { reference_id: cfg.referenceId } : {}),
    }),
  })
  if (!response.ok) {
    throw new Error(`Fish Audio request failed: ${response.status} ${await response.text()}`)
  }
  const blob = new Blob([await response.arrayBuffer()], { type: 'audio/mpeg' })
  currentUrl = URL.createObjectURL(blob)
  const audio = new Audio(currentUrl)
  currentAudio = audio
  try {
    await new Promise<void>((resolve, reject) => {
      onStopped = () => resolve()
      audio.addEventListener('ended', () => resolve(), { once: true })
      audio.addEventListener('error', () => reject(new Error('Audio playback failed')), { once: true })
      audio.play().catch(reject)
    })
  } finally {
    onStopped = null
  }
}

export function stopSpeech(): void {
  onStopped?.()
  onStopped = null
  if (currentAudio) {
    currentAudio.pause()
    currentAudio = null
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl)
    currentUrl = null
  }
}
