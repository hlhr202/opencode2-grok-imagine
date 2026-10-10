# opencode2-grok-imagine

Generate images and videos with Grok Imagine from
[OpenCode 2](https://opencode.ai/v2/docs/), using a compatible API endpoint.

This package is based on
[opencode-grok-imagine-plugin](https://github.com/caoool/opencode-grok-imagine-plugin).
It updates the original plugin to TypeScript and the OpenCode 2 plugin API while
keeping its image and video generation features.

This adaptation is maintained by [hlhr202](https://github.com/hlhr202).

## What it does

Grok Imagine uses image and video endpoints rather than the chat endpoint used
by OpenCode models. This plugin adds tools that call those endpoints and save
the results as local files:

| Tool | Use it for | Default model |
| --- | --- | --- |
| `grok_image` | Generating still images | `grok-imagine-image-quality` |
| `grok_video` | Text-to-video or image-to-video | `grok-imagine-video` |

Video generation runs asynchronously: the plugin submits the request, polls for
completion, and downloads the resulting MP4.

## Install

Once the package is published, add it to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode2-grok-imagine"]
}
```

If you previously used `opencode-grok-imagine-plugin`, replace that entry. Do
not load both packages together. The old package's 0.1.x releases are for
OpenCode 1.

## Configure

Set the endpoint and API key in the OpenCode server's environment:

```bash
export GROK_IMAGINE_BASE_URL="https://your-proxy.example.com"
export GROK_IMAGINE_API_KEY="your-api-key"
```

`CPA_BASE_URL` and `CPA_API_KEY` are also supported. The base URL can include
or omit `/v1`.

Alternatively, pass the base URL as a plugin option:

```json
{
  "plugins": [
    {
      "package": "opencode2-grok-imagine",
      "options": {
        "baseURL": "https://your-proxy.example.com"
      }
    }
  ]
}
```

Plugin options take precedence over environment variables. An `apiKey` option
is available, but keeping secrets in the server environment is recommended.

TLS verification is enabled by default. `insecureTLS` /
`GROK_IMAGINE_INSECURE_TLS=1` is intended only for self-signed proxies you
control. Bun supports the per-request setting; Node's `fetch` does not, so
disabling verification under Node requires `NODE_TLS_REJECT_UNAUTHORIZED=0`
for the server process, which affects all its requests.

## Usage

Ask your agent for what you want to create:

| Request | Tool | Notes |
| --- | --- | --- |
| “Generate an image of a blue origami crane.” | `grok_image` | Creates a still image |
| “Create a short video of a spinning maple leaf.” | `grok_video` | Text-to-video |
| “Animate `assets/crane.png` so its wings move.” | `grok_video` | Passes the file as `image` for image-to-video |

### Image options

`grok_image` requires a `prompt`. Optional arguments:

| Argument | Purpose |
| --- | --- |
| `model` | `grok-imagine-image-quality` (default) or `grok-imagine-image` |
| `count` | Number of images, 1–4 |
| `output_dir` | Directory for saved images |

### Video options

`grok_video` requires a `prompt`. Optional arguments:

| Argument | Purpose |
| --- | --- |
| `model` | `grok-imagine-video` (default) or `grok-imagine-video-1.5-preview` |
| `image` | Local path, HTTP(S) URL, or data URI to animate; omit for text-to-video |
| `duration` | Requested duration, 1–30 seconds, if supported upstream |
| `aspect_ratio` | For example, `16:9` or `9:16` |
| `resolution` | For example, `720p` |
| `output_dir` | Directory for the saved MP4 |
| `timeout_seconds` | Maximum polling time, 30–1800 seconds; default 900 |

Some upstream implementations require an `image` when using
`grok-imagine-video-1.5-preview`. Model availability depends on your endpoint
and account.

### Saved files

Set `output_dir` (for example, `assets/img` or `public/videos`) to save files
with your project. Relative paths resolve from the current OpenCode session
directory.

Without `output_dir`, files go into a self-gitignored `.grok-tmp/` directory
under the session directory.

## Development

This project uses pnpm. Run `pnpm install`, `pnpm typecheck`, `pnpm test`, and
`pnpm build` to validate a local checkout. To load a local build, add the
package directory to `plugins` and rebuild after source changes.

## Acknowledgements

Based on [opencode-grok-imagine-plugin](https://github.com/caoool/opencode-grok-imagine-plugin)
by [Lu Cao (@caoool)](https://github.com/caoool). Thank you for the original
implementation and the Grok Imagine image and video workflows.

## License

MIT licensed. Original plugin © 2026 Lu Cao; OpenCode 2 adaptation © 2026
hlhr202. See [LICENSE](LICENSE) for the copyright notices.
