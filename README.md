# ran-once

A Claude Code mod that guards against running a shell command twice by accident.

Once a shell code block from Claude's reply has run (with the block's Run button in the
Claude desktop app, or by typing it with `!` at the prompt), that block is drawn grayed
out and without its Run button. It stays selectable, so you can still copy it and run it
by hand on purpose. If the same command shows up again in a later reply, that new block
keeps its Run button until you run it.

Needs Claude Code 2.1.304 or newer: the mod uses Claude Code's function-hooks API, which is
early access and may change between releases. Check with `claude --version`.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install ran-once --marketplace m1cster/ran-once
```

Answer `y` to add the marketplace, then pick the user scope.

From a shell:

```bash
claude plugin install ran-once --marketplace m1cster/ran-once
```

In the Claude desktop app, where `/plugin` does not run: click **+** next to the prompt
box, then **Plugins**, **Add marketplace** with `m1cster/ran-once`, then **Add plugin**.

New sessions load the mod from then on. In a session that is already open, run
`/reload-plugins`. When the mod loads, it reads the session's history, so blocks that
already ran there are grayed out right away.

## Limits

- A Run click sends only the command's text, not which block it came from. Clicking an
  older copy of a command grays the newest copy that has not run yet.
- A block grays out only when its text exactly matches what ran (surrounding whitespace
  ignored).
- Two replies with exactly the same text count as one.

## Uninstall

```bash
claude plugin uninstall ran-once
```

## Development

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

## License

MIT, see [LICENSE](LICENSE). This is an independent project, not made or endorsed by
Anthropic.
