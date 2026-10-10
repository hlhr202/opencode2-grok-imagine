// CPA (CLIProxyAPI) HTTP client for the Grok Imagine endpoints.
//
// Configuration precedence (first defined wins):
//   1. plugin options passed via opencode.json  { package: "pkg", options: { ... } }
//   2. environment variables
//        GROK_IMAGINE_BASE_URL | CPA_BASE_URL
//        GROK_IMAGINE_API_KEY  | CPA_API_KEY
//        GROK_IMAGINE_INSECURE_TLS (1/true) | insecureTLS option
//
// TLS is verified by default. Opt out only for self-signed LAN proxies.

export interface GrokOptions {
  baseURL?: string
  apiKey?: string
  insecureTLS?: boolean | string
}

function firstDefined(...vals: (string | undefined)[]): string | undefined {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v
  return undefined
}

function truthy(v: boolean | string | undefined): boolean {
  if (v === true) return true
  if (typeof v === "string") return /^(1|true|yes|on)$/i.test(v.trim())
  return false
}

export function resolveConfig(options: GrokOptions = {}) {
  const env = process.env
  const baseURL = firstDefined(options.baseURL, env.GROK_IMAGINE_BASE_URL, env.CPA_BASE_URL)
  const apiKey = firstDefined(options.apiKey, env.GROK_IMAGINE_API_KEY, env.CPA_API_KEY)
  const insecureTLS =
    options.insecureTLS !== undefined
      ? truthy(options.insecureTLS)
      : truthy(env.GROK_IMAGINE_INSECURE_TLS)

  if (!baseURL) {
    throw new Error(
      "Grok Imagine: no base URL. Set GROK_IMAGINE_BASE_URL or CPA_BASE_URL, or pass { baseURL } in the plugin options.",
    )
  }
  if (!apiKey) {
    throw new Error(
      "Grok Imagine: no API key. Set GROK_IMAGINE_API_KEY or CPA_API_KEY, or pass { apiKey } in the plugin options.",
    )
  }

  // Accept a base with or without a trailing /v1; normalize to include it once.
  const trimmed = baseURL.replace(/\/+$/, "")
  const root = /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`
  return { root, apiKey, insecureTLS }
}

export function createClient(options: GrokOptions = {}) {
  const cfg = resolveConfig(options)
  // Bun's fetch honors `tls` per request. Node's fetch ignores this option;
  // there, NODE_TLS_REJECT_UNAUTHORIZED governs verification.
  const tls = cfg.insecureTLS ? { rejectUnauthorized: false } : undefined

  async function request(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const res = await fetch(`${cfg.root}${path}`, {
      ...init,
      signal,
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      ...(tls ? { tls } : {}),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(
        `Grok Imagine ${path} failed: ${res.status} ${res.statusText}${
          body ? ` — ${body.slice(0, 500)}` : ""
        }`,
      )
    }
    return res
  }

  async function download(url: string, signal?: AbortSignal): Promise<Buffer> {
    const res = await fetch(url, { signal, ...(tls ? { tls } : {}) })
    if (!res.ok) throw new Error(`Grok Imagine download failed: ${res.status} ${res.statusText}`)
    return Buffer.from(await res.arrayBuffer())
  }

  return { request, download, config: cfg }
}
