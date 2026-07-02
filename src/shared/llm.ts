import { fetch } from '@tauri-apps/plugin-http'
import type { LlmSettings } from './settings'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function requestInit(cfg: LlmSettings, messages: ChatMessage[], stream: boolean, signal?: AbortSignal): RequestInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`
  return {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({ model: cfg.model, messages, stream }),
  }
}

function completionsUrl(cfg: LlmSettings): string {
  return `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`
}

function extractMessageContent(data: unknown): string {
  return (data as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? ''
}

export async function streamChatCompletion(
  cfg: LlmSettings,
  messages: ChatMessage[],
  onToken: (token: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(completionsUrl(cfg), requestInit(cfg, messages, true, signal))
  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status} ${await response.text()}`)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    const content = extractMessageContent(await response.json())
    if (content) onToken(content)
    return content
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') return full
      let token: string | undefined
      try {
        token = (JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta
          ?.content
      } catch {
        continue
      }
      if (token) {
        full += token
        onToken(token)
      }
    }
  }
  return full
}

export async function chatCompletion(cfg: LlmSettings, messages: ChatMessage[]): Promise<string> {
  const response = await fetch(completionsUrl(cfg), requestInit(cfg, messages, false))
  if (!response.ok) {
    throw new Error(`LLM request failed: ${response.status} ${await response.text()}`)
  }
  return extractMessageContent(await response.json())
}
