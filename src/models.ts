// Catalog of xAI Grok Imagine models exposed through the CPA proxy, with the
// routing guidance the agent uses to pick the best-matching model per task.

export const IMAGE_MODELS = ["grok-imagine-image-quality", "grok-imagine-image"] as const
export const VIDEO_MODELS = ["grok-imagine-video", "grok-imagine-video-1.5-preview"] as const

export const DEFAULT_IMAGE_MODEL = "grok-imagine-image-quality"
export const DEFAULT_VIDEO_MODEL = "grok-imagine-video"

// Per-model, one-line tradeoffs. Surfaced in the tool arg descriptions so the
// model can route to the best match instead of always taking the default.
export const MODEL_NOTES: Record<(typeof IMAGE_MODELS)[number] | (typeof VIDEO_MODELS)[number], string> = {
  "grok-imagine-image-quality":
    "highest-fidelity stills; prefer for final art, detailed or photoreal images (default).",
  "grok-imagine-image":
    "faster, lighter stills; prefer for drafts, iteration, thumbnails, or bulk generation.",
  "grok-imagine-video":
    "stable pipeline; supports both text-to-video and image-to-video (default).",
  "grok-imagine-video-1.5-preview":
    "newer preview pipeline for improved motion/quality; may be less stable and can require an image (image-to-video) rather than text-only.",
}

function describe(models: readonly (keyof typeof MODEL_NOTES)[]) {
  return models.map((m) => `'${m}' — ${MODEL_NOTES[m]}`).join(" ")
}

export const IMAGE_MODEL_DESCRIPTION = `Which image model to use. ${describe(
  IMAGE_MODELS,
)} Omit to use ${DEFAULT_IMAGE_MODEL}.`

export const VIDEO_MODEL_DESCRIPTION = `Which video model to use. ${describe(
  VIDEO_MODELS,
)} Omit to use ${DEFAULT_VIDEO_MODEL}.`

// Normalize common aliases/prefixes (xai/, x-ai/, grok/) some callers may pass.
export function normalizeModel(model: string | undefined, kind: "image" | "video"): string {
  if (!model) return kind === "video" ? DEFAULT_VIDEO_MODEL : DEFAULT_IMAGE_MODEL
  const cleaned = String(model)
    .trim()
    .replace(/^(xai|x-ai|grok)\//i, "")
  const pool = kind === "video" ? VIDEO_MODELS : IMAGE_MODELS
  if (pool.some((candidate) => candidate === cleaned)) return cleaned
  // Unknown but plausible: pass through so the proxy can validate/error clearly.
  return cleaned
}
