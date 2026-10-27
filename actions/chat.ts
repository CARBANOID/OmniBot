"use server"

import { auth } from "@clerk/nextjs/server"
import { auth as triggerAuth } from "@trigger.dev/sdk"
import {
  chat,
  defaultStorage,
  type ChatStartSessionParams,
} from "@trigger.dev/sdk/ai"
import { and, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { chats } from "@/lib/db/schema"
import type { omnibotChat } from "@/trigger/chat"

// Every callback the browser makes names a chatId that came from the browser,
// so each action re-checks that the signed-in user owns it before doing
// anything — the page does the same check, but these are callable directly.
//
// The actions THROW on failure (they can't return an ok/error union — the
// trigger transport expects a raw token/result). A rejection surfaces in
// useChat's `error`, so the message is safe for end users.

// The HTTP status on a Trigger API error — the client's error class is only
// shape-known (name/status, no shared type), so read it defensively.
function triggerApiStatus(error: unknown): number | undefined {
  const candidate = error as { name?: unknown; status?: unknown } | null
  if (
    candidate?.name === "TriggerApiError" &&
    typeof candidate.status === "number"
  ) {
    return candidate.status
  }
  return undefined
}
async function ownsChat(chatId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: chats.id })
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
  return row !== undefined
}

// Mint (or refresh) the session-scoped PAT the transport uses for the
// .in/.out endpoints. The transport calls this on a 401/403 — the token is
// scoped to this chat's session, so a stranger's chatId must not mint one.
export async function mintChatAccessToken(chatId: string) {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated || !userId) {
    throw new Error("Sign in to chat.")
  }
  if (!(await ownsChat(chatId, userId))) {
    throw new Error("Unknown chat.")
  }

  return triggerAuth.createPublicToken({
    scopes: {
      read: { sessions: chatId },
      write: { sessions: chatId },
    },
    expirationTime: "1h",
  })
}

// Create the session (idempotent) + first run, returning the session PAT.
// Called by the transport on the chat's first message.
const createStartSession =
  chat.createStartSessionAction<typeof omnibotChat>("omnibot-chat")

export async function startChatSession(
  params: ChatStartSessionParams<typeof omnibotChat>
) {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated || !userId) {
    throw new Error("Sign in to chat.")
  }
  if (!(await ownsChat(params.chatId, userId))) {
    throw new Error("Unknown chat.")
  }

  try {
    return await createStartSession(params)
  } catch (error) {
    // A session closed from the dashboard or via chat.close() is terminal:
    // the API refuses to open a second session for this chat id (HTTP 409),
    // and the platform's model for continuing is a NEW chat id — so this is
    // not a retryable failure. The transcript of a closed session stays
    // readable, so the page still renders the history; only the next turn
    // lands here. Translate to a user-safe message (the raw one names
    // platform internals).
    if (triggerApiStatus(error) === 409) {
      throw new Error("This conversation has ended. Start a new chat to continue.")
    }
    throw error
  }
}

// Read the conversation back from the platform's transcript storage (the
// same blob the dashboard renders), for `useLoadTranscript` on page load.
const loadTranscript = chat.createLoadTranscriptAction(defaultStorage)

export async function loadChatTranscript(params: { chatId: string }) {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated || !userId) {
    throw new Error("Sign in to chat.")
  }
  if (!(await ownsChat(params.chatId, userId))) {
    throw new Error("Unknown chat.")
  }

  return loadTranscript(params)
}
