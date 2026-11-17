# budingx

An independent **MIT** terminal coding agent for OpenAI-compatible APIs. Version `0.2.0` (SP002) is published on npm as `latest`, adding model profiles, the Ink conversation interface and the session core. GitHub Actions verified Windows/Linux, published through OIDC, and the official package passed an independent Windows install and HTTP smoke. Coding tools, file and terminal access land in later releases.

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

Profiles live in `~/.budingx` (resolved from the current user's home; never `~/.claude`). Configuration is stored in `~/.budingx/config.json`, credentials separately in `~/.budingx/credentials.json` so exporting or sharing the configuration never carries a key.

```powershell
budingx
/provider add work https://api.example.com/v1 my-model
/provider key work
# Enter the key in the hidden prompt, then press Enter
/provider check work
/provider default work
/models
/model work
/provider rm work
```

Edit syntax: `/provider edit NAME NEW_LABEL BASE_URL MODEL` (all fields required; labels cannot contain spaces). Editing the active profile updates its request configuration; changing hosts clears the active key. Removing the active profile requires selecting another model. Boundary commands are serialized with later prompts; automatic queue starts wait for commands and hidden key entry to finish.

Each profile owns its own key, bound to the profile id **and** the base URL host. Changing the host drops the binding, so a key is never forwarded to a different server. Keys are never printed: `/config` shows only the last four characters.

## Commands

- /help — help
- /config — show endpoint, model, key state (masked) and the configuration source
- /models — list stored model profiles
- /model NAME — switch the model; the conversation is kept and the switch applies from the next turn
- /provider add|edit|rm|check — manage and verify model profiles
- /provider key NAME — hidden key entry/update (interactive terminal only; Esc cancels)
- /provider default NAME — persist the startup default
- /provider tools NAME on|off — set the profile tool capability flag
- /provider orphans [clean] — count orphan credentials; explicitly clean with `clean`
- /clear — clear the in-memory conversation and its visible transcript (input history and pending prompts remain)
- /exit or /quit — exit

## Keys

- Enter — submit; during a turn the input is queued and injected at the next safe boundary
- Esc — deny the visible approval and continue; otherwise interrupt the turn, recycle idle queued input, or cancel key entry
- Shift+Enter — insert a line break
- Ctrl+C — interrupt while a turn runs; at the prompt, press twice to exit
- ↑ / ↓ — recall earlier input
- y / n — allow or deny a pending tool approval

A cancelled turn keeps the text that was already produced. A turn cancelled before any output returns the original request to the prompt. Failed turns leave the conversation unchanged.

## Scope

The session, event contract, provider adapter and model profiles exist. Real workspace tools, file and terminal access, permission rules (three planned modes: read-only / workspace-write / full-access), transcript persistence, teams, Computer Use and scheduling are **not** implemented yet. Desktop, VS Code, remote/H5 access and IM adapters are **deferred** (roadmap r6, 2026-11-17); multi-surface architecture entry points are retained for future revival.

User data is stored under `~/.budingx` only. The session itself stays in memory and is lost when you exit.

The release workflow verifies Windows and Linux tests plus real tarball installation. macOS installation is not yet certified. Update with npm install -g budingx@latest; uninstall with npm uninstall -g budingx.

Source and roadmap: https://github.com/Limingyang01/budingx-next
