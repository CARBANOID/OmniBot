import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai"

import { auth } from "@clerk/nextjs/server"

import { getCredentialKey } from "@/queries/credentials"
import { providers } from "@/providers"

interface ChatRequest {
  messages: UIMessage[]
  provider: string
  model: string
  // Id of the user's saved credential. The key itself never travels with the
  // request — the route decrypts it server-side (see getCredentialKey).
  credentialId: string
}

// Allow streaming responses up to 30 seconds.
export const maxDuration = 30

export async function POST(req: Request) {
  const {
    messages,
    provider: providerId,
    model: modelId,
    credentialId,
  } = (await req.json()) as ChatRequest

  const { isAuthenticated } = await auth()
  if (!isAuthenticated) {
    return Response.json({ error: "Sign in to chat." }, { status: 401 })
  }

  // Resolve provider + model through the registry. An unknown pair is a
  // client bug — answer with a plain 400 before starting a stream.
  const provider = providers[providerId]
  if (!provider || !provider.models.some((model) => model.id === modelId)) {
    return Response.json(
      { error: `Unknown provider "${providerId}" or model "${modelId}".` },
      { status: 400 },
    )
  }

  // The credential must belong to the caller AND to the requested provider —
  // both are scoped in the query, so any miss comes back as null.
  const credential = await getCredentialKey(credentialId, providerId)
  if (!credential) {
    return Response.json({ error: "Unknown credential." }, { status: 400 })
  }

  const result = streamText({
    model: provider.createProvider(credential.key)(modelId),
    messages: await convertToModelMessages(messages),
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  })
}
