import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai"

import { auth } from "@clerk/nextjs/server"

import { providers } from "@/providers"

interface ChatRequest {
  messages: UIMessage[]
  provider: string
  model: string
  // Optional — when absent the provider falls back to its env var.
  apiKey?: string
}

// Allow streaming responses up to 30 seconds.
export const maxDuration = 30

export async function POST(req: Request) {
  const { isAuthenticated } = await auth()
  if (!isAuthenticated) {
    return Response.json({ error: "Sign in to chat." }, { status: 401 })
  }

  const {
    messages,
    provider: providerId,
    model: modelId,
    apiKey,
  } = (await req.json()) as ChatRequest

  // Resolve provider + model through the registry. An unknown pair is a
  // client bug — answer with a plain 400 before starting a stream.
  const provider = providers[providerId]
  if (!provider || !provider.models.some((model) => model.id === modelId)) {
    return Response.json(
      { error: `Unknown provider "${providerId}" or model "${modelId}".` },
      { status: 400 },
    )
  }

  const result = streamText({
    model: provider.createProvider(apiKey)(modelId),
    messages: await convertToModelMessages(messages),
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  })
}
