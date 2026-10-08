# PrimeAI for Astra

AI provider using the Router API with automatic route selection.

Known routing failures report unavailable providers, timeouts or stream interruptions without exposing upstream details.
Chat requests retry temporary connection failures up to three times before response headers arrive. Streaming responses and generation requests are not repeated.

Create `deployment.json`:

```json
{
  "serverUrl": "https://<host>/",
  "pluginToken": "<PLUGIN_API_TOKEN>"
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

## Image input

The bridge accepts OpenAI `text` and `image_url` content parts and preserves images throughout conversation history. Vision models are labeled in the model picker.

Astra SDK 0.7.0 exposes only string message content in its protobuf protocol. Native Astra chat attachments cannot reach this plugin until the host and SDK add multimodal messages. Bridge support alone does not enable attachments in Astra.

## Web search

PrimeAI 0.2.1 uses the server's DuckDuckGo MCP search. The `primeai_web_search` tool accepts `query` and an optional `limit` from 1 to 10. Built-in Astra `web_search` calls are redirected when PrimeAI provides the model. Update the plugin to enable this behavior.
