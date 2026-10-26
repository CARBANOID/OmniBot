import { createGoogle } from "@ai-sdk/google"

import type { ProviderConfig } from "./types"

export const google: ProviderConfig = {
  id: "google",
  name: "Google",
  icon: "/logos/google-gemini-icon.svg",
  models: [
    { id: "gemini-4-argon", name: "Gemini 4 Argon" },
    { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  ],
  createProvider: (apiKey) => createGoogle({ apiKey }),
}
