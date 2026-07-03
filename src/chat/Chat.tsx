import { useCallback, useEffect, useRef, useState } from 'react'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { EVENT_ASK_REQUESTED, EVENT_SETTINGS_UPDATED, EVENT_STATE_CHANGED } from '../shared/events'
import { streamChatCompletion, type ChatMessage } from '../shared/llm'
import { appendExchange, extractFact, loadMemory } from '../shared/memory'
import { DEFAULT_SETTINGS, loadSettings, type AppSettings } from '../shared/settings'
import { speak, stopSpeech } from '../shared/tts'

const AUTO_HIDE_MS = 20_000

type Phase = 'input' | 'streaming' | 'done' | 'error'

function messageText(content: ChatMessage['content']): string {
  return typeof content === 'string' ? content : content.map((part) => (part.type === 'text' ? part.text : '')).join('')
}

export function Chat() {
  const [draft, setDraft] = useState('')
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [streamingAnswer, setStreamingAnswer] = useState('')
  const [error, setError] = useState('')
  const [ttsError, setTtsError] = useState('')
  const [phase, setPhase] = useState<Phase>('input')

  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS)
  const inFlightRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const hideTimerRef = useRef<number | undefined>(undefined)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
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

  const interruptCurrent = useCallback(() => {
    generationRef.current += 1
    abortRef.current?.abort()
    stopSpeech()
    clearHideTimer()
    emit(EVENT_STATE_CHANGED, 'idle').catch((err) => console.error('Failed to emit idle state:', err))
    return generationRef.current
  }, [clearHideTimer])

  const finishAnswer = useCallback(
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

  const resetForNewQuestion = useCallback(() => {
    interruptCurrent()
    inFlightRef.current = false
    setDraft('')
    setStreamingAnswer('')
    setError('')
    setTtsError('')
    setPhase('input')
    loadMemory().then(
      (memory) => setHistory(memory.history),
      (err) => console.error('Failed to load memory:', err),
    )
    textareaRef.current?.focus()
  }, [interruptCurrent])

  const hideChat = useCallback(() => {
    interruptCurrent()
    getCurrentWindow()
      .hide()
      .catch((err) => console.error('Failed to hide chat window:', err))
  }, [interruptCurrent])

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

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [history, streamingAnswer, error])

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

    setHistory((prev) => [...prev, { role: 'user', content: text }])
    setDraft('')
    setStreamingAnswer('')
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
        (token) => setStreamingAnswer((prev) => prev + token),
        controller.signal,
      )
      setPhase('done')
      setHistory((prev) => [...prev, { role: 'assistant', content: full }])
      setStreamingAnswer('')
      await appendExchange(text, full)
      finishAnswer(settings, full, generation)
      extractFact(settings.llm, text, full).catch((err) => console.error('Fact extraction failed:', err))
    } catch (err) {
      if (!controller.signal.aborted) {
        console.error('LLM request failed:', err)
        setError(err instanceof Error ? err.message : String(err))
        setPhase('error')
        scheduleHide()
        await emit(EVENT_STATE_CHANGED, 'idle')
      }
    } finally {
      inFlightRef.current = false
    }
  }, [draft, clearHideTimer, scheduleHide, finishAnswer])

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
        <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto" ref={scrollRef}>
          {history.length === 0 && phase === 'input' && !streamingAnswer && (
            <div className="text-xs text-muted-foreground">Shift+Enter for a new line</div>
          )}
          {history.map((message, index) => (
            <div
              key={index}
              className={cn(
                'max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-sm',
                message.role === 'user'
                  ? 'ml-auto rounded-br-sm bg-primary text-primary-foreground'
                  : 'mr-auto max-w-[95%] rounded-bl-sm bg-muted',
              )}
            >
              {messageText(message.content)}
            </div>
          ))}
          {(streamingAnswer || phase === 'streaming') && (
            <div className="mr-auto max-w-[95%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm bg-muted px-3 py-1.5 text-sm">
              {streamingAnswer}
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
        </div>
      </Card>
    </div>
  )
}
