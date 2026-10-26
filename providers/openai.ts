import { createOpenAI } from "@ai-sdk/openai"

import type { ProviderConfig } from "./types"

export const openai: ProviderConfig = {
  id: "openai",
  name: "OpenAI",
  icon: "/logos/chatgpt-icon.svg",
  models: [
    { id: "gpt-6-astra", name: "GPT-6 Astra" },
    { id: "gpt-6-luna", name: "GPT-6 Luna" },
  ],
  createProvider: (apiKey) => createOpenAI({ apiKey }),
}
