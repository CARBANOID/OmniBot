"use server"

import { auth } from "@clerk/nextjs/server"
import { asc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db } from "@/lib/db"
import { bots, chatMembers, chats } from "@/lib/db/schema"
import { createGroupChatInputSchema } from "@/lib/validations/chat"

// Every group-chat action reports the same shape: either it worked, or a
// message the UI can show. Actions never throw — unexpected failures are
// logged and turned into a safe generic message.
export type GroupChatActionResult =
  | { ok: true }
  | { ok: false; error: string }

export async function createGroupChat(
  input: unknown
): Promise<GroupChatActionResult> {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated || !userId) {
    return { ok: false, error: "Sign in to create a group chat." }
  }

  let data: ReturnType<typeof createGroupChatInputSchema.parse>
  try {
    data = createGroupChatInputSchema.parse(input)
  } catch {
    return { ok: false, error: "Check the form and try again." }
  }

  // Ownership: every selected bot must belong to the current user, and the
  // membership rows are written in the user's bot-list order (creation
  // order) rather than click order, so the avatar's tile order and the
  // first-bot default voice are stable. `data.botIds` names bots, but the
  // set of the user's own bots is what this action trusts.
  const owned = await db
    .select({ id: bots.id })
    .from(bots)
    .where(eq(bots.userId, userId))
    .orderBy(asc(bots.createdAt))
  const ownedIds = new Set(owned.map((bot) => bot.id))
  if (data.botIds.some((id) => !ownedIds.has(id))) {
    return { ok: false, error: "One of those bots is not yours." }
  }
  const selected = new Set(data.botIds)
  const botIds = owned.filter((bot) => selected.has(bot.id)).map((bot) => bot.id)
  if (botIds.length < 2) {
    return { ok: false, error: "Pick at least two different bots." }
  }

  try {
    // One atomic step: the chat and its memberships all land or none of
    // them do. The staggered joinedAt keeps join order deterministic even
    // though the rows are written in a single batch (a shared timestamp
    // would make the "first bot" tie order database-dependent).
    await db.transaction(async (tx) => {
      const [chat] = await tx
        .insert(chats)
        .values({
          // A group chat: named by the user, its members named in the
          // form (and validated above).
          kind: "group",
          name: data.name.trim(),
          userId,
        })
        .returning({ id: chats.id })

      await tx.insert(chatMembers).values(
        botIds.map((botId, i) => ({
          chatId: chat.id,
          botId,
          joinedAt: new Date(Date.now() + i),
        }))
      )
    })

    revalidatePath("/", "page")
    return { ok: true }
  } catch (error) {
    console.error("[createGroupChat] Failed to create group chat:", error)
    return {
      ok: false,
      error: "Could not create your group chat. Please try again.",
    }
  }
}
