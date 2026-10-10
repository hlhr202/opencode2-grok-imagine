import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, extname, isAbsolute, join } from "node:path"
import { pathToFileURL } from "node:url"

// Detect image container from a base64 signature so files get the right extension.
export function imageType(b64: string) {
  if (b64.startsWith("iVBOR")) return { ext: "png", mime: "image/png" }
  if (b64.startsWith("/9j/")) return { ext: "jpg", mime: "image/jpeg" }
  if (b64.startsWith("UklGR")) return { ext: "webp", mime: "image/webp" }
  if (b64.startsWith("R0lGOD")) return { ext: "gif", mime: "image/gif" }
  return { ext: "png", mime: "image/png" }
}

export function slug(text: string) {
  return (
    (text || "media")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "media"
  )
}

// Project assets: caller passes output_dir (absolute or relative to project root).
// Scratch generation: no output_dir -> self-gitignored <project>/.grok-tmp folder.
export async function resolveOutDir(outputDir: string | undefined, directory: string): Promise<string> {
  if (outputDir) {
    const base = isAbsolute(outputDir) ? outputDir : join(directory, outputDir)
    await mkdir(base, { recursive: true })
    return base
  }
  const base = join(directory, ".grok-tmp")
  await mkdir(base, { recursive: true })
  const ignore = join(base, ".gitignore")
  if (!existsSync(ignore)) await writeFile(ignore, "*\n")
  return base
}

export function attachment(file: string, mime: string) {
  return { type: "file" as const, mime, uri: pathToFileURL(file).href, name: basename(file) }
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
}

// Resolve a user-supplied image reference into the `{ url }` value the API wants.
// Accepts an http(s) URL, an existing data URI, or a local file path (absolute
// or relative to the project directory), which is read and inlined as a data URI.
export async function resolveImageUrl(image: string, directory: string): Promise<string> {
  if (typeof image !== "string" || !image.trim()) {
    throw new Error("image must be a non-empty string (file path, URL, or data URI)")
  }
  const value = image.trim()
  if (/^data:/i.test(value) || /^https?:\/\//i.test(value)) return value

  const path = isAbsolute(value) ? value : join(directory, value)
  if (!existsSync(path)) {
    throw new Error(`image file not found: ${path}`)
  }
  const mime = IMAGE_MIME_BY_EXT[extname(path).toLowerCase()] ?? "image/png"
  const b64 = (await readFile(path)).toString("base64")
  return `data:${mime};base64,${b64}`
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"))
    const abort = () => {
      clearTimeout(timer)
      reject(new Error("aborted"))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort)
      resolve()
    }, ms)
    signal.addEventListener("abort", abort, { once: true })
  })
}
