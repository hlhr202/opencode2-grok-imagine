import type { Info, ToolContext } from "@opencode/plugin/promise/tool"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { createClient } from "./client.js"
import {
  IMAGE_MODEL_DESCRIPTION,
  VIDEO_MODEL_DESCRIPTION,
  IMAGE_MODELS,
  VIDEO_MODELS,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  normalizeModel,
} from "./models.js"
import { attachment, imageType, resolveImageUrl, resolveOutDir, slug, sleep } from "./util.js"

type Client = ReturnType<typeof createClient>
type GetDirectory = (sessionID: ToolContext["sessionID"]) => Promise<string>

interface ImageArgs {
  prompt: string
  model?: string
  count?: number
  output_dir?: string
}

interface VideoArgs {
  prompt: string
  model?: string
  image?: string
  duration?: number
  aspect_ratio?: string
  resolution?: string
  output_dir?: string
  timeout_seconds?: number
}

interface ImageResponse {
  data?: { b64_json?: string; b64?: string; url?: string }[]
}

interface VideoResponse {
  request_id?: string
  id?: string
  status?: string
  progress?: number
  video?: { url?: string; duration?: number }
  data?: { url?: string }[]
  url?: string
}

const OUTPUT_DIR_DESCRIPTION =
  "Where to save. For real project assets, set this to the correct path (e.g. 'assets/img' or 'public/videos'), absolute or relative to the session directory. Omit for scratch/experimental generation, which goes to a self-gitignored .grok-tmp folder."

export function createImageTool(getClient: () => Client, getDirectory: GetDirectory): Info {
  return {
    name: "grok_image",
    description:
      "Generate one or more still images with xAI Grok Imagine and save them to disk. Use for pictures, illustrations, art, thumbnails, or concept frames from a text prompt. For animated clips use grok_video instead.",
    input: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Text description of the image to generate." },
        model: { type: "string", enum: [...IMAGE_MODELS], description: IMAGE_MODEL_DESCRIPTION },
        count: { type: "integer", minimum: 1, maximum: 4, description: "How many images (1-4, default 1)." },
        output_dir: { type: "string", description: OUTPUT_DIR_DESCRIPTION },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const args = input as ImageArgs
      const model = normalizeModel(args.model, "image") || DEFAULT_IMAGE_MODEL
      const body: { model: string; prompt: string; n?: number } = { model, prompt: args.prompt }
      if (args.count && args.count > 1) body.n = args.count

      await context.progress({ status: `Generating image (${model})` })
      const client = getClient()
      const res = await client.request(
        "/images/generations",
        { method: "POST", body: JSON.stringify(body) },
        context.signal,
      )
      const json = (await res.json()) as ImageResponse
      const items = Array.isArray(json.data) ? json.data : []
      if (!items.length) throw new Error(`No image returned: ${JSON.stringify(json).slice(0, 300)}`)

      const outDir = await resolveOutDir(args.output_dir, await getDirectory(context.sessionID))
      const stamp = Date.now()
      const paths: string[] = []
      const attachments: ReturnType<typeof attachment>[] = []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        const name = `grok-image-${stamp}-${i + 1}`
        let file: string
        let mime: string
        const raw = item.b64_json ?? item.b64
        if (raw) {
          const b64 = raw.replace(/^data:[^;]+;base64,/, "")
          const type = imageType(b64)
          mime = type.mime
          file = join(outDir, `${name}.${type.ext}`)
          await writeFile(file, Buffer.from(b64, "base64"))
        } else if (item.url) {
          mime = "image/png"
          file = join(outDir, `${name}.png`)
          await writeFile(file, await client.download(item.url, context.signal))
        } else {
          throw new Error(`Image item ${i} had neither b64_json nor url`)
        }
        paths.push(file)
        attachments.push(attachment(file, mime))
      }

      return {
        content: [
          { type: "text", text: `Saved ${paths.length} image(s) with ${model}:\n${paths.map((p) => `- ${p}`).join("\n")}` },
          ...attachments,
        ],
        metadata: { model, prompt: args.prompt, files: paths },
      }
    },
  }
}

