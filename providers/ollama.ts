import { createOpenAICompatible } from "@ai-sdk/openai-compatible"

import type { ProviderConfig } from "./types"

// Local Ollama runtime. Its OpenAI-compatible endpoint (/v1) speaks the
// chat-completions API the chat agent targets, so it uses
// `@ai-sdk/openai-compatible` (the Responses-API `@ai-sdk/openai` would
// target /v1/responses, which Ollama's /v1 does not implement). Ollama ignores
// the Authorization header, so this provider needs no key at all.
//
// `@ai-sdk/openai-compatible` is pinned in package.json (^3.0.75) to a build
// whose `@ai-sdk/provider` matches the hoisted 4.0.31 (the version `ai@7` and
// every other provider are locked to). A newer build pulls a nested provider
// @ai-sdk/provider and its LanguageModelV4 no longer type-checks against ai's —
// keep it on a 4.0.31 line or the build fails.
//
// Note: `baseURL` is only reachable from the machine that runs the dev worker
// — in this project that is the local `trigger.dev dev` process, so a local
// Ollama is reachable. It is a personal/dev provider, not a hosted one.
const OLLAMA_BASE_URL = "http://localhost:11434/v1"

export const ollama: ProviderConfig = {
  id: "ollama",
  name: "Ollama (local)",
  icon: "/logos/ollama-icon.svg",
  // No saved credential: a local model needs no key. The client uses this to
  // let the user pick a model and send without selecting a credential, and
  // trigger/chat.ts skips the credential lookup when it is set.
  requiresApiKey: false,
  models: [{ id: "qwen3.8:27b", name: "Qwen 3.8 27B (local)" }],
  // `apiKey` is unused (Ollama ignores it) but kept for the shared factory
  // signature; the factory yields one chat model per id.
  //
  // `includeUsage: false` — Ollama's /v1 chat-completions endpoint does not
  // reliably emit the OpenAI-style `usage` block; we don't rely on it and this
  // avoids a potential 500 on stricter Ollama releases if it does.
  createProvider: () => (modelId: string) =>
    createOpenAICompatible({
      name: "ollama-local",
      baseURL: OLLAMA_BASE_URL,
      includeUsage: false,
      // Screenshots (view_screen's file part) must be sent as real
      // `image_url` content parts in the tool message — Ollama's /v1
      // accepts multipart tool content and its vision encoder sees them.
      // Without this, the SDK JSON.stringifies the parts and a ~115KB
      // screenshot becomes ~40k tokens of base64 *text* the model never
      // sees, which overflows the local context window within a handful
      // of screenshots (Ollama then truncates the prompt and the strict
      // qwen renderer 500s with "no user query found in messages").
      supportsMultiPartToolContent: true,
    }).languageModel(modelId),
}
