"use server"

import { and, eq } from "drizzle-orm"
import { auth } from "@clerk/nextjs/server"

import { db } from "@/lib/db"
import { chats } from "@/lib/db/schema"
import { chatBotId, desktopPreviewUrl } from "@/lib/daytona"

// Same result shape the other UI-facing actions report: either it worked
// (with the URL the pane needs), or a message the pane can show. The action
// never throws — the pane decides where to surface each message.
export type DesktopActionResult =
  | { ok: true; url: string }
  | { ok: false; error: string }

// Mint a signed URL for the chat's bot desktop (noVNC on port 6080). The
// pane calls it lazily — on first panel open and on Refresh — so nothing
// Daytona-related blocks page paint.
//
// This is callable directly from the browser, so it re-checks everything
// the page already guards: signed in, the chat is this user's.
export async function getDesktopPreviewUrl(
  chatId: string
): Promise<DesktopActionResult> {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated || !userId) {
    return { ok: false, error: "Sign in to open the desktop." }
  }

  // A chat with no bot has no sandbox to open — say so plainly instead of
  // failing the sandbox resolve below.
  if (!(await chatBotId(chatId))) {
    return {
      ok: false,
      error: "This chat has no bot, so there is no desktop to open.",
    }
  }

  // Ownership guard: scoping the WHERE to the current user means a chat
  // someone else owns simply comes back as zero rows.
  const [mine] = await db
    .select({ id: chats.id })
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
  if (!mine) {
    return { ok: false, error: "That chat no longer exists." }
  }

  try {
    const url = await desktopPreviewUrl(chatId)
    return { ok: true, url }
  } catch (error) {
    console.error("[getDesktopPreviewUrl] Failed to open the desktop:", error)
    return {
      ok: false,
      error: "Could not open the desktop. Please try again.",
    }
  }
}
