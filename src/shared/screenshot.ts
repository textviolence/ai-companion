import { invoke } from '@tauri-apps/api/core'

export async function captureScreen(): Promise<string> {
  return invoke<string>('capture_screenshot')
}
