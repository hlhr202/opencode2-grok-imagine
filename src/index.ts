import { Plugin } from "@opencode/plugin"
import { createClient, type GrokOptions } from "./client.js"
import { createImageTool, createVideoTool } from "./tools.js"

export const GrokImaginePlugin = Plugin.define({
  id: "grok-imagine",
  async setup(ctx) {
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
})

export default GrokImaginePlugin
