import { anthropic } from "./anthropic"
import { google } from "./google"
import { ollama } from "./ollama"
import { openai } from "./openai"
import type { ProviderConfig } from "./types"
import { xai } from "./xai"

/**
 * Registry of supported providers, keyed by provider id. The chat route
 * resolves requests against this; the chat UI lists providerList.
 */
export const providers: Record<string, ProviderConfig> = {
  [google.id]: google,
  [anthropic.id]: anthropic,
  [openai.id]: openai,
  [xai.id]: xai,
  // Local Ollama — keyless (no credential), so it's a personal/dev provider.
  [ollama.id]: ollama,
}

// All providers in display order (Google first — it's the test target; Ollama
// last — it's local and needs no key).
export const providerList: ProviderConfig[] = [
  google,
  anthropic,
  openai,
  xai,
  ollama,
]
