import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "@opencode/plugin"
import type { Info, ToolContext } from "@opencode/plugin/promise/tool"
import {
  IMAGE_MODELS,
  VIDEO_MODELS,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  normalizeModel,
} from "../src/models.js"
import { createClient, resolveConfig } from "../src/client.js"
import { createImageTool, createVideoTool } from "../src/tools.js"
import { resolveImageUrl, sleep } from "../src/util.js"
import GrokImaginePlugin from "../src/index.js"

function toolContext(signal = new AbortController().signal): ToolContext {
  return { sessionID: "session-1", signal, progress: async () => {} } as unknown as ToolContext
}

test("registers both V2 tools with JSON schemas", async () => {
  const definitions: Info[] = []
  const ctx = {
    options: {},
    tool: { transform: async (register: (editor: { add(tool: Info): void }) => void) => {
      register({ add: (tool) => definitions.push(tool) })
    } },
    session: { get: async () => ({ location: { directory: process.cwd() } }) },
  } as unknown as Plugin.Context

  await GrokImaginePlugin.setup(ctx)
  assert.equal(GrokImaginePlugin.id, "grok-imagine")
  assert.deepEqual(definitions.map((tool) => tool.name), ["grok_image", "grok_video"])
  assert.deepEqual(IMAGE_MODELS, ["grok-imagine-image-quality", "grok-imagine-image"])
  assert.deepEqual(VIDEO_MODELS, ["grok-imagine-video", "grok-imagine-video-1.5-preview"])
  const image = definitions[0].input as { properties: Record<string, unknown>; required: string[] }
  const video = definitions[1].input as { properties: Record<string, unknown>; required: string[] }
  assert.deepEqual(image.required, ["prompt"])
  assert.ok("image" in video.properties)
  assert.ok(!("image" in image.properties))
})

test("V1 registers the same tools and argument names as V2", async () => {
  const definitions = [createImageTool(() => createClient(), async () => "/session"),
    createVideoTool(() => createClient(), async () => "/session")]
  const v1 = await GrokImaginePlugin.server({ directory: "/session" })
  assert.deepEqual(Object.keys(v1.tool), ["grok_image", "grok_video"])
  for (const [index, name] of ["grok_image", "grok_video"].entries()) {
    const v1Args = (v1.tool[name] as { args: Record<string, { safeParse(value: unknown): { success: boolean } }> }).args
    const v2Args = (definitions[index].input as { properties: Record<string, unknown> }).properties
    assert.deepEqual(Object.keys(v1Args).sort(), Object.keys(v2Args).sort())
    assert.equal(v1Args.prompt.safeParse(undefined).success, false)
    assert.equal(v1Args.prompt.safeParse("hello").success, true)
  }
  const imageArgs = (v1.tool.grok_image as { args: Record<string, { safeParse(value: unknown): { success: boolean } }> }).args
  assert.equal(imageArgs.count.safeParse(5).success, false)
  const videoArgs = (v1.tool.grok_video as { args: Record<string, { safeParse(value: unknown): { success: boolean } }> }).args
  assert.equal(videoArgs.timeout_seconds.safeParse(29).success, false)
})

test("V1 tools use plugin options, session directory, abort signal, and return file attachments", async () => {
  const dir = await mkdtemp(join(tmpdir(), "grok v1-"))
  const originalFetch = globalThis.fetch
  const controller = new AbortController()
  const calls: { url: string; signal?: AbortSignal; auth?: string; body?: Record<string, unknown> }[] = []
  const status: string[] = []
  globalThis.fetch = async (url, init) => {
    const target = String(url)
    calls.push({ url: target, signal: init?.signal as AbortSignal | undefined,
      auth: new Headers(init?.headers).get("Authorization") ?? undefined,
      body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (target.endsWith("/images/generations")) {
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("image").toString("base64") }] }))
    }
    if (target.endsWith("/videos/generations")) return new Response(JSON.stringify({ request_id: "job-1" }))
    if (target.endsWith("/videos/job-1")) return new Response(JSON.stringify({ status: "done", video: { url: "https://proxy.test/clip.mp4" } }))
    if (target.endsWith("/clip.mp4")) return new Response("video")
    throw new Error(`Unexpected fetch: ${target}`)
  }
  try {
    await writeFile(join(dir, "source.png"), "source")
    const v1 = await GrokImaginePlugin.server({ directory: "/wrong" }, { baseURL: "https://proxy.test", apiKey: "key" })
    type V1Result = { output: string; metadata: Record<string, unknown>; attachments: { url: string; mime: string; filename: string }[] }
    type V1Tool = { execute(args: unknown, context: unknown): Promise<V1Result> }
    const context = { directory: dir, abort: controller.signal, metadata: ({ title }: { title: string }) => status.push(title) }
    const image = await (v1.tool.grok_image as V1Tool).execute({ prompt: "blue crane", output_dir: "assets/img" }, context)
    assert.match(image.output, /Saved 1 image/)
    assert.equal(image.attachments[0].mime, "image/png")
    assert.match(image.attachments[0].url, /grok%20v1-/)
    assert.equal((await readFile(fileURLToPath(image.attachments[0].url))).toString(), "image")
    assert.ok(fileURLToPath(image.attachments[0].url).startsWith(join(dir, "assets/img")))
    assert.equal(image.metadata.model, DEFAULT_IMAGE_MODEL)

    const video = await (v1.tool.grok_video as V1Tool).execute({ prompt: "move", image: "source.png", duration: 5 }, context)
    assert.match(video.output, /Saved video/)
    assert.equal(video.attachments[0].mime, "video/mp4")
    assert.equal((await readFile(fileURLToPath(video.attachments[0].url))).toString(), "video")
    assert.equal(video.metadata.requestId, "job-1")
    assert.deepEqual(calls.map((call) => call.url), [
      "https://proxy.test/v1/images/generations", "https://proxy.test/v1/videos/generations",
      "https://proxy.test/v1/videos/job-1", "https://proxy.test/clip.mp4",
    ])
    assert.equal(calls[0].auth, "Bearer key")
    assert.deepEqual(calls.slice(0, 3).map((call) => call.signal), [controller.signal, controller.signal, controller.signal])
    assert.match((calls[1].body?.image as { url: string }).url, /^data:image\/png;base64,/)
    assert.equal(calls[1].body?.duration, 5)
    assert.ok(status.some((title) => title.includes("Generating image")))
    assert.ok(status.some((title) => title.includes("Rendering video")))
  } finally {
    globalThis.fetch = originalFetch
    await rm(dir, { recursive: true, force: true })
  }
})

