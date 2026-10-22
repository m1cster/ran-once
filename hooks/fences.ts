// Splits a reply's markdown around its shell code fences, and pulls the
// commands out of the rows that record a run (`<bash-input>…</bash-input>`).

/** Fence tags the desktop app draws a Run button for. */
const SHELL_TAGS = new Set(['bash', 'sh', 'zsh', 'shell'])

export type Segment =
  | { kind: 'markdown'; text: string }
  | { kind: 'shell'; fence: string; body: string; raw: string }

const OPEN = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/

/**
 * Splits `text` into markdown runs and closed shell fences, in order. An
 * unclosed fence (a reply still streaming) stays markdown.
 */
export function splitShellFences(text: string): Segment[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const out: Segment[] = []
  let plain: string[] = []
  const flush = () => {
    if (plain.length > 0) out.push({ kind: 'markdown', text: plain.join('\n') })
    plain = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const open = OPEN.exec(line)
    if (!open) {
      plain.push(line)
      continue
    }
    const fence = open[1] ?? '```'
    const close = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`)
    let end = -1
    for (let j = i + 1; j < lines.length; j++) {
      if (close.test(lines[j] ?? '')) {
        end = j
        break
      }
    }
    if (end === -1) {
      plain.push(...lines.slice(i))
      break
    }
    const block = lines.slice(i, end + 1)
    if (SHELL_TAGS.has((open[2] ?? '').toLowerCase())) {
      flush()
      out.push({
        kind: 'shell',
        fence,
        body: lines.slice(i + 1, end).join('\n'),
        raw: block.join('\n'),
      })
    } else {
      plain.push(...block)
    }
    i = end
  }
  flush()

  return out
}

/** The trimmed form a block and a run are compared in. */
export const normalize = (command: string): string =>
  command.replace(/\r\n?/g, '\n').trim()

const BASH_INPUT = /<bash-input>([\s\S]*?)<\/bash-input>/g

/** Every command a row's text records as run, normalized. */
export function commandsRun(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(BASH_INPUT)) {
    const command = normalize(match[1] ?? '')
    if (command !== '') found.push(command)
  }

  return found
}

/** A short, stable name for a reply block's text: its length and FNV-1a hash. */
export function textKey(text: string): string {
  const s = normalize(text)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }

  return `${s.length}-${h.toString(16)}`
}

/** The address of a reply block's `index`-th shell fence. */
export const blockKey = (text: string, index: number): string => `${textKey(text)}:${index}`

export type Turn = { role: 'user' | 'assistant'; texts: readonly string[] }

/**
 * Replays a conversation in order and names the shell blocks that ran: each
 * run marks the newest earlier block with that exact command not yet run, so
 * the same command in a later reply stays runnable.
 */
export function ranBlockKeys(turns: readonly Turn[]): string[] {
  const blocks: { key: string; command: string; ran: boolean }[] = []
  for (const turn of turns) {
    for (const text of turn.texts) {
      if (turn.role === 'assistant') {
        let index = 0
        for (const s of splitShellFences(text)) {
          if (s.kind !== 'shell') continue
          blocks.push({ key: blockKey(text, index), command: normalize(s.body), ran: false })
          index++
        }
        continue
      }
      for (const command of commandsRun(text)) {
        const block = blocks.findLast(b => !b.ran && b.command === command)
        if (block) block.ran = true
      }
    }
  }

  return [...new Set(blocks.filter(b => b.ran).map(b => b.key))]
}
