# PrimeAI for Astra

PrimeAI gives Astra free access to AI models. Install the plugin, pick PrimeAI as the AI provider, and chat without your own API keys or paid subscriptions.

What you get:

- **Free AI chat** — text models with automatic route selection, or a model you pick yourself.
- **Screenshots and images in chat** — attach or paste a screenshot in Astra's chat and the model sees it (vision models).
- **Web search** — answers with fresh results from the internet.
- **Image and video generation** — on request, right in the chat.
- **Task instructions** — a server library of guides the assistant reads when a task needs them.

## ⚠️ Changed on install: Tool Search is turned off

On its first start after installation, PrimeAI switches off Astra's **Tool Search** setting (`Enable Tool Search`, `tool_search.enabled = false`). With Tool Search on, Astra hides most tools behind a search step and models call them with guessed arguments; with it off, the model receives every tool with its schema.

This happens once per installation. If you turn Tool Search back on in Astra's settings, PrimeAI leaves your choice alone. If Astra does not accept the change live, the plugin writes it to Astra's `settings.json`, and it applies after Astra restarts.

## How screenshots reach the model

Astra's plugin protocol passes only text to an AI provider plugin, so chat attachments are normally lost. PrimeAI reads them from Astra's own chat event stream on the local daemon, the same one Astra's window uses, and re-attaches them to the matching message before sending the request. Images stay in memory only while the plugin runs and are not saved to disk.

## Settings

The plugin page lets you choose the text, image and video models, check the connection, and toggle **Краткие ответы** (short answers, on by default).

The plugin connects to `https://sphereprime.online` automatically using short-lived sessions. No shared server key is included in the source or bundle. To use a different deployment, create `deployment.json` in the installed plugin directory:

```json
{
  "serverUrl": "https://<host>/",
  "pluginToken": ""
}
```

## Reliability

Chat requests retry temporary connection failures, HTTP 5xx and incomplete streams up to three attempts before any response content is delivered. After output starts, provider fallback continues on the server with the original conversation and partial answer. Generation requests are not repeated. Known routing failures report unavailable providers, timeouts or stream interruptions without exposing upstream details.

Model availability follows normal request outcomes; failed models are checked for recovery once per minute, and the list syncs every 30 seconds.

## Tools

- `primeai_web_search` — `query` and an optional `limit` from 1 to 10. Built-in Astra `web_search` calls are redirected when PrimeAI provides the model.
- `primeai_generate_image`, `primeai_generate_video` — generated files are available for 24 hours.
- `primeai_search_instructions`, `primeai_read_instruction` — search the instruction library and read a module by `id` (`offset`/`limit` up to 16000 characters; follow `nextOffset`).

## Build

```sh
bun install
bun run typecheck
bun run test
bun run bundle
```

Output: `dwertyfa-prime-ai-<version>-noarch.astraplugin`.

## Releases

Set the version with `astra-plugin version <version>`, commit, and push the matching `v<version>` tag. GitHub Actions calls Astra's pinned release workflow to build, attest, and publish the bundle. Local bundles are for manual installation.
