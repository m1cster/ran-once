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

/** How often the follower looks for rows stored since its last look. */
export const POLL_MS = 1000

// The follower: a timer of ran-once's own that reads only the rows stored
// after `cursor` and refreshes when one records a run. It does not depend on
// `session.append` reaching this plugin, which another plugin above it may
// pass on without calling the hooks beneath. Module variables, so a reload
// starts it over (the old copy's `every` stops at the reload).
let follower: { cancel: () => void } | undefined
let cursor: string | undefined
let isPolling = false

/** Seeds the cursor at the newest row and works the run blocks out afresh. */
const seed = async ($: EngineInterface) => {
  const newest = await $.session.messages({ last: 1 })
  cursor = Array.isArray(newest) ? newest.at(-1)?.uuid : undefined
  await refresh($)
}

const poll = async ($: EngineInterface) => {
  if (isPolling) return
  isPolling = true
  try {
    if (cursor === undefined) return await seed($)
    const fresh = await $.session.messages({ after: cursor })
    // The anchor is gone (a compaction, a rewind, /clear): start over.
    if (!Array.isArray(fresh)) return await seed($)
    if (fresh.length === 0) return
    cursor = fresh.at(-1)?.uuid ?? cursor
    if (fresh.some(m => m.role === 'user' && commandsRun(m.text).length > 0)) await refresh($)
  } finally {
    isPolling = false
  }
}

/** Starts the follower once per load; later calls do nothing. */
const follow = async ($: EngineInterface) => {
  if (follower) return
  follower = $.clock.every(POLL_MS, () => void poll($).catch(() => {}))
  await seed($)
}

export const register: Register = on => {
  // A resumed session or a reload: the history says which blocks ran. From
  // here on the follower keeps up with runs.
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await follow($)

    return result
  })

  on('session.end', async ($, e, next) => {
    follower?.cancel()
    follower = undefined

    return next(e)
  })

  // The fast path. A Run-button click (the desktop app queues `<bash-input>…`
  // as a prompt) and a `!command` typed at the prompt both land here as a user
  // row, when the plugins above pass it on. The row is stored first, so the
  // history read back holds it. The follower catches the rows this misses.
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
    // Where `session.start` never reached this plugin, the first drawing
    // starts the follower; the run blocks arrive with its first refresh.
    if (!follower) void follow($).catch(() => {})
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
