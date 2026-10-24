import { createOpenAI } from "@ai-sdk/openai"
import { HexagonIcon } from "lucide-react"

import type { ProviderConfig } from "./types"

export const openai: ProviderConfig = {
  id: "openai",
  name: "OpenAI",
  icon: HexagonIcon,
  models: [
    { id: "gpt-6-astra", name: "GPT-6 Astra" },
    { id: "gpt-6-luna", name: "GPT-6 Luna" },
  ],
  createProvider: (apiKey) => createOpenAI({ apiKey }),
}
