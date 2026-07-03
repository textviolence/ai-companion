import { useCallback, useEffect, useRef, useState } from 'react'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { EVENT_ASK_REQUESTED, EVENT_SETTINGS_UPDATED, EVENT_STATE_CHANGED } from '../shared/events'
import { streamChatCompletion, type ChatMessage } from '../shared/llm'
import { appendExchange, extractFact, loadMemory } from '../shared/memory'
import { DEFAULT_SETTINGS, loadSettings, type AppSettings } from '../shared/settings'
import { speak, stopSpeech } from '../shared/tts'

const AUTO_HIDE_MS = 20_000

type Phase = 'input' | 'streaming' | 'done' | 'error'

export function Chat() {
  const [draft, setDraft] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  const [ttsError, setTtsError] = useState('')
  const [phase, setPhase] = useState<Phase>('input')

  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS)
  const inFlightRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const hideTimerRef = useRef<number | undefined>(undefined)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
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
        .catch((err) => console.error('Failed to hide chat window:', err))
    }, AUTO_HIDE_MS)
  }, [clearHideTimer])

  const resetForNewQuestion = useCallback(() => {
    generationRef.current += 1
    abortRef.current?.abort()
    stopSpeech()
    clearHideTimer()
    inFlightRef.current = false
    setDraft('')
    setQuestion('')
    setAnswer('')
    setError('')
    setTtsError('')
    setPhase('input')
    textareaRef.current?.focus()
  }, [clearHideTimer])

  const hideChat = useCallback(() => {
    generationRef.current += 1
    abortRef.current?.abort()
    stopSpeech()
    clearHideTimer()
    getCurrentWindow()
      .hide()
      .catch((err) => console.error('Failed to hide chat window:', err))
  }, [clearHideTimer])

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
    const unlistenAsk = listen(EVENT_ASK_REQUESTED, resetForNewQuestion)
    return () => {
      unlistenSettings.then((fn) => fn())
      unlistenAsk.then((fn) => fn())
    }
  }, [resetForNewQuestion])

  const send = useCallback(async () => {
    const text = draft.trim()
    if (!text || inFlightRef.current) return
    inFlightRef.current = true
    generationRef.current += 1
    const generation = generationRef.current
    clearHideTimer()
    stopSpeech()
    const controller = new AbortController()
    abortRef.current = controller

    setQuestion(text)
    setDraft('')
    setAnswer('')
    setError('')
    setTtsError('')
    setPhase('streaming')
    await emit(EVENT_STATE_CHANGED, 'thinking')

    try {
      const settings = settingsRef.current
      const memory = await loadMemory()
      const messages: ChatMessage[] = [
        { role: 'system', content: settings.behavior.systemPrompt },
        ...(memory.facts.length
          ? [
              {
                role: 'system' as const,
                content: `What you remember about the user:\n${memory.facts.map((fact) => `- ${fact}`).join('\n')}`,
              },
            ]
          : []),
        ...memory.history,
        { role: 'user', content: text },
      ]
      const full = await streamChatCompletion(
        settings.llm,
        messages,
        (token) => setAnswer((prev) => prev + token),
        controller.signal,
      )
      setPhase('done')
      await appendExchange(text, full)
      if (settings.tts.enabled && settings.tts.apiKey) {
        speak(settings.tts, full)
          .catch((err) => {
            console.error('Speech failed:', err)
            setTtsError(err instanceof Error ? err.message : String(err))
          })
          .finally(() => {
            if (generationRef.current === generation) scheduleHide()
          })
      } else {
        scheduleHide()
      }
      extractFact(settings.llm, text, full).catch((err) => console.error('Fact extraction failed:', err))
    } catch (err) {
      if (!controller.signal.aborted) {
        console.error('LLM request failed:', err)
        setError(err instanceof Error ? err.message : String(err))
        setPhase('error')
        scheduleHide()
      }
    } finally {
      inFlightRef.current = false
      await emit(EVENT_STATE_CHANGED, 'idle')
    }
  }, [draft, clearHideTimer, scheduleHide])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        hideChat()
        return
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        void send()
      }
    },
    [hideChat, send],
  )

  return (
    <div className="h-screen w-screen p-2" onKeyDown={(event) => event.key === 'Escape' && hideChat()}>
      <Card className="h-full gap-2 p-2.5 shadow-lg">
        <Textarea
          ref={textareaRef}
          className="min-h-[48px] shrink-0 resize-none text-sm shadow-none"
          rows={2}
          placeholder="Ask something… (Enter to send, Esc to close)"
          value={draft}
          autoFocus
          onChange={(event) => {
            setDraft(event.target.value)
            clearHideTimer()
          }}
          onKeyDown={handleKeyDown}
        />
        <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
          {question && (
            <div className="ml-auto max-w-[90%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary px-3 py-1.5 text-sm text-primary-foreground">
              {question}
            </div>
          )}
          {(answer || phase === 'streaming') && (
            <div className="mr-auto max-w-[95%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm bg-muted px-3 py-1.5 text-sm">
              {answer}
              {phase === 'streaming' && (
                <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-foreground align-text-bottom" />
              )}
            </div>
          )}
          {phase === 'error' && (
            <div className="mr-auto max-w-[95%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm bg-destructive/10 px-3 py-1.5 text-sm text-destructive">
              {error}
            </div>
          )}
          {ttsError && (
            <div className="mr-auto max-w-[95%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm bg-destructive/10 px-3 py-1 text-xs text-destructive">
              🔇 Voice failed: {ttsError}
            </div>
          )}
          {phase === 'input' && !question && <div className="text-xs text-muted-foreground">Shift+Enter for a new line</div>}
        </div>
      </Card>
    </div>
  )
}
