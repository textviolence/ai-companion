import { invoke } from '@tauri-apps/api/core'
import { emit } from '@tauri-apps/api/event'
import { load, type Store } from '@tauri-apps/plugin-store'
import { EVENT_SETTINGS_UPDATED } from './events'

export interface LlmSettings {
  baseUrl: string
  apiKey: string
  model: string
}

export interface TtsSettings {
  enabled: boolean
  apiKey: string
  referenceId: string
}

export interface BehaviorSettings {
  systemPrompt: string
  hotkey: string
  lockPosition: boolean
}

export interface ImageSettings {
  companion: string
  thinking: string
  speaking: string
}

export interface ProactiveSettings {
  enabled: boolean
  intervalMinutes: number
}

export interface AppSettings {
  llm: LlmSettings
  tts: TtsSettings
  behavior: BehaviorSettings
  images: ImageSettings
  proactive: ProactiveSettings
}

export const DEFAULT_SETTINGS: AppSettings = {
  llm: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
  },
  tts: {
    enabled: false,
    apiKey: '',
    referenceId: '',
  },
  behavior: {
    systemPrompt:
      "You are a friendly AI companion living on the user's desktop. Reply briefly, warmly, and to the point.",
    hotkey: 'Control+Alt+Space',
    lockPosition: false,
  },
  images: {
    companion: '',
    thinking: '',
    speaking: '',
  },
  proactive: {
    enabled: false,
    intervalMinutes: 30,
  },
}

const DPAPI_PREFIX = 'dpapi:v1:'
const SETTINGS_KEY = 'settings'

let storePromise: Promise<Store> | null = null

function settingsStore(): Promise<Store> {
  storePromise ??= load('settings.json', { autoSave: false, defaults: {} })
  return storePromise
}

export function mergeSettings(saved: Partial<AppSettings> | undefined): AppSettings {
  return {
    llm: { ...DEFAULT_SETTINGS.llm, ...saved?.llm },
    tts: { ...DEFAULT_SETTINGS.tts, ...saved?.tts },
    behavior: { ...DEFAULT_SETTINGS.behavior, ...saved?.behavior },
    images: { ...DEFAULT_SETTINGS.images, ...saved?.images },
    proactive: { ...DEFAULT_SETTINGS.proactive, ...saved?.proactive },
  }
}

async function encryptKey(value: string): Promise<string> {
  if (!value) return ''
  return invoke<string>('dpapi_protect', { value })
}

async function decryptKey(value: string): Promise<{ value: string; migrated: boolean }> {
  if (!value) return { value: '', migrated: false }
  if (!value.startsWith(DPAPI_PREFIX)) return { value, migrated: true }
  try {
    return { value: await invoke<string>('dpapi_unprotect', { value }), migrated: false }
  } catch (err) {
    console.error('Failed to decrypt the saved API key:', err)
    return { value: '', migrated: false }
  }
}

export async function loadSettings(): Promise<AppSettings> {
  const store = await settingsStore()
  const settings = mergeSettings(await store.get<Partial<AppSettings>>(SETTINGS_KEY))
  const llmKey = await decryptKey(settings.llm.apiKey)
  const ttsKey = await decryptKey(settings.tts.apiKey)
  settings.llm.apiKey = llmKey.value
  settings.tts.apiKey = ttsKey.value
  if (llmKey.migrated || ttsKey.migrated) await persist(settings)
  return settings
}

async function persist(settings: AppSettings): Promise<void> {
  const store = await settingsStore()
  const onDisk: AppSettings = {
    ...settings,
    llm: { ...settings.llm, apiKey: await encryptKey(settings.llm.apiKey) },
    tts: { ...settings.tts, apiKey: await encryptKey(settings.tts.apiKey) },
  }
  await store.set(SETTINGS_KEY, onDisk)
  await store.save()
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await persist(settings)
  await emit(EVENT_SETTINGS_UPDATED, settings)
}
