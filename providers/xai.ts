import { createXai } from "@ai-sdk/xai"
import { ZapIcon } from "lucide-react"

import type { ProviderConfig } from "./types"

export const xai: ProviderConfig = {
  id: "xai",
  name: "xAI",
  icon: ZapIcon,
  models: [
    { id: "grok-4.7", name: "Grok 4.7" },
    { id: "grok-4.3", name: "Grok 4.3" },
  ],
  createProvider: (apiKey) => createXai({ apiKey }),
}
