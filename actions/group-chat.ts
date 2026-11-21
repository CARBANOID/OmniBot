"use server"

import { auth } from "@clerk/nextjs/server"
import { and, asc, eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { db } from "@/lib/db"
import { bots, chatMembers, chats } from "@/lib/db/schema"
import {
  createGroupChatInputSchema,
  updateGroupChatInputSchema,
} from "@/lib/validations/chat"

// Every group-chat action reports the same shape: either it worked, or a
// message the UI can show. Actions never throw — unexpected failures are
// logged and turned into a safe generic message.
export type GroupChatActionResult =
  | { ok: true }
  | { ok: false; error: string }

// Ownership: every selected bot must belong to the current user, and the
// membership is resolved in the user's bot-list order (creation order)
// rather than click order, so the avatar's tile order and the first-bot
// default voice are stable. `botIds` names bots, but the set of the user's
// own bots is what this action trusts. Shared by create and update, which
// both replace the membership wholesale.
async function resolveOwnedMembership(
  userId: string,
  botIds: string[]
): Promise<{ botIds: string[] } | GroupChatActionResult> {
  const owned = await db
    .select({ id: bots.id })
    .from(bots)
    .where(eq(bots.userId, userId))
    .orderBy(asc(bots.createdAt))
  const ownedIds = new Set(owned.map((bot) => bot.id))
  if (botIds.some((id) => !ownedIds.has(id))) {
    return { ok: false, error: "One of those bots is not yours." }
  }
  const selected = new Set(botIds)
  const membership = owned
    .filter((bot) => selected.has(bot.id))
    .map((bot) => bot.id)
  if (membership.length < 2) {
    return { ok: false, error: "Pick at least two different bots." }
  }
  return { botIds: membership }
}

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

  const membership = await resolveOwnedMembership(userId, data.botIds)
  if ("ok" in membership) {
    return membership
  }
  const { botIds } = membership

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

export async function updateGroupChat(
  chatId: string,
  input: unknown
): Promise<GroupChatActionResult> {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated || !userId) {
    return { ok: false, error: "Sign in to update a group chat." }
  }

  let data: ReturnType<typeof updateGroupChatInputSchema.parse>
  try {
    data = updateGroupChatInputSchema.parse(input)
  } catch {
    return { ok: false, error: "Check the form and try again." }
  }

  // Ownership + kind guard: scoping the read to the current user's *group*
  // chats means a chat someone else owns — or a direct chat — is not found,
  // so the zero-row check below doubles as the authorization check (the
  // action is callable directly, without the page's own check).
  const [chat] = await db
    .select({ id: chats.id })
    .from(chats)
    .where(
      and(
        eq(chats.id, chatId),
        eq(chats.userId, userId),
        eq(chats.kind, "group")
      )
    )
  if (!chat) {
    return { ok: false, error: "That group chat no longer exists." }
  }

  // Create and update both replace the membership wholesale, so they share
  // the ownership check and the stable (creation-order) membership.
  const membership = await resolveOwnedMembership(userId, data.botIds)
  if ("ok" in membership) {
    return membership
  }
  const { botIds } = membership

  try {
    // One atomic step: the new name and the whole new membership land or
    // none of them do. The old membership rows are dropped and rewritten,
    // so an added or removed bot never half-lands, and the staggered
    // joinedAt keeps join order (avatar tiles, default voice) deterministic.
    await db.transaction(async (tx) => {
      await tx
        .update(chats)
        .set({ name: data.name.trim() })
        .where(eq(chats.id, chat.id))

      await tx.delete(chatMembers).where(eq(chatMembers.chatId, chat.id))

      await tx.insert(chatMembers).values(
        botIds.map((botId, i) => ({
          chatId: chat.id,
          botId,
          joinedAt: new Date(Date.now() + i),
        }))
      )
    })

    // The chat list (sidebar names + avatar tiles) and, while the user is on
    // it, the chat page itself — its header and composer read the same rows.
    revalidatePath("/", "page")
    revalidatePath(`/chats/${chatId}`, "page")
    return { ok: true }
  } catch (error) {
    console.error("[updateGroupChat] Failed to update group chat:", error)
    return {
      ok: false,
      error: "Could not update your group chat. Please try again.",
    }
  }
}

export async function deleteGroupChat(
  chatId: string
): Promise<GroupChatActionResult> {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated || !userId) {
    return { ok: false, error: "Sign in to delete a group chat." }
  }

  try {
    // Ownership + kind guard, exactly as in create/update: a chat someone
    // else owns — or a direct chat — is not found, so the zero-row check
    // doubles as the authorization check. The chat_members rows cascade off
    // the chat row (onDelete: "cascade"), so this one delete takes the chat
    // and its whole membership with it. The member bots themselves survive —
    // only their membership in this chat goes.
    const [removed] = await db
      .delete(chats)
      .where(
        and(
          eq(chats.id, chatId),
          eq(chats.userId, userId),
          eq(chats.kind, "group")
        )
      )
      .returning({ id: chats.id })

    if (!removed) {
      return { ok: false, error: "That group chat no longer exists." }
    }

    revalidatePath("/", "page")
    return { ok: true }
  } catch (error) {
    console.error("[deleteGroupChat] Failed to delete group chat:", error)
    return {
      ok: false,
      error: "Could not delete your group chat. Please try again.",
    }
  }
}
