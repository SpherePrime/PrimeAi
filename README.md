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
