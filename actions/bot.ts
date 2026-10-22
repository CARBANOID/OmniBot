"use server"

import { and, eq, sql } from "drizzle-orm"
import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"

import { db } from "@/lib/db"
import { bots, chatMembers, chats } from "@/lib/db/schema"
import {
  createBotInputSchema,
  updateBotInputSchema,
} from "@/lib/validations/bot"

// Every bot action reports the same shape: either it worked, or a message the
// UI can show. Actions never throw — unexpected failures are logged and turned
// into a safe generic message.
export type BotActionResult = { ok: true } | { ok: false; error: string }

export async function createBot(input: unknown): Promise<BotActionResult> {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated || !userId) {
    return { ok: false, error: "Sign in to create a bot." }
  }

  let data: ReturnType<typeof createBotInputSchema.parse>
  try {
    data = createBotInputSchema.parse(input)
  } catch {
    return { ok: false, error: "Check the form and try again." }
  }

  try {
    // One atomic step: the bot, its direct chat, and the chat membership
    // all land or none of them do.
    await db.transaction(async (tx) => {
      const [bot] = await tx
        .insert(bots)
        .values({
          name: data.name,
          job: data.job,
          instructions: data.instructions?.trim() ? data.instructions : null,
          avatar: data.avatar,
          // Server-owned: stamped from the session, never taken from the form.
          userId,
        })
        .returning({ id: bots.id })

      // Direct chats have no name — they display the bot's name.
      const [chat] = await tx
        .insert(chats)
        .values({
          kind: "direct",
          name: null,
          userId,
        })
        .returning({ id: chats.id })

      await tx.insert(chatMembers).values({
        chatId: chat.id,
        botId: bot.id,
      })
    })

    revalidatePath("/", "page")
    return { ok: true }
  } catch (error) {
    console.error(
      "[createBot] Failed to create bot + chat + membership:",
      error
    )
    return { ok: false, error: "Could not create your bot. Please try again." }
  }
}

export async function updateBot(
  botId: string,
  input: unknown
): Promise<BotActionResult> {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated || !userId) {
    return { ok: false, error: "Sign in to update a bot." }
  }

  let data: ReturnType<typeof updateBotInputSchema.parse>
  try {
    data = updateBotInputSchema.parse(input)
  } catch {
    return { ok: false, error: "Check the form and try again." }
  }

  try {
    // Ownership-guarded update: scoping the WHERE to the current user means a
    // bot someone else owns is simply not found, so the zero-row check below
    // doubles as the authorization check.
    const [updated] = await db
      .update(bots)
      .set({
        name: data.name,
        job: data.job,
        instructions: data.instructions?.trim() ? data.instructions : null,
        // `avatar` is notNull; only overwrite it when the form supplied one,
        // otherwise leave the bot's current face untouched.
        ...(data.avatar?.trim() ? { avatar: data.avatar } : {}),
      })
      .where(and(eq(bots.id, botId), eq(bots.userId, userId)))
      .returning({ id: bots.id })

    if (!updated) {
      return { ok: false, error: "That bot no longer exists." }
    }

    revalidatePath("/", "page")
    return { ok: true }
  } catch (error) {
    console.error("[updateBot] Failed to update bot:", error)
    return {
      ok: false,
      error: "Could not update your bot. Please try again.",
    }
  }
}

export async function deleteBot(botId: string): Promise<BotActionResult> {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated || !userId) {
    return { ok: false, error: "Sign in to delete a bot." }
  }

  try {
    let deleted = false
    await db.transaction(async (tx) => {
      // Ownership-guarded delete: scoped to the current user, so a bot owned
      // by someone else is not found. The FK cascade drops this bot's chat
      // memberships in the same step.
      const [removed] = await tx
        .delete(bots)
        .where(and(eq(bots.id, botId), eq(bots.userId, userId)))
        .returning({ id: bots.id })
      if (!removed) return

      deleted = true

      // A direct chat whose only member was this bot is now empty and
      // purposeless — drop it so it doesn't linger as a faceless chat.
      // (Drizzle's Columns are already table-qualified, so we reference the
      // tables directly — a hand-written alias in front of one yields
      // `alias."table"."column"`, which Postgres rejects.)
      const noMembers = sql`NOT EXISTS (SELECT 1 FROM ${chatMembers} WHERE ${chatMembers.chatId} = ${chats.id})`
      await tx
        .delete(chats)
        .where(
          and(eq(chats.userId, userId), eq(chats.kind, "direct"), noMembers)
        )
    })

    if (!deleted) {
      return { ok: false, error: "That bot no longer exists." }
    }

    revalidatePath("/", "page")
    return { ok: true }
  } catch (error) {
    console.error("[deleteBot] Failed to delete bot:", error)
    return {
      ok: false,
      error: "Could not delete your bot. Please try again.",
    }
  }
}
