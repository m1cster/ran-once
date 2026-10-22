/** The shell blocks that ran this session, each as `blockKey` names it. */
export type RanOnceBlocks = string[]

declare module 'claude-code' {
  interface PluginState {
    'ran-once': { ranBlocks: RanOnceBlocks }
  }
}