export function createVideoTool(getClient: () => Client, getDirectory: GetDirectory): Info {
  return {
    name: "grok_video",
    description:
      "Generate a short video with xAI Grok Imagine. Submits the job, polls until rendering finishes, then downloads the mp4 to disk. Works in two modes: text-to-video from a prompt, or image-to-video by also passing an `image` to animate. For still images use grok_image instead.",
    input: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Text description of the video, or the motion to apply when animating an image." },
        model: { type: "string", enum: [...VIDEO_MODELS], description: VIDEO_MODEL_DESCRIPTION },
        image: { type: "string", description: "Optional local path (relative to the session directory), http(s) URL, or data URI to animate." },
        duration: { type: "integer", minimum: 1, maximum: 30, description: "Clip duration in seconds, if supported." },
        aspect_ratio: { type: "string", description: 'Aspect ratio, e.g. "16:9" or "9:16".' },
        resolution: { type: "string", description: 'Resolution, e.g. "720p".' },
        output_dir: { type: "string", description: OUTPUT_DIR_DESCRIPTION },
        timeout_seconds: { type: "integer", minimum: 30, maximum: 1800, description: "Polling timeout in seconds (default 900)." },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    async execute(input, context) {
      const args = input as VideoArgs
      const model = normalizeModel(args.model, "video") || DEFAULT_VIDEO_MODEL
      const directory = await getDirectory(context.sessionID)
      const body: Record<string, unknown> = { model, prompt: args.prompt }
      if (args.image) body.image = { url: await resolveImageUrl(args.image, directory) }
      if (args.duration) body.duration = args.duration
      if (args.aspect_ratio) body.aspect_ratio = args.aspect_ratio
      if (args.resolution) body.resolution = args.resolution

      const mode = args.image ? "image-to-video" : "text-to-video"
      await context.progress({ status: `Submitting ${mode} (${model})` })
      const client = getClient()
      const submitRes = await client.request(
        "/videos/generations",
        { method: "POST", body: JSON.stringify(body) },
        context.signal,
      )
      const submit = (await submitRes.json()) as VideoResponse
      const requestId = submit.request_id ?? submit.id
      if (!requestId) throw new Error(`No request_id returned: ${JSON.stringify(submit).slice(0, 300)}`)

      const started = Date.now()
      const maxWaitMs = (args.timeout_seconds ?? 900) * 1000
      let last: VideoResponse
      while (true) {
        if (Date.now() - started > maxWaitMs) {
          throw new Error(
            `Video timed out after ${Math.round((Date.now() - started) / 1000)}s (request ${requestId})`,
          )
        }
        const pollRes = await client.request(`/videos/${requestId}`, { method: "GET" }, context.signal)
        last = (await pollRes.json()) as VideoResponse
        const status = last.status
        if (status === "failed" || status === "error") {
          throw new Error(`Video failed: ${JSON.stringify(last).slice(0, 300)}`)
        }
        await context.progress({ status: `Rendering video… ${last.progress ?? 0}%`, requestId, progress: last.progress })
        if (status === "done" || last.video?.url || last.data?.[0]?.url || last.url) break
        await sleep(5000, context.signal)
      }

      const url = last.video?.url ?? last.data?.[0]?.url ?? last.url
      if (!url) throw new Error(`No video URL in response: ${JSON.stringify(last).slice(0, 300)}`)

      const outDir = await resolveOutDir(args.output_dir, directory)
      const file = join(outDir, `grok-video-${Date.now()}-${slug(args.prompt)}.mp4`)
      await writeFile(file, await client.download(url, context.signal))

      return {
        content: [
          { type: "text", text: `Saved video with ${model}: ${file}\nSource URL (temporary): ${url}` },
          attachment(file, "video/mp4"),
        ],
        metadata: { model, prompt: args.prompt, requestId, file, duration: last.video?.duration },
      }
    },
  }
}
