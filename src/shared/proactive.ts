import { chatCompletion } from './llm'
import type { LlmSettings } from './settings'

const PROACTIVE_SYSTEM_PROMPT = `You are shown a screenshot of the user's screen and must decide whether this is a good moment to proactively start a conversation.
Do NOT start a conversation if the screen is idle, empty, a bare desktop, a lock screen, or otherwise shows nothing specific worth commenting on.
DO start a conversation if the user is clearly engaged in something you could naturally react to or ask about (watching a video or stream, playing a game, reading an article, working on a creative project, looking at something unusual or funny, etc.).
If it is a good moment, respond strictly in the format:
START: <a short, natural opening line about what you see, in your own voice, inviting a reply>
Otherwise respond with a single word: NONE`

export async function checkProactiveMoment(
  cfg: LlmSettings,
  persona: string,
  screenshotDataUrl: string,
): Promise<string | null> {
  const reply = (
    await chatCompletion(cfg, [
      { role: 'system', content: persona },
      { role: 'system', content: PROACTIVE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Here is a current screenshot of my screen.' },
          { type: 'image_url', image_url: { url: screenshotDataUrl } },
        ],
      },
    ])
  ).trim()

  if (!reply || /^NONE\b/i.test(reply)) return null
  return reply.match(/^START:\s*(.+)$/im)?.[1]?.trim() ?? null
}
