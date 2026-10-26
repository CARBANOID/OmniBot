import { createAnthropic } from "@ai-sdk/anthropic"

import type { ProviderConfig } from "./types"

export const anthropic: ProviderConfig = {
  id: "anthropic",
  name: "Anthropic",
  icon: "/logos/claude-ai-icon.svg",
  models: [
    { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
    { id: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
  ],
  createProvider: (apiKey) => createAnthropic({ apiKey }),
}
