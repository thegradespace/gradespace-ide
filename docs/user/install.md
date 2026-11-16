# Install Gradespace IDE

Gradespace IDE runs coding agents on your computer and lets you control them from its
desktop, web, or mobile app. Set up the machine where the agents will work first.

## Platforms

- **Mac:** signed and notarized.
- **Windows:** the installer is not signed yet. Windows SmartScreen warns on
  first install; choose **More info**, then **Run anyway**.
- **Linux:** no desktop app. Run a server and connect to it from another
  device ([remote access](./remote-access.md)).

## Requirements

You need an installed, authenticated provider before starting a thread. You can
launch Gradespace IDE and configure providers afterwards.

## Desktop app

Download Gradespace IDE for Mac or Windows from [thegradespace.com/ide](https://thegradespace.com/ide),
or take the Mac `.dmg` or the Windows `.exe` installer from the
[latest release](https://github.com/johnkoko/gradespace-ide-releases/releases/latest).
The app updates itself from its GitHub releases; see [Updating](./updating.md).

### The `gs` command

The desktop app includes the `gs` command-line tool. A new install sets it up
on first launch; after an update, or any time, choose **Install** next to
**gs command** in **Settings → About**. On macOS and Linux it adds a `gs` link
in `~/.local/bin` (or `~/bin`); on Windows it adds the app's command folder to
your `PATH`. Open a new terminal afterwards. If the folder is not on your
`PATH`, **Add to PATH** on the Welcome page or in **Settings → About** adds one
line to your shell's startup file. **Remove** takes it off, and the app does not
add it again. If another program, such as Ghostscript, already has a `gs`, the
command is installed as `t3` instead.

Gradespace IDE publishes no standalone CLI installer, npm package, or package
manager builds, so the `gs` command comes only from the app (or a build from
source). `gs update` therefore has nothing to install; update the app instead.

| Task                                  | Command                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------- |
| Start the server and open the web app | `gs`                                                                    |
| Start the server without a browser    | `gs serve`                                                              |
| Use it from your other devices        | `gs up` ([details](./remote-access.md))                                 |
| Keep it running in the background     | `gs service install` ([details](./background-service.md))               |
| Reclaim database space                | `gs doctor` ([details](./background-service.md#reclaim-database-space)) |
| Remove it again                       | `gs uninstall`                                                          |

Run `gs help` or `gs --help` for the full reference. To start in a new working
directory, use an explicit path such as `gs ./my-project`. A bare directory name
is accepted only if it already exists.

If `gs` or `gs start` reports an already running server, run the `gs pair`
command it names and open the pairing URL to connect to that server. Stop it
before starting a replacement, or use a different `--base-dir` for an
independent server.

### Build a server from source

To run a server on a machine without the app, build it from source with `vp`,
which provides the Node version it needs
([Install vp](../operations/development.md#first-checkout)):

```bash
git clone https://github.com/thegradespace/gradespace-ide
cd gradespace-ide && vp i && vp run build:desktop
node apps/server/dist/bin.mjs
```

A server built this way is not tied to a release, so update it with `git pull`
and a rebuild. Each release also carries a Linux x64 server runtime, which is
what a Linux server updates itself from; other platforms have no such archive.

### Windows Subsystem for Linux

Choose a WSL distro in **Settings → Sharing & access** to run agents and projects
there. Install the provider CLIs inside that distro. The app installs its own
server runtime there automatically; the first launch after an app update can
take longer.

### Open a project from a terminal

With the desktop app already running on the same machine:

```bash
gs app
```

This opens a new thread for the current directory, adding the project if needed.
Pass a path, such as `gs app ../my-project`, to open another directory. It requires
the desktop app, so a standalone server or an SSH session is not enough. If the
command cannot reach the app, start or update the desktop app and try again.

### Drop a folder on the sidebar

Drag one or more folders from Finder, Explorer, or your file manager onto the
sidebar. Each one opens as a project on this computer, the same as `gs app`.
Files dropped on a thread still attach to that thread. Browsers do not share
folder paths, so in the web app use **Add project** instead.

## Mobile app

Gradespace IDE has no published mobile app. A browser on your phone can connect
to a server through a pairing URL; see [remote access](./remote-access.md).

## Providers

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable the provider you want. Installation, login, and configuration belong
to that environment's machine, even when you connect from a phone or another
computer.

| Provider    | Install and authenticate                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | [Connect with ChatGPT](./providers-codex.md#connect-with-chatgpt), or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`. |
| Claude      | Install Claude Code from provider setup, or install [Claude Code](https://claude.com/product/claude-code) yourself, then run `claude auth login`.         |
| Cursor      | Install [Cursor CLI](https://cursor.com/cli), then run `agent login`.                                                                                     |
| Grok Build  | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                                                                                        |
| Kiro        | Install [Kiro CLI](https://kiro.dev/docs/cli/), then run `kiro-cli login`.                                                                                |
| OpenCode    | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                                                                                  |
| Antigravity | Install and sign in with Google from Gradespace IDE's provider settings.                                                                                  |
| Pi          | Install [Pi](./providers-pi.md#set-up-pi) with Node.js 22.19 or newer, then run `pi` and `/login`.                                                        |
| Muse Code   | Install [Muse Code](https://dev.meta.ai/docs/muse-code) on the server, run `muse login`, then enable it in Settings → Providers.                          |
| fx          | Install [fx](https://fx.sh) with `curl -fsSL https://fx.sh/setup.sh \| bash`, then run `fx login`.                                                        |

Provider CLIs must be on the server's `PATH`. If Gradespace IDE cannot find one, set its
**Binary path** in provider settings, especially when using a version manager.
Cursor's executable is `cursor-agent`, although its login command is
`agent login`. Codex connected through ChatGPT and Antigravity can use their
managed runtimes without a `PATH` entry.

Gradespace IDE warns when a provider version has known compatibility problems with your
release. Check **Settings → Providers** on that environment for the recommended
version or range. When its package manager supports installing a specific version,
you can install the recommendation there. Otherwise use the provider's installer
on the environment's machine. An unlisted version is unverified.

When a provider CLI is behind its latest release, its provider card shows the
available version. **Update now** runs the installer that owns the CLI
(Homebrew, mise, or a global npm, pnpm, Yarn, Bun, Volta, or Vite+ install), or
the CLI's own update command when Gradespace IDE cannot tell. Claude, Codex, and
OpenCode installs Gradespace IDE cannot identify stay manual: update them through the
installer you used. Gradespace IDE runs `mise upgrade`
only for a tool your mise config requests as `latest` when the provider's binary
path is a mise shim or under the tool's `installs/<tool>/latest` link; update a
pinned version, or a path into one version's directory, through mise yourself.
Update a CLI installed with Nix through Nix.
Cursor and Antigravity update with Gradespace IDE. Homebrew and Chocolatey installs
compare against the version their package manager offers, which can trail the
npm release; update Claude installed with Chocolatey through Chocolatey.

The managed runtimes for Antigravity and for Codex connected through ChatGPT
first install the release Gradespace IDE tested. When Gradespace IDE finds a newer compatible
release, their setup in **Settings → Providers** offers an update.

Add another provider instance for a separate account or configuration. Each
instance can have its own environment variables, such as API keys or a custom
base URL. Mark secret values as sensitive; after saving, Gradespace IDE does not display
their original values.

For provider-specific setup and accounts, see [Codex](./providers-codex.md),
[Claude](./providers-claude.md), [OpenCode](./providers-opencode.md),
[Antigravity](./providers-antigravity.md), [Kiro](./providers-kiro.md),
[Pi](./providers-pi.md), [Muse Code](./providers-muse.md), and [fx](./providers-fx.md).

### Provider check timeouts

If a provider works in its CLI but Gradespace IDE reports a timeout while checking it,
allow more time in the T3 server's environment. For example, give Codex and
Claude readiness checks 60 seconds:

```bash
T3CODE_CODEX_PROBE_TIMEOUT_MS=60000 T3CODE_CLAUDE_PROBE_TIMEOUT_MS=60000 gs serve
```

For a remote environment, set these on the machine running the T3 server.
Keep them in your launcher or service configuration to retain them across
updates, then restart the server. For systemd, add
`Environment=T3CODE_CODEX_PROBE_TIMEOUT_MS=60000` under `[Service]` in a service
override, reload systemd, and restart the service. Provider instances can also
set their own overrides in Settings → Providers.

Each variable extends that provider's readiness-probe deadlines; a phase whose
default is already longer keeps its default. Providers with several phases can
take longer than one deadline in total. Values must be whole milliseconds no
greater than 2147483647; unset or invalid values keep the defaults.

| Provider            | Environment variable                   |
| ------------------- | -------------------------------------- |
| Codex               | `T3CODE_CODEX_PROBE_TIMEOUT_MS`        |
| Claude              | `T3CODE_CLAUDE_PROBE_TIMEOUT_MS`       |
| Cursor              | `T3CODE_CURSOR_PROBE_TIMEOUT_MS`       |
| Antigravity         | `T3CODE_ANTIGRAVITY_PROBE_TIMEOUT_MS`  |
| Grok                | `T3CODE_GROK_PROBE_TIMEOUT_MS`         |
| Kiro                | `T3CODE_KIRO_PROBE_TIMEOUT_MS`         |
| fx                  | `T3CODE_FX_PROBE_TIMEOUT_MS`           |
| Pi                  | `T3CODE_PI_PROBE_TIMEOUT_MS`           |
| Muse Code           | `T3CODE_MUSE_PROBE_TIMEOUT_MS`         |
| OpenCode            | `T3CODE_OPENCODE_PROBE_TIMEOUT_MS`     |
| ACP Registry agents | `T3CODE_ACP_REGISTRY_PROBE_TIMEOUT_MS` |

Longer deadlines also take longer to report a stalled check. These overrides
cover readiness and discovery, including OpenCode server startup. Usage and
config enrichment retain their own shorter limits. Turn execution, package
installation, update checks, and shutdown limits keep their existing behavior.

## Next steps

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Running in the background](./background-service.md): keep a host available.
- [Updating Gradespace IDE](./updating.md): update the app and connected servers.
- [Managed policy](./managed-policy.md): configure Gradespace IDE for everyone on a machine.
