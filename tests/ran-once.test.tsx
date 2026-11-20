import { expect, mock, test } from 'claude-code/testing'

import { blockKey, commandsRun, ranBlockKeys, splitShellFences } from '../hooks/fences'
import { POLL_MS } from '../hooks/register'

const reply = (command: string, lead = 'Run this:') => `${lead}\n\n\`\`\`bash\n${command}\n\`\`\``
const run = (command: string) =>
  `<bash-input>  ${command}\n</bash-input><bash-stdout>ok</bash-stdout><bash-stderr></bash-stderr>`

const PUSH_1 = reply('git push', 'First push:')
const PUSH_2 = reply('git push', 'Push again:')

test('fences split around shell blocks only', () => {
  const parts = splitShellFences('a\n```ts\nx\n```\n```sh\nls -la\n```\nb')
  expect(parts.map(p => p.kind)).toEqual(['markdown', 'shell', 'markdown'])
  expect(parts[1]).toMatchObject({ kind: 'shell', body: 'ls -la', fence: '```' })
  // A fence still streaming stays as it is.
  expect(splitShellFences('```bash\nls').map(p => p.kind)).toEqual(['markdown'])
  expect(commandsRun('<bash-input> ls </bash-input>x<bash-input>pwd</bash-input>')).toEqual(['ls', 'pwd'])
})

test('a run marks only the newest earlier block with that command', () => {
  const ran = ranBlockKeys([
    { role: 'assistant', texts: [PUSH_1] },
    { role: 'user', texts: [run('git push')] },
    { role: 'assistant', texts: [PUSH_2] },
  ])
  expect(ran).toEqual([blockKey(PUSH_1, 0)])

  // Run the repeat too: both are done now.
  const again = ranBlockKeys([
    { role: 'assistant', texts: [PUSH_1] },
    { role: 'user', texts: [run('git push')] },
    { role: 'assistant', texts: [PUSH_2] },
    { role: 'user', texts: [run('git push')] },
  ])
  expect(again).toEqual([blockKey(PUSH_1, 0), blockKey(PUSH_2, 0)])
})

test('a run with no unrun block left marks nothing new', () => {
  const ran = ranBlockKeys([
    { role: 'assistant', texts: [PUSH_1] },
    { role: 'user', texts: [run('git push')] },
    { role: 'user', texts: [run('git push')] },
    { role: 'user', texts: [run('ls')] },
  ])
  expect(ran).toEqual([blockKey(PUSH_1, 0)])
})

test('the run block is dim and untagged, the repeat keeps its Run button', async ($, on) => {
  const history: { role: 'user' | 'assistant'; content: { type: 'text'; text: string }[] }[] = []
  const say = (role: 'user' | 'assistant', text: string) => history.push({ role, content: [{ type: 'text', text }] })
  // The engine beneath the plugin: its stored history and its own drawing.
  on('session.messages', () => ({ value: history }))
  mock.session(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  say('assistant', PUSH_1)
  say('user', run('git push'))
  await $.session.append({
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: run('git push') }] },
    door: 'prompt',
    origin: { kind: 'sdk' },
    uuid: 'row-run-1',
  })
  say('assistant', PUSH_2)

  for (const surface of ['desktop', 'terminal'] as const) {
    const first = await $.ui.mount({
      plugin: 'ran-once',
      surface,
      component: 'AssistantMessage',
      requestId: 'msg_1-t0',
      props: { text: PUSH_1, isFirstOfReply: true },
    })
    const done = await first.find({ type: 'Markdown', text: /git push/ })
    expect(done?.props.dimColor).toBe(true)
    expect(done?.props.text).toBe('```\ngit push\n```')
    await first.unmount()

    const repeat = await $.ui.mount({
      plugin: 'ran-once',
      surface,
      component: 'AssistantMessage',
      requestId: 'msg_2-t0',
      props: { text: PUSH_2, isFirstOfReply: true },
    })
    expect((await repeat.find({ type: 'Text' }))?.text).toBe('engine')
    await repeat.unmount()
  }
})

test('a tool result quoting <bash-input> is no run', async ($, on) => {
  const history = [{ role: 'assistant' as const, content: [{ type: 'text' as const, text: PUSH_1 }] }]
  on('session.messages', () => ({ value: history }))
  mock.session(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.append({
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: run('git push') }] },
    door: 'tool-result',
    origin: { kind: 'sdk' },
    uuid: 'row-tool',
  })
  const ui = await $.ui.mount({
    plugin: 'ran-once',
    surface: 'desktop',
    component: 'AssistantMessage',
    requestId: 'msg_1-t0',
    props: { text: PUSH_1, isFirstOfReply: true },
  })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('a run that session.append never brought to ran-once still grays its block', async ($, on) => {
  // The engine's stored rows. A plugin above ran-once passes `session.append`
  // on without calling the hooks beneath, so rows reach the history alone.
  let rows: { role: 'user' | 'assistant'; text: string; uuid: string }[] = []
  let session = ''
  const store = (role: 'user' | 'assistant', text: string) =>
    rows.push({ role, text, uuid: `${session}-row-${rows.length + 1}` })
  on('session.messages', ($, e) => {
    if (e.as === 'api') return { value: rows.map(r => ({ role: r.role, content: [{ type: 'text' as const, text: r.text }] })) }
    const asRows = (list: typeof rows) => list.map(r => ({ ...r, toolUses: [] }))
    if (e.after !== undefined) {
      const at = rows.findIndex(r => r.uuid === e.after)
      return { value: at === -1 ? { deny: `no row ${e.after}` } : asRows(rows.slice(at + 1)) }
    }
    return { value: asRows(e.last === undefined ? rows : rows.slice(-e.last)) }
  })
  const clock = mock.clock(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  for (const surface of ['desktop', 'terminal'] as const) {
    // A conversation of its own per surface (as after /clear): the follower's
    // old cursor names no row of it, so it starts over.
    session = surface
    rows = []
    store('assistant', PUSH_1)
    store('user', run('git push'))
    store('assistant', PUSH_2)
    await clock.advance(POLL_MS)

    const first = await $.ui.mount({
      plugin: 'ran-once',
      surface,
      component: 'AssistantMessage',
      requestId: 'msg_1-t0',
      props: { text: PUSH_1, isFirstOfReply: true },
    })
    const repeat = await $.ui.mount({
      plugin: 'ran-once',
      surface,
      component: 'AssistantMessage',
      requestId: 'msg_2-t0',
      props: { text: PUSH_2, isFirstOfReply: true },
    })
    await clock.settle()
    expect((await first.find({ type: 'Markdown', text: /git push/ }))?.props.dimColor).toBe(true)
    expect((await repeat.find({ type: 'Text' }))?.text).toBe('engine')

    // The repeat runs in the open session; no session.append reaches ran-once.
    store('user', run('git push'))
    await clock.advance(POLL_MS)
    const done = await repeat.find({ type: 'Markdown', text: /git push/ })
    expect(done?.props.dimColor).toBe(true)
    expect(done?.props.text).toBe('```\ngit push\n```')
    // The first block stays as it was: one run, one block.
    expect((await first.findAll({ type: 'Markdown', text: /git push/ })).map(m => m.props.dimColor)).toEqual([true])
    await first.unmount()
    await repeat.unmount()
  }
})
