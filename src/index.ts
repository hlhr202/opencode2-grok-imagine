import type { Plugin } from "@opencode/plugin"
import type { Info, ToolContext } from "@opencode/plugin/promise/tool"
import { createClient, type GrokOptions } from "./client.js"
import { IMAGE_MODEL_DESCRIPTION, IMAGE_MODELS, VIDEO_MODEL_DESCRIPTION, VIDEO_MODELS } from "./models.js"
import { createImageTool, createVideoTool, IMAGE_DESCRIPTION, VIDEO_DESCRIPTION, OUTPUT_DIR_DESCRIPTION } from "./tools.js"

function v1Result(result: Awaited<ReturnType<Info["execute"]>>, title: string) {
  const content = result.content
  if (!Array.isArray(content)) return { title, output: typeof content === "string" ? content : "", metadata: result.metadata, attachments: [] }
  return {
    title,
    output: content.filter((item) => item.type === "text").map((item) => item.text).join("\n"),
    metadata: result.metadata,
    attachments: content.filter((item) => item.type === "file")
      .map(({ mime, uri, name }) => ({ type: "file" as const, mime, url: uri, filename: name })),
  }
}

// OpenCode 1 calls server(); OpenCode 2 calls setup() without loading the V1 API.
async function server(input: { directory: string }, options: GrokOptions = {}): Promise<{ tool: Record<string, unknown> }> {
  const { tool } = await import("@opencode-ai/plugin")
  const z = tool.schema
  let client: ReturnType<typeof createClient> | undefined
  const getClient = () => (client ??= createClient(options))

  return {
    tool: {
      grok_image: tool({
        description: IMAGE_DESCRIPTION,
        args: {
          prompt: z.string().describe("Text description of the image to generate."),
          model: z.enum(IMAGE_MODELS).optional().describe(IMAGE_MODEL_DESCRIPTION),
          count: z.number().int().min(1).max(4).optional(),
          output_dir: z.string().optional().describe(OUTPUT_DIR_DESCRIPTION),
        },
        async execute(args, context) {
          const definition = createImageTool(getClient, async () => context.directory || input.directory)
          const bridge = {
            sessionID: "",
            signal: context.abort,
            progress: async ({ status }: { status: string }) => { context.metadata({ title: status }) },
          } as ToolContext
          const result = await definition.execute(args, bridge)
          return v1Result(result, "Grok image(s) saved")
        },
      }),
      grok_video: tool({
        description: VIDEO_DESCRIPTION,
        args: {
          prompt: z.string().describe("Text description of the video, or the motion to apply when animating an image."),
          model: z.enum(VIDEO_MODELS).optional().describe(VIDEO_MODEL_DESCRIPTION),
          image: z.string().optional().describe("Local path, http(s) URL, or data URI to animate."),
          duration: z.number().int().min(1).max(30).optional(),
          aspect_ratio: z.string().optional().describe('Aspect ratio, e.g. "16:9" or "9:16".'),
          resolution: z.string().optional().describe('Resolution, e.g. "720p".'),
          output_dir: z.string().optional().describe(OUTPUT_DIR_DESCRIPTION),
          timeout_seconds: z.number().int().min(30).max(1800).optional(),
        },
        async execute(args, context) {
          const definition = createVideoTool(getClient, async () => context.directory || input.directory)
          const bridge = {
            sessionID: "",
            signal: context.abort,
            progress: async ({ status }: { status: string }) => { context.metadata({ title: status }) },
          } as ToolContext
          const result = await definition.execute(args, bridge)
          return v1Result(result, "Grok video saved")
        },
      }),
    },
  }
}

export const GrokImaginePlugin = {
  id: "grok-imagine",
  async setup(ctx: Plugin.Context) {
    // Keep credentials optional at load time: only create the HTTP client when a
    // tool is used, so an unconfigured plugin can still load successfully.
    let client: ReturnType<typeof createClient> | undefined
    const getClient = () => (client ??= createClient(ctx.options as GrokOptions))
    const getDirectory = async (sessionID: Parameters<typeof ctx.session.get>[0]["sessionID"]) =>
      (await ctx.session.get({ sessionID })).location.directory

    await ctx.tool.transform((editor) => {
      editor.add(createImageTool(getClient, getDirectory))
      editor.add(createVideoTool(getClient, getDirectory))
    })
  },
  server,
}

export default GrokImaginePlugin
