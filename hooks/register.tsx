import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RanOnceBlocks } from '../types'
import { blockKey, commandsRun, ranBlockKeys, splitShellFences } from './fences'
import type { Turn } from './fences'

const ranBlocks = atom({ plugin: 'ran-once', key: 'ranBlocks' } as const, [])

// Rows whose text is never the person's own run: a tool's output can quote
// `<bash-input>` (a grep of a transcript), and so can the model's reply.
const NOT_A_RUN = new Set(['tool-result', 'tool-message', 'response', 'attachment', 'hook-context', 'compaction', 'notice'])

/** Works out the run blocks afresh from the conversation as stored. */
const refresh = async ($: EngineInterface) => {
  const history = await $.session.messages({ as: 'api' })
  const turns: Turn[] = history.map(m => ({
    role: m.role,
    texts: m.content.flatMap(block => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])),
  }))
  const keys = ranBlockKeys(turns)
  await update($, ranBlocks, (list: RanOnceBlocks) =>
    list.length === keys.length && list.every((k, i) => k === keys[i]) ? list : keys,
  )
}

export const register: Register = on => {
  // A resumed session or a reload: the history says which blocks ran.
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)

    return result
  })

  // A Run-button click (the desktop app queues `<bash-input>…` as a prompt)
  // and a `!command` typed at the prompt both land here as a user row. The
  // row is stored first, so the history read back holds it.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId === undefined && e.message.type === 'user' && !NOT_A_RUN.has(e.door)) {
      const text = e.message.content.map(block => (block.type === 'text' ? block.text : '')).join('\n')
      if (commandsRun(text).length > 0) await refresh($)
    }

    return stored
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) return next(e)
    const ran = await read($, ranBlocks)
    if (ran.length === 0) return next(e)

    const segments = splitShellFences(e.props.text)
    let index = 0
    const isRan = segments.map(s => s.kind === 'shell' && ran.includes(blockKey(e.props.text, index++)))
    if (!isRan.includes(true)) return next(e)

    const { Box, Markdown } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" gap={1}>
        {segments.map((s, i) =>
          s.kind === 'markdown' ? (
            s.text.trim() === '' ? null : <Markdown text={s.text} />
          ) : isRan[i] ? (
            // Untagged, so the surface adds no Run button; dim, so it reads as done.
            <Markdown text={`${s.fence}\n${s.body}\n${s.fence}`} dimColor />
          ) : (
            <Markdown text={s.raw} />
          ),
        )}
      </Box>
    )
  })
}
