# budingx

This README describes budingx **0.9.2**. Use `/branch` to fork a session, `/rename` to title it, and `/resume` to search saved conversations. `/export --format markdown` includes attributable file changes. Ctrl+S stashes the current draft. Ctrl+O opens the transcript and Ctrl+E expands it. `/tasks` manages this session's background processes and subagents, `/worktree` manages its linked checkout, and `/mcp` manages stdio and remote connections.

An independent **MIT** terminal agent for OpenAI-compatible APIs. **0.9.1 (SP009 patch)**: the interactive loop no longer stops at a fixed turn count (headless gains an optional `--max-turns`), the context window is resolved per model with a custom field for custom models, auto-compaction is on by default and summarizes with the model, subagents have no default token budget and render their terminal notification as a system message, and skills gain user/project/bundled levels plus `/skillify` and `/reload-skills`. **0.9.0 (SP009)** was published via [GitHub Actions run #45100998785](https://github.com/Limingyang01/budingx-next/actions/runs/45100998785) from source `aecd8b7`. 0.9.0 adds distribution and release engineering: a triggering skill no longer echoes its prompt into the conversation (the body reaches the model as a `<skill>` context block, the session shows only `/<skill>` and a one-line notice), `/export` lets you pick which saved session to export (picker in the interactive TUI, `--session <id>` elsewhere), full auto (full access) is no longer blocked by the workspace boundary while the read-only and allow-edits modes keep it and the data-root/credential floors still hold, and the maintainer tooling gains a testable publishing state machine, channel/failure classification, an upload-result resolver, version consistency checking and real npm install/upgrade/uninstall/rollback gates. It builds on 0.8.0 (SP008), which added a `budingx serve` host entry with in-process / stdio / WebSocket transports, a versioned NDJSON host contract, single-writer session ownership with takeover recovery, concurrent-safe shared config and history, and MCP/hooks shared with the interactive TUI in the same process. It builds on 0.7.0 (SP007, published via [run #27](https://github.com/Limingyang01/budingx-next/actions/runs/44921288352) from source `a8628b5`), which added subagent execution (Agent/TaskOutput/TaskStop, /agents, agent cards), multimodal context (image paste on alt+v/ctrl+v, path attachments, the terminal-independent `/image` command, PNG downscaling, image cache, capability-gated rejection), an Anthropic Messages adapter, tool search with deferred loading, runtime diagnostics (/status, /stats, /doctor) and an evaluation-regression runner under scripts/eval/. It builds on 0.6.0: the four-zone terminal layout with frame-diff rendering, a keybinding system, a configurable status line, project instructions, skill discovery, MCP tools, controlled hooks, web fetch, and a headless CLI (text/json/stream-json), plus a command registry with `/init`, `/btw`, `/worktree`, `/tasks`, `/mcp`, `/skills` and `/export`. It keeps session transcripts and recovery, context compaction, project and session memory, approval previews, and session undo.

## Install

Requires **Node.js >=22.18** and npm. Bun and a running desktop app are not required.

```powershell
npm install -g budingx
budingx --help
```

Upgrading (`npm install -g budingx@latest`) replaces the program files only; the configuration, credentials, sessions and memory under `~/.budingx` stay untouched and remain readable, and an outdated configuration is migrated in place with a backup while unknown fields are preserved. Uninstalling (`npm uninstall -g budingx`) removes the program and keeps `~/.budingx`; remove that directory yourself if you want the data gone. A previous release can be installed again (`npm install -g budingx@0.8.0`); Node.js >= 22.18 is still required and the data format stays forward compatible.

## Configure and run

For local source testing only, the repository's `npm run start` reads the optional root `.env.e2e.local` through Node's native env-file flag. Existing process variables take precedence. It does not persist profiles or print keys. The installed `budingx` command and build/release flows do not auto-load this file; configure real environments explicitly. E2E budget/request fields do not limit interactive chat usage.

In PowerShell, set your own API endpoint, model and key. Use a trusted HTTPS endpoint; HTTP is permitted only for explicit localhost/loopback development endpoints.

```powershell
$env:BUDINGX_BASE_URL = "https://api.openai.com/v1"
$env:BUDINGX_MODEL = "YOUR_MODEL_NAME"
$env:BUDINGX_API_KEY = "YOUR_API_KEY"
budingx
```

These are placeholders. Never commit real keys or place them in command arguments. Only BUDINGX\_\* variables are read; the client does not discover keys or configuration from other tools.

```powershell
budingx --model YOUR_MODEL_NAME --base-url https://YOUR_PROVIDER/v1
budingx --prompt "Hello" --timeout 120000
```

The base URL is the provider API prefix; the client appends /chat/completions. The provider must return text/event-stream SSE and a [DONE] terminator.

Configuration priority is **CLI arguments > BUDINGX\_\* environment > stored profile**. The 0.1.1 environment and flag usage stays intact.

## Model profiles

Run `/models` in an interactive terminal to open the manager. Use N to add a profile, E to edit it, D to delete it, T to test the connection, and Enter to use the selected profile at the next turn. Use S for startup default and O for explicit orphan-key cleanup.

Choose a provider template, paste an API key into the hidden field, and press Enter to load model IDs. Custom accepts a compatible base URL and a manually entered or discovered model ID. Save retains the profile. Save and use also selects it for the conversation. In 0.3.2, use Space to mark several discovered models before pressing Enter. They share one saved endpoint and key. Use A on an existing model to add another under its saved configuration. Editing a shared endpoint or key affects its group; deleting a model keeps the key until the last group member is removed. `/provider` has been removed in 0.3.1.

In piped input, `/models` lists profiles and `/model NAME` selects one. Interactive changes to profiles are available in the manager. See the repository's PRODUCT.md for examples and permissions.

## Commands

- /help — help
- /config — show endpoint, model, key state (masked) and the configuration source
- /models — open the model manager (list profiles in a pipe)
- /model NAME — switch the model; the conversation is kept and the switch applies from the next turn
- /clear — clear the in-memory conversation and its visible transcript (input history and pending prompts remain)
- /sessions — list sessions saved in the current workspace with session ID, title, updated time and turn count
- /resume SESSION_ID — restore a saved session from this workspace. Records without a saved workspace identity remain on disk. Unknown tool results are marked for review.
- /effort [low|medium|high] — choose a reasoning level or set it directly for the next request. Set `BUDINGX_CONTEXT_WINDOW` to show usage against the window next to the active level.
- /context — show context usage and budget: used tokens, limit, reserved output, compaction threshold and per-message cost
- /effort [low|medium|high] — show or set the reasoning effort (also shown in the status bar)
- /memory — show project and session memory entries; /memory PROJECT|SESSION add TITLE:BODY writes one entry
- /exit or /quit — exit

Version 0.3.4 displays user turns, elapsed time and completion time. After a successful reply, press Tab at an empty prompt to fill the suggested follow-up, then edit and press Enter.

Version 0.3.5 distinguishes submitted prompts from Markdown replies and displays completion times as secondary text. The status bar shows a short permission label and omits idle activity.

The active turn indicator sits above the input. Queued prompts appear below it. Tool rows use a pulsing theme dot while pending, a green dot on success, and a red dot on failure. A short result appears below the tool name.

## Keys

- Enter — submit; during a turn the input is queued and injected at the next safe boundary
- Esc — deny the visible approval and continue; otherwise interrupt the turn, recycle idle queued input, or cancel key entry
- Shift+Enter — insert a line break
- Shift+Tab — switch Allow edits and Full auto
- Mouse wheel or PageUp / PageDown — scroll the conversation in full-screen mode
- Ctrl+End — return to the latest message
- Ctrl+O — open or close transcript view with expanded tool results. Press / to search the conversation
- Ctrl+R — search input history and recall a draft
- Home / End or Ctrl+A / Ctrl+E — move to the start or end of the current input line
- Ctrl+C — interrupt while a turn runs; at the prompt, press twice to exit
- ↑ / ↓ — recall earlier input, select completions, or scroll a diff
- 1 / 2 / 3 — allow once, remember for this session, or deny a pending tool approval

Supported interactive terminals use the full terminal height and pin the prompt at the bottom. The tab title starts as `budingx` and takes a short label from the first substantive prompt. A filled dot signals an active turn, including when an approval is pending. `/clear` resets the topic. The status bar works even when the terminal suppresses tab titles.

A cancelled turn keeps the text that was already produced. A turn cancelled before any output returns the original request to the prompt. Failed turns leave the conversation unchanged.

## Workspace tools

A tool-enabled model can use `Read`, `Glob`, `Grep`, `Write`, and `Edit` in your working directory. Use `@path#L10-20` for a line range or `@"folder/file name.txt"` for a path with spaces. Tab completes paths.

`WebSearch` uses Bing's public search feed when `BUDINGX_TAVILY_API_KEY` is unset, and uses Tavily when the key is set. A tool-enabled model can request a search. Approval follows the permission mode: full access sends the query without prompting, while workspace-edit and read-only ask each time and can remember the choice for the session. Search returns up to five URLs and snippets. For multiple questions or a multiple-select question, confirm the answer summary with Enter. Press Left or Shift+Tab to return to the questions.

Interactive sessions default to Allow edits. Full auto (full access) also allows reading and writing paths outside the workspace; the read-only and allow-edits modes keep the workspace boundary. The `~/.budingx` data root and credential-shaped files stay off-limits in every mode, and writing inside `.git` still needs confirmation. Ordinary workspace writes run directly, and sensitive targets require approval. Use `/permission edit|full` or Shift+Tab to change modes. For an approval, use Up/Down to review the diff and 1 or 3 to allow once or deny. An approval shows 2 only when session memory is available for that operation. Use `/rules` to manage permission rules and `/denials` to inspect refusals.

Use `/diff` to browse session changes, individual turns, and Git working tree changes when Git is available. Use `/undo` to revert the latest change group or `/undo PATH` to revert the most recent change to one file. Undo stops on a file that changed externally.

## Scope

Workspace text tools, session-local undo and session transcript persistence are available. Command execution, teams, Computer Use and scheduling are planned. Desktop, VS Code, remote/H5 access and IM adapters remain deferred under roadmap r6.

User data is stored under `~/.budingx` only. Session transcripts live in `~/.budingx/sessions/<session ID>/` and project/session memory in `~/.budingx/memory/`; both are written atomically and only readable and writable by the current user. The program never reads, falls back to or writes `~/.claude`.

The release workflow verifies Windows and Linux tests plus real tarball installation. The distribution lifecycle gate additionally installs the tarball into an isolated prefix, upgrades over a previous release with real user data, uninstalls it and rolls back to the previous version. macOS installation is not yet certified.

Source and roadmap: https://github.com/Limingyang01/budingx-next

## Permission mode preference

In an interactive terminal, `/permission edit|full` or Shift+Tab saves your choice to `~/.budingx/permission-mode.json`. Sessions restore Allow edits or Full auto across workspaces. The badges are yellow and red respectively. Invalid or legacy read-only preferences default to Allow edits. Corrupt permission rules start the session with writes locked. Pipe and `--prompt` invocations start in read-only mode.
