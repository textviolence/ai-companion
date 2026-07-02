import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

function prettify(accelerator: string): string {
  return accelerator
    .replace('Control', 'Ctrl')
    .replace('Super', 'Win')
    .replace(/\bKey([A-Z])\b/, '$1')
    .replace(/\bDigit(\d)\b/, '$1')
}

interface HotkeyRecorderProps {
  value: string
  onChange: (accelerator: string) => void
}

export function HotkeyRecorder({ value, onChange }: HotkeyRecorderProps) {
  const [recording, setRecording] = useState(false)
  const [hint, setHint] = useState('')

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (!recording) return
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecording(false)
        setHint('')
        return
      }
      if (MODIFIER_KEYS.has(event.key)) return
      const modifiers = [
        event.ctrlKey && 'Control',
        event.altKey && 'Alt',
        event.shiftKey && 'Shift',
        event.metaKey && 'Super',
      ].filter(Boolean) as string[]
      if (!modifiers.length) {
        setHint('The combination must include a modifier (Ctrl, Alt, or Shift).')
        return
      }
      onChange([...modifiers, event.code].join('+'))
      setRecording(false)
      setHint('')
    },
    [recording, onChange],
  )

  return (
    <div className="grid gap-1.5">
      <Button
        type="button"
        variant="outline"
        className={cn('w-full justify-start font-normal', recording && 'border-ring bg-accent ring-[3px] ring-ring/50')}
        onClick={() => setRecording(true)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          setRecording(false)
          setHint('')
        }}
      >
        {recording ? 'Press a combination… (Esc to cancel)' : prettify(value)}
      </Button>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}
