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

Choose a provider template, paste an API key into the hidden field, and press Enter to load model IDs. Custom accepts a compatible base URL and a manually entered or discovered model ID. Save retains the profile. Save and use also selects it for the conversation. Keys stay separate from profile configuration and are bound to the profile and host. `/provider` has been removed in 0.3.1.

In piped input, `/models` lists profiles and `/model NAME` selects one. Interactive changes to profiles are available in the manager. See the repository's PRODUCT.md for examples and permissions.

## Commands

- /help — help
- /config — show endpoint, model, key state (masked) and the configuration source
- /models — open the model manager (list profiles in a pipe)
- /model NAME — switch the model; the conversation is kept and the switch applies from the next turn
- /clear — clear the in-memory conversation and its visible transcript (input history and pending prompts remain)
- /exit or /quit — exit

## Keys

- Enter — submit; during a turn the input is queued and injected at the next safe boundary
- Esc — deny the visible approval and continue; otherwise interrupt the turn, recycle idle queued input, or cancel key entry
- Shift+Enter — insert a line break
- Ctrl+C — interrupt while a turn runs; at the prompt, press twice to exit
- ↑ / ↓ — recall earlier input, select completions, or scroll a diff
- 1 / 2 / 3 — allow once, remember for this session, or deny a pending tool approval

A cancelled turn keeps the text that was already produced. A turn cancelled before any output returns the original request to the prompt. Failed turns leave the conversation unchanged.

## Workspace tools

A tool-enabled model can use `Read`, `Glob`, `Grep`, `Write`, and `Edit` in your working directory. Use `@path#L10-20` for a line range or `@"folder/file name.txt"` for a path with spaces. Tab completes paths.

Start in read-only mode. Use `/permission read|workspace|full` or Shift+Tab to change modes. In workspace mode, review the proposed diff with Up/Down, then press 1 to allow once, 2 to remember the target for the session, or 3 to deny. Use `/rules` to manage permission rules and `/denials` to inspect refusals.

Use `/diff` to browse session changes, individual turns, and Git working tree changes when Git is available. Use `/undo` to revert the latest change group or `/undo PATH` to revert the most recent change to one file. Undo stops on a file that changed externally.

## Scope

Workspace text tools and session-local undo are available. Command execution, transcript persistence, teams, Computer Use and scheduling are planned. Desktop, VS Code, remote/H5 access and IM adapters remain deferred under roadmap r6.

User data is stored under `~/.budingx` only. The session itself stays in memory and is lost when you exit.

The release workflow verifies Windows and Linux tests plus real tarball installation. macOS installation is not yet certified. Update with npm install -g budingx@latest; uninstall with npm uninstall -g budingx.

Source and roadmap: https://github.com/Limingyang01/budingx-next
