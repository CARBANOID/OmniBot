import { auth } from "@clerk/nextjs/server"
import { chat, defaultStorage } from "@trigger.dev/sdk/ai"
import type { TranscriptLoadResult } from "@trigger.dev/sdk/ai"
import { and, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { chats } from "@/lib/db/schema"

// The transcript does not live in our database: the trigger agent persists
// it to their object store, so every read is a presign + fetch round trip
// to the trigger.dev platform. The page calls this during SSR, so the
// conversation ships in the initial HTML — instead of the client waiting
// for hydration plus the same round trip through the `useLoadTranscript`
// hook (see components/chat.tsx, which keeps its hook only as the fallback
// for when this prefetch fails).
const loadTranscript = chat.createLoadTranscriptAction(defaultStorage)

// Session scope, like `ownsChat` in actions/chat.ts: a transcript is only
// readable for the *current* session's chats — the caller can never widen
// the scope, and another user's chatId behaves like an unknown one (null).
async function ownsChat(chatId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: chats.id })
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
  return row !== undefined
}

// Read a chat's transcript for the page to prefetch during SSR.
//
// Returns `null` rather than throwing: a failed read (their API unreachable,
// or the chat signed-in-user-less / not owned) must not take the page down —
// the conversation still renders, and the client hook retries with its own
// spinner. A brand-new chat is a *success* with zero messages, which the
// page passes straight through (its empty state then shows immediately).
export async function getChatTranscript(
  chatId: string
): Promise<TranscriptLoadResult | null> {
  try {
    const { isAuthenticated, userId } = await auth()
    if (!isAuthenticated || !userId) {
      return null
    }
    if (!(await ownsChat(chatId, userId))) {
      return null
    }
    return await loadTranscript({ chatId })
  } catch (error) {
    console.error("Failed to prefetch chat transcript", { chatId, error })
    return null
  }
}
