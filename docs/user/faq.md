# FAQ

## Is Gradespace IDE a harness?

No. A harness is what turns an LLM into an agent: it gives the model tools, a way to call them, runs them, and hands the results back. Claude Code is an interface (the terminal UI, the Code tab in the desktop app) plus a harness underneath (the Anthropic Agent SDK). Codex is the same split: the app plus the Codex App Server. Gradespace IDE uses those harnesses. It is not a harness, and it does not work without one.

Chef = LLM. Kitchen = harness. Gradespace IDE = the restaurant that lets you bring whatever kitchen you want.

Bring your own: Claude Code, Codex, Cursor, Grok Build, OpenCode, Google Antigravity, Kiro, Pi, Muse Code, or fx. [Provider setup](./install.md#providers)

## Why use Gradespace IDE instead of Claude Code or the Codex app?

Gradespace IDE does not replace them. It runs them, so you manage every agent's threads, terminals, diffs and files in one place. What you get:

- Bring your own subscription. Claude, Codex, and whatever else you already have installed.
- Remote. Run `gs up` on any machine and drive it from your other devices.
- Open source. It is MIT licensed, so you can read it, change it, or fork it.
- One interface for every provider, so switching harness does not mean switching tools.

[Install](./install.md)

## Can I use Gradespace IDE with my Claude Code subscription?

Yes. Sign in to Claude Code on the machine that runs the server, as you would anywhere else. [Claude setup](./providers-claude.md)

## How much does Gradespace IDE cost?

Nothing. It is free and open source (MIT). You bring your own subscription or API key and pay your provider as you already do.

## Why is my Claude 5-hour limit draining so fast?

Gradespace IDE drives Claude through Anthropic's Agent SDK, and some people report that SDK usage drains the 5-hour limit faster than Claude Code's own app. We have not confirmed the cause, and the limit is Anthropic's. Check **Usage** in Gradespace IDE and Claude's own usage page to see what your turns cost. [Usage](./usage.md)

## How do I use Gradespace IDE remotely?

Your agents run wherever the server runs: your desktop, a home server, a VPS. You connect to it from another device. Run `gs up` on that machine to get a pairing link. LAN pairing and Tailscale both work through that link. [Remote access](./remote-access.md)

## How do I use Gradespace IDE on my phone?

Gradespace IDE has no published mobile app. Open the web client in your phone's browser and connect it to your computer with a pairing link. The phone is a remote. Your computer does the work and needs to stay on. [Remote access](./remote-access.md)

## Will I get banned for using my subscription?

Gradespace IDE starts each provider's own tool or SDK with your own sign-in, and it does not pool or share accounts. It has no special agreement with any provider, so read each provider's current terms before you rely on it, in particular if several people would share one account.

## Can I add a bunch of accounts for one provider?

Gradespace IDE does not switch accounts for you, because automatic switching can break a provider's terms.

A separate work account is fine. Setup for two: [Codex](./providers-codex.md#use-multiple-accounts) · [Claude](./providers-claude.md#separate-accounts-or-configurations). For a bigger pool, manage the accounts outside Gradespace IDE with a self-hosted proxy such as [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI), then check the provider's terms. After you connect a hub, Gradespace IDE can show its pooled limits under Usage. [Connect a hub](./usage.md#connect-a-cliproxyapi-hub)

## Can I use an API key or OpenRouter instead of a subscription?

Yes. Add another provider instance in Settings and give it its own keys and endpoint. Claude has a full OpenRouter recipe. Your subscription setup stays untouched. [OpenRouter](./providers-claude.md#openrouter) · [Provider instances](./install.md#providers)

## Does Gradespace IDE support local models?

Not as a provider of its own. It runs agents through tools such as Claude Code, Codex, Cursor and OpenCode, and uses whatever models those tools can reach. If one of them can use a local model server, set that up in that tool.

## Does my code go to Gradespace servers?

No. Your code and prompts go from your machine to your provider (Anthropic, OpenAI, and so on), not to Gradespace. Gradespace IDE sends no product usage data unless you turn on **Share usage data** in **Settings → Maintenance → Privacy**, and even then it sends no prompts and no file contents. **Offline mode** in the same place also stops the app's background downloads, including update checks. [Product usage data](./telemetry.md)

## Worktrees are eating my disk. How do I clean them up?

Open **Settings → Worktrees → Cleanup** and turn on automatic worktree cleanup. You can also run it now from there. Worktrees add up fast. [Storage cleanup](./project-settings.md#storage-cleanup)

## Are my chats backed up?

Yes. Once a day the server copies its state database to a `backups` folder in its data folder and keeps the last 7. Open **Settings > Maintenance > Backups** to back up now or restore one. A restore saves your current chats first, then swaps the backup in the next time the server starts. Backups hold projects, threads, and messages. They do not include settings, secrets, or attachments.

## Is there voice input?

Yes. On iPhone and Android, dictation uses on-device speech by default, with the option to use a paired environment. On macOS 26 or later, desktop users can choose Apple Speech directly under **On this Mac** or choose an environment. Web and other desktop users can enable dictation by choosing an environment. The transcript goes into your draft for review. See [Voice input](./voice-input.md).

## Does it work on Windows, Mac, and Linux?

Mac and Windows have a desktop app, and Windows can also run agents inside WSL. Linux has no desktop app: run a server there and connect from another device. [Install](./install.md)

## Why is my provider not showing up?

Almost always, the CLI is not installed or not on the `PATH` of the machine that runs the server. (Not your phone. The computer.) Log in on that machine first, like `codex login` or `claude auth login`. Still missing? Point **Binary path** at it in provider settings. Version managers love to cause this one. [Provider setup](./install.md#providers)