test("normalizeModel strips aliases and defaults by kind", () => {
  assert.equal(normalizeModel("xai/grok-imagine-image", "image"), "grok-imagine-image")
  assert.equal(normalizeModel("grok/grok-imagine-video-1.5-preview", "video"), "grok-imagine-video-1.5-preview")
  assert.equal(normalizeModel(undefined, "image"), DEFAULT_IMAGE_MODEL)
  assert.equal(normalizeModel("", "video"), DEFAULT_VIDEO_MODEL)
})

test("resolveImageUrl accepts URLs/data URIs and inlines session-local files", async () => {
  assert.equal(await resolveImageUrl("https://x.test/a.png", process.cwd()), "https://x.test/a.png")
  assert.equal(await resolveImageUrl("data:image/png;base64,AAA", process.cwd()), "data:image/png;base64,AAA")

  const dir = await mkdtemp(join(tmpdir(), "grok-i2v-"))
  try {
    await writeFile(join(dir, "pic.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    assert.match(await resolveImageUrl("pic.png", dir), /^data:image\/png;base64,/)
    await assert.rejects(resolveImageUrl("missing.png", dir), /not found/)
    await assert.rejects(resolveImageUrl("", dir), /non-empty string/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("config precedence, /v1 normalization, and required fields", () => {
  const fromOpts = resolveConfig({ baseURL: "https://a.test/v1", apiKey: "k", insecureTLS: true })
  assert.equal(fromOpts.root, "https://a.test/v1")
  assert.equal(fromOpts.insecureTLS, true)

  const normalized = resolveConfig({ baseURL: "https://b.test", apiKey: "k" })
  assert.equal(normalized.root, "https://b.test/v1")
  assert.equal(normalized.insecureTLS, false)

  const keys = ["GROK_IMAGINE_BASE_URL", "CPA_BASE_URL", "GROK_IMAGINE_API_KEY", "CPA_API_KEY"] as const
  const saved = keys.map((key) => process.env[key])
  for (const key of keys) delete process.env[key]
  try {
    assert.throws(() => resolveConfig({ apiKey: "k" }), /no base URL/)
    assert.throws(() => resolveConfig({ baseURL: "https://c.test" }), /no API key/)
  } finally {
    keys.forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key]
      else process.env[key] = saved[i]
    })
  }
})

test("image tool saves a V2 file content with an escaped URI in the session directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "grok image-"))
  try {
    const client = createClient({ baseURL: "https://proxy.test", apiKey: "test-key" })
    const request = async (path: string, _init: RequestInit, signal?: AbortSignal) => {
      assert.equal(path, "/images/generations")
      assert.equal(signal, context.signal)
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("image").toString("base64") }] }))
    }
    const tool = createImageTool(() => ({ ...client, request }), async () => dir)
    const context = toolContext()
    const result = await tool.execute({ prompt: "blue crane", output_dir: "assets/img" }, context)
    assert.ok(Array.isArray(result.content))
    assert.equal(result.content[1].type, "file")
    if (result.content[1].type !== "file") throw new Error("expected file content")
    const file = fileURLToPath(result.content[1].uri)
    assert.ok(file.startsWith(join(dir, "assets/img")))
    assert.equal((await readFile(file)).toString(), "image")
    assert.match(result.content[1].uri, /grok%20image-/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("video tool submits image-to-video, polls, and returns V2 file content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "grok-video-"))
  try {
    await writeFile(join(dir, "source.png"), "image")
    const client = createClient({ baseURL: "https://proxy.test", apiKey: "test-key" })
    const calls: string[] = []
    const request = async (path: string, init: RequestInit, signal?: AbortSignal) => {
      calls.push(path)
      assert.equal(signal, context.signal)
      if (path === "/videos/generations") {
        const body = JSON.parse(init.body as string)
        assert.match(body.image.url, /^data:image\/png;base64,/)
        return new Response(JSON.stringify({ request_id: "job-1" }))
      }
      return new Response(JSON.stringify({ status: "done", video: { url: "https://proxy.test/video.mp4" } }))
    }
    const download = async () => Buffer.from("video")
    const tool = createVideoTool(() => ({ ...client, request, download }), async () => dir)
    const context = toolContext()
    const result = await tool.execute({ prompt: "move", image: "source.png" }, context)
    assert.deepEqual(calls, ["/videos/generations", "/videos/job-1"])
    assert.ok(Array.isArray(result.content))
    assert.equal(result.content[1].type, "file")
    if (result.content[1].type !== "file") throw new Error("expected file content")
    assert.equal(result.content[1].mime, "video/mp4")
    assert.equal((await readFile(fileURLToPath(result.content[1].uri))).toString(), "video")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("polling sleep rejects when a tool is cancelled", async () => {
  const controller = new AbortController()
  const waiting = sleep(60_000, controller.signal)
  controller.abort()
  await assert.rejects(waiting, /aborted/)
})
