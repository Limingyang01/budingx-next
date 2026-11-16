# budingx

An independent **MIT** terminal chat client for OpenAI-compatible APIs. Version 0.1.0 is an early chat-only preview, not a full coding Agent.

## Install

Requires **Node.js >=22.18** and npm. Bun and a running desktop app are not required.

```powershell
npm install -g budingx
budingx --help
```

## Configure and run

In PowerShell, set your own API endpoint, model and key. Use a trusted HTTPS endpoint; HTTP is permitted only for explicit localhost/loopback development endpoints.

```powershell
$env:BUDINGX_BASE_URL = "https://api.openai.com/v1"
$env:BUDINGX_MODEL = "YOUR_MODEL_NAME"
$env:BUDINGX_API_KEY = "YOUR_API_KEY"
budingx
```

These are placeholders. Never commit real keys or place them in command arguments. Only BUDINGX_* variables are read; the client does not discover keys or configuration from other tools. Keys are never printed by /config. Changing /endpoint removes the in-memory key to avoid forwarding it to another host; restart with the intended key when needed.

```powershell
budingx --model YOUR_MODEL_NAME --base-url https://YOUR_PROVIDER/v1
budingx --prompt "Hello" --timeout 120000
```

The base URL is the provider API prefix; the client appends /chat/completions. The provider must return text/event-stream SSE and a [DONE] terminator. No Responses API, reasoning-only or tool-only response support is claimed.

## Commands

- /help — help
- /config — show endpoint/model and whether a key is set, without the key
- /model NAME — change model and clear conversation
- /endpoint URL — change endpoint, clear conversation and remove key
- /clear — clear in-memory conversation
- /exit or /quit — exit
- Ctrl+C — cancel a response; at the prompt, exit

Input is line-based. Session history stays in memory and is lost when you exit. Failed/cancelled turns are not saved. Up to 12 successful turns and bounded input/answer sizes are supported; use /clear for a fresh session. This preview has no saved model list or config wizard, coding tools, file/terminal access, history persistence, shared runtime, teams, Computer Use, remote access, IM or scheduling.

The future managed user-data root is resolved from the current user's home as ~/.budingx (never a hard-coded username). This preview does not write user data there, and never reads ~/.claude.

Initial verification is on Windows. macOS/Linux support is not yet installation-certified. Update with npm install -g budingx@latest; uninstall with npm uninstall -g budingx. Uninstalling does not delete unrelated user data.

Source and roadmap: https://github.com/Limingyang01/budingx-next
