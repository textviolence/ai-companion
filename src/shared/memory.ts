import { load, type Store } from '@tauri-apps/plugin-store'
import { chatCompletion, type ChatMessage } from './llm'
import type { LlmSettings } from './settings'

const HISTORY_LIMIT = 15
const FACTS_LIMIT = 50

export interface MemoryData {
  history: ChatMessage[]
  facts: string[]
}

let storePromise: Promise<Store> | null = null

function memoryStore(): Promise<Store> {
  storePromise ??= load('memory.json', { autoSave: false, defaults: {} })
  return storePromise
}

export async function loadMemory(): Promise<MemoryData> {
  const store = await memoryStore()
  return {
    history: (await store.get<ChatMessage[]>('history')) ?? [],
    facts: (await store.get<string[]>('facts')) ?? [],
  }
}

export async function appendExchange(question: string, answer: string): Promise<void> {
  const store = await memoryStore()
  const { history } = await loadMemory()
  const updated = [
    ...history,
    { role: 'user' as const, content: question },
    { role: 'assistant' as const, content: answer },
  ].slice(-HISTORY_LIMIT)
  await store.set('history', updated)
  await store.save()
}

const FACT_SYSTEM_PROMPT = `You extract long-term facts about the user from their conversation with an assistant.
If a new memorable fact about the user appeared in the conversation (name, preferences, job, family, etc.), respond strictly in the format:
FACT: <one short fact>
If the new fact replaces or supersedes any of the already known facts (refines or contradicts them), add a separate line:
REPLACES: <comma-separated numbers of the facts being replaced>
If there is no memorable fact, respond with a single word: NONE`

export async function extractFact(cfg: LlmSettings, question: string, answer: string): Promise<void> {
  const store = await memoryStore()
  const { facts } = await loadMemory()
  const factList = facts.map((fact, i) => `${i + 1}. ${fact}`).join('\n') || '(nothing yet)'
  const reply = (
    await chatCompletion(cfg, [
      { role: 'system', content: FACT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Known facts about the user:\n${factList}\n\nNew conversation:\nUser: ${question}\nAssistant: ${answer}`,
      },
    ])
  ).trim()

  if (!reply || /^NONE\b/i.test(reply)) return
  const fact = reply.match(/^FACT:\s*(.+)$/im)?.[1]?.trim()
  if (!fact) return

  const replaces = new Set(
    (reply.match(/^REPLACES:\s*([\d,\s]+)$/im)?.[1] ?? '')
      .split(',')
      .map((n) => parseInt(n.trim(), 10) - 1)
      .filter((n) => Number.isInteger(n) && n >= 0 && n < facts.length),
  )
  const updated = [...facts.filter((_, i) => !replaces.has(i)), fact].slice(-FACTS_LIMIT)
  await store.set('facts', updated)
  await store.save()
}
