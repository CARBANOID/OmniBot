import { anthropic } from "./anthropic"
import { google } from "./google"
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
}

// All providers in display order (Google first — it's the test target).
export const providerList: ProviderConfig[] = [
  google,
  anthropic,
  openai,
  xai,
]
