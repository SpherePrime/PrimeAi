# PrimeAI for Astra

AI provider using the Router API with automatic route selection.

Known routing failures report unavailable providers, timeouts or stream interruptions without exposing upstream details.
Chat requests retry temporary connection failures, HTTP 5xx and incomplete streams up to three attempts before any response content is delivered. After output starts, provider fallback continues on the server with the original conversation and partial answer. Completed tool results stay in the history; failed attempts do not publish tool calls. Generation requests are not repeated.

The plugin connects to `https://sphereprime.online` automatically using short-lived sessions. No shared server key is included in the source or bundle.

To use a different deployment, create `deployment.json` in the installed plugin directory:

```json
{
  "serverUrl": "https://<host>/",
  "pluginToken": ""
}
```

Build and package:

```sh
bun install
bun run typecheck
bun run test
bun run bundle
```

Output: `dwertyfa-prime-ai-<version>-noarch.astraplugin`.

## Releases

Set the version with `astra-plugin version <version>`, commit, and push the matching `v<version>` tag. GitHub Actions calls Astra's pinned release workflow to build, attest, and publish the bundle. Local bundles are for manual installation.

## Image input

The bridge accepts OpenAI `text` and `image_url` content parts and preserves images throughout conversation history. Vision models are labeled in the model picker.

Astra SDK 0.7.0 exposes only string message content in its protobuf protocol. Native Astra chat attachments cannot reach this plugin until the host and SDK add multimodal messages. Bridge support alone does not enable attachments in Astra.

## Web search

PrimeAI 0.2.1 uses the server's DuckDuckGo MCP search. The `primeai_web_search` tool accepts `query` and an optional `limit` from 1 to 10. Built-in Astra `web_search` calls are redirected when PrimeAI provides the model. Update the plugin to enable this behavior.
