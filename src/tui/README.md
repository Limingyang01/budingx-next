# budingx

An independent **MIT** terminal agent for OpenAI-compatible APIs. Version 0.3.2 adds MiniMax China and Qwen Token Plan templates and fixes MiniMax connection testing. Version 0.3.1 introduced the model manager. It includes the workspace file tools, file references, approval previews and session undo introduced in 0.3.0.

## Install

Requires **Node.js >=22.18** and npm. Bun and a running desktop app are not required.

```powershell
npm install -g budingx
budingx --help
```

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
- /exit or /quit — exit

Version 0.3.4 displays user turns, elapsed time and completion time. After a successful reply, press Tab at an empty prompt to fill the suggested follow-up, then edit and press Enter.

Version 0.3.5 distinguishes submitted prompts from Markdown replies and displays completion times as secondary text. The status bar shows a short permission label and omits idle activity.

The active turn indicator sits above the input. Tool rows use a pulsing theme dot while pending, a green dot on success, and a red dot on failure. A short result appears below the tool name.

## Keys

- Enter — submit; during a turn the input is queued and injected at the next safe boundary
- Esc — deny the visible approval and continue; otherwise interrupt the turn, recycle idle queued input, or cancel key entry
- Shift+Enter — insert a line break
- Shift+Tab — switch Allow edits and Full auto
- Mouse wheel or PageUp / PageDown — scroll the conversation in full-screen mode
- Ctrl+End — return to the latest message
- Ctrl+C — interrupt while a turn runs; at the prompt, press twice to exit
- ↑ / ↓ — recall earlier input, select completions, or scroll a diff
- 1 / 2 / 3 — allow once, remember for this session, or deny a pending tool approval

Supported interactive terminals use the full terminal height and pin the prompt at the bottom. The tab title starts as `budingx` and takes a short label from the first substantive prompt. A filled dot signals an active turn, including when an approval is pending. `/clear` resets the topic. The status bar works even when the terminal suppresses tab titles.

A cancelled turn keeps the text that was already produced. A turn cancelled before any output returns the original request to the prompt. Failed turns leave the conversation unchanged.

## Workspace tools

A tool-enabled model can use `Read`, `Glob`, `Grep`, `Write`, and `Edit` in your working directory. Use `@path#L10-20` for a line range or `@"folder/file name.txt"` for a path with spaces. Tab completes paths.

Interactive sessions default to Allow edits. Ordinary workspace writes run directly, and sensitive targets require approval. Use `/permission edit|full` or Shift+Tab to change modes. For an approval, use Up/Down to review the diff and 1 or 3 to allow once or deny. Use `/rules` to manage permission rules and `/denials` to inspect refusals.

Use `/diff` to browse session changes, individual turns, and Git working tree changes when Git is available. Use `/undo` to revert the latest change group or `/undo PATH` to revert the most recent change to one file. Undo stops on a file that changed externally.

## Scope

Workspace text tools and session-local undo are available. Command execution, transcript persistence, teams, Computer Use and scheduling are planned. Desktop, VS Code, remote/H5 access and IM adapters remain deferred under roadmap r6.

User data is stored under `~/.budingx` only. The session itself stays in memory and is lost when you exit.

The release workflow verifies Windows and Linux tests plus real tarball installation. macOS installation is not yet certified. Update with npm install -g budingx@latest; uninstall with npm uninstall -g budingx.

Source and roadmap: https://github.com/Limingyang01/budingx-next

## Permission mode preference

In an interactive terminal, `/permission edit|full` or Shift+Tab saves your choice to `~/.budingx/permission-mode.json`. Sessions restore Allow edits or Full auto across workspaces. The badges are yellow and red respectively. Invalid or legacy read-only preferences default to Allow edits. Corrupt permission rules start the session with writes locked. Pipe and `--prompt` invocations start in read-only mode.
