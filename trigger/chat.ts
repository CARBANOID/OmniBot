import { and, eq } from "drizzle-orm"
import { chat } from "@trigger.dev/sdk/ai"
import { z } from "zod"

import { decryptCredential } from "@/lib/crypto"
import { db } from "@/lib/db"
import { chats, credentials } from "@/lib/db/schema"
import { providers } from "@/providers"

// The chat agent behind a chat page. The session's chat id IS the app's
// `chats.id`, so the worker resolves the chat's owner straight from the DB —
// there is no Clerk session in a Trigger worker, and the owner's id is what
// scopes the credential lookup below.
//
// The provider/model/selection rides in `clientData` (the picker's state,
// typed by the schema): only ids travel the wire, the key itself is
// decrypted here, exactly like the old /api/chat route did.
export const omnibotChat = chat.agent({
  id: "omnibot-chat",
  clientDataSchema: z.object({
    provider: z.string(),
    model: z.string(),
    credentialId: z.string(),
  }),
  // Stream errors (rate limits, provider failures) are sanitized before they
  // reach the browser — the raw message can carry provider internals.
  uiMessageStreamOptions: {
    onError: (error) => {
      console.error("[omnibot-chat] Stream error:", error)
      return "Something went wrong while generating a response. Please try again."
    },
  },
  run: async ({ chatId, messages, clientData, signal, streamText }) => {
    // The UI gates sending on a selected credential, but the turn reaches
    // here without clientData if it doesn't — answer the gap, don't crash.
    if (!clientData) {
      throw new Error("Choose a credential to start chatting.")
    }
    const { provider: providerId, model: modelId, credentialId } = clientData

    // The provider + model pair is validated against the registry. An
    // unknown pair is a client bug — fail the turn with the plain message
    // the old route answered with (it becomes the user-facing errorText).
    const provider = providers[providerId]
    if (!provider || !provider.models.some((model) => model.id === modelId)) {
      throw new Error(`Unknown provider "${providerId}" or model "${modelId}".`)
    }

    // Who owns this chat — the credential must belong to THEM, and to the
    // requested provider, exactly like the old getCredentialKey query.
    const [chatRow] = await db
      .select({ userId: chats.userId })
      .from(chats)
      .where(eq(chats.id, chatId))
    if (!chatRow) {
      throw new Error("Unknown chat.")
    }

    const [row] = await db
      .select({ apiKey: credentials.apiKey })
      .from(credentials)
      .where(
        and(
          eq(credentials.id, credentialId),
          eq(credentials.userId, chatRow.userId),
          eq(credentials.provider, providerId)
        )
      )
    if (!row) {
      throw new Error("Unknown credential.")
    }

    let key: string
    try {
      key = decryptCredential(row.apiKey)
    } catch (error) {
      // A corrupt or re-keyed row: log the real error, surface nothing.
      console.error("[omnibot-chat] Failed to decrypt credential:", error)
      throw new Error("Unknown credential.")
    }

    // `streamText`, `signal`, and the already-converted `messages` all come
    // from the run — the managed streamText carries the agent's options, and
    // the signal is what makes Stop abort the model call server-side.
    return streamText({
      model: provider.createProvider(key)(modelId),
      messages,
      abortSignal: signal,
    })
  },
})
