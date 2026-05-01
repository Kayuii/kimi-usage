# Kimi Usage

A VSCode (and Trae IDE) extension that shows your **Kimi Code** weekly / session / rate-window quota in the status bar — using the same **OAuth device-code** sign-in flow as the official `kimi-cli`. No browser extension, no API key copy-paste, and tokens are auto-refreshed for you.

Inspired by:
- [`yur1y/kimi-quota-tracker`](https://github.com/yur1y/kimi-quota-tracker) — the quota math and status-bar layout
- [`MoonshotAI/kimi-cli`](https://github.com/MoonshotAI/kimi-cli) — the OAuth device-flow protocol

## Features

- 🟢 **Status bar at a glance** — `🟢 Kimi 37% | 1.2k tok` with pace-aware traffic-light colour
- 📊 **Detailed dashboard** — weekly quota, rate-limit window, session counters in a Webview
- 🔐 **OAuth device sign-in** — one-click `Sign In`, confirm in the browser, never paste a token. Refresh tokens are stored in the OS keychain and rotated automatically before they expire.
- 🔑 **Optional API key fallback** — paste an `sk-...` key from the [Kimi Code console](https://www.kimi.com/code/console) if you prefer (kept in SecretStorage, never written to settings).
- 🔁 **Auto-refresh** with a configurable interval
- 🧮 **Per-session counters** — call `kimiUsage.recordUsage` from your own code to track spend in real time

## Status bar reference

| Status bar | Meaning |
|---|---|
| 🟢 `Kimi 37% \| 1.2k tok` | 37 % of weekly quota used, **under** pace |
| 🟡 `Kimi 55% \| 3 req` | Slightly **ahead** of pace |
| 🔴 `Kimi 80% \| 12k tok` | Over-consuming, risk of hitting the limit |
| ⚠️ `Kimi: auth failed` | Token rejected (401/403) — click to sign in again |
| 🔑 `Kimi: sign in` | Not configured yet — click to start the OAuth flow |

## Install & run (development)

```bash
# 1. Install dependencies
npm install

# 2. Compile / bundle
npm run compile        # tsc one-shot
# or
npm run watch          # tsc watch
# or
npm run build          # esbuild bundle (dev)
npm run package        # esbuild bundle (production, used by vsce)

# 3. Press F5 in VSCode to launch the Extension Development Host
#    Or package a VSIX:
npm install -g @vscode/vsce
vsce package           # creates kimi-usage-0.1.0.vsix
code --install-extension kimi-usage-0.1.0.vsix
```

## Sign in (OAuth device flow)

1. Run **`Kimi Usage: Sign In`** from the command palette (or click the status-bar item when it shows `Kimi: sign in`).
2. The extension requests a device code from Kimi and shows a notification:
   `visit https://auth.kimi.com/device and confirm code "ABCD-EFGH"` — the code is **already in your clipboard**.
3. Click **Open Browser**, paste the code (already in clipboard), and approve the request on Kimi's site.
4. The extension polls for completion. Once you confirm, you'll see `Kimi sign-in successful` and the status bar starts updating.

The `access_token` and `refresh_token` are persisted in VSCode's [`SecretStorage`](https://code.visualstudio.com/api/references/vscode-api#SecretStorage) (which uses the OS keychain on macOS / libsecret on Linux / Credential Manager on Windows). Tokens are auto-refreshed before each quota poll.

## Optional: long-lived API key

If you'd rather use a long-lived `sk-...` key (each Kimi Code account is limited to **5 active keys** and a leak is high-risk — prefer OAuth):

1. Create a key at <https://www.kimi.com/code/console>.
2. Run **`Kimi Usage: Set API Key (sk-...)`** and paste it.

The key is stored in SecretStorage too — never written to `settings.json`. OAuth, when present, takes precedence.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `kimiUsage.refreshIntervalSeconds` | `60` | Polling interval in seconds (minimum `30`) |
| `kimiUsage.language` | `auto` | Dashboard language: `auto` / `en` / `zh-CN` |

> Credentials are intentionally **not** exposed as settings; they live in SecretStorage and are managed via the `Sign In` / `Sign Out` / `Set API Key` commands.

## Commands

| Command | What it does |
|---|---|
| `Kimi Usage: Refresh` | Force a quota refresh now |
| `Kimi Usage: Sign In (OAuth)` | Start the device-code sign-in flow |
| `Kimi Usage: Sign Out` | Clear stored OAuth tokens and API key |
| `Kimi Usage: Set API Key (sk-...)` | Paste a long-lived API key as a fallback |
| `Kimi Usage: Show Usage Dashboard` | Open the detailed Webview |
| `Kimi Usage: Open Kimi Code Console` | Open <https://www.kimi.com/code/console> |
| `Kimi Usage: Reset Session Counter` | Zero the per-session token / request counters |
| `Kimi Usage: Show Output` | Open the extension's output channel |

## Programmatic per-session tracking

If your own code knows the input/output token counts of a request you just made, call:

```ts
await vscode.commands.executeCommand('kimiUsage.recordUsage', {
  inputTokens: 512,
  outputTokens: 128
});
```

The counters are persisted in `globalState` and surfaced both in the status bar and the dashboard.

## License

MIT
