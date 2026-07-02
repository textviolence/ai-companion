import { convertFileSrc } from '@tauri-apps/api/core'
import { appDataDir, extname, join } from '@tauri-apps/api/path'
import { copyFile, exists, mkdir, remove } from '@tauri-apps/plugin-fs'

async function imagesDir(): Promise<string> {
  return join(await appDataDir(), 'images')
}

export async function importImage(sourcePath: string): Promise<string> {
  const dir = await imagesDir()
  if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  const fileName = `${crypto.randomUUID()}.${await extname(sourcePath)}`
  await copyFile(sourcePath, await join(dir, fileName))
  return fileName
}

export async function imageUrl(fileName: string): Promise<string> {
  return convertFileSrc(await join(await imagesDir(), fileName))
}

export async function removeImage(fileName: string): Promise<void> {
  try {
    await remove(await join(await imagesDir(), fileName))
  } catch (err) {
    console.error(`Failed to remove image ${fileName}:`, err)
  }
}
