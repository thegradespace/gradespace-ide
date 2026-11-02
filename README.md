# Gradespace IDE

Gradespace IDE (GS for short) is a desktop and web workspace for coding agents, made by [Gradespace](https://thegradespace.com). It runs the agents already on your computer, such as Claude Code, Codex, Cursor and OpenCode, and lets you manage their threads, terminals, diffs and files in one place.

## Where it comes from

Gradespace IDE started as a fork of [T3 Code](https://github.com/pingdotgg/t3code) by T3 Tools Inc., and is now built on separately. It does not follow T3 Code's releases. Thanks to the T3 team for making their work open source under the MIT licence; their copyright notice is kept in [LICENSE](./LICENSE).

What Gradespace IDE adds or changes:

- Gradespace name, logos and icons, and the `gs` command
- Mac app signed by Gradespace, with updates from [gradespace-ide-releases](https://github.com/johnkoko/gradespace-ide-releases)
- Settings for panel position, terminal position and the collapsed sidebar style
- API-key spend on the Limits tab
- Usage data is off unless you turn it on, plus an offline mode

T3's hosted services, such as T3 Connect and the T3 Code mobile apps, are not part of Gradespace IDE.

## Install

### Mac app

Download it from [thegradespace.com/ide](https://thegradespace.com/ide). The app updates itself when a new version is published.

### From source

You need [Vite+](https://viteplus.dev/guide/) (`curl -fsSL https://vite.plus | bash`) and at least one agent installed and signed in:

- Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
- Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
- Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
- OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`

Then:

```bash
vp i
vp run dev
```

`vp run gs:install` adds a `gs` command that runs this checkout from source.

## Documentation

Docs live in [docs/](./docs). Some pages still describe T3 Code's install methods and services.

- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Project settings](./docs/user/project-settings.md)
- [Appearance preferences](./docs/user/appearance.md)
- [Remote access from a phone or another machine](./docs/user/remote-access.md)
- [Source control integrations](./docs/user/source-control.md)

Building from source? Start at [docs/internals/overview.md](./docs/internals/overview.md).

## Contributing

Gradespace IDE is developed by the Gradespace team. Pull requests from people who are not collaborators on this repository are not accepted. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Security

Report security problems to [security@thegradespace.com](mailto:security@thegradespace.com), not in a public issue. See [SECURITY.md](./.github/SECURITY.md).

## Licence

MIT. See [LICENSE](./LICENSE).
