import type { LanguageModel } from "ai"
import type { LucideIcon } from "lucide-react"

/** A single model offered by a provider. */
export interface ProviderModel {
  // Model id sent to the API (e.g. "gemini-4-argon").
  id: string
  // Human-readable name shown in the UI.
  name: string
}

/** Static metadata + factory for one LLM provider. */
export interface ProviderConfig {
  // Stable identifier used in the chat route body (e.g. "google").
  id: string
  // Display name (e.g. "Google").
  name: string
  // Icon rendered next to the provider name in the UI.
  icon: LucideIcon
  // The models this provider offers.
  models: ProviderModel[]
  /**
   * Build an AI SDK provider instance with the given API key. Passing
   * nothing lets the provider fall back to its env var
   * (e.g. GOOGLE_GENERATIVE_AI_API_KEY).
   */
  createProvider: (apiKey?: string) => (modelId: string) => LanguageModel
}
