import { auth } from "@clerk/nextjs/server"
import { and, asc, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { bots, chatMembers, chats } from "@/lib/db/schema"
import type { EditableBot } from "@/lib/validations/bot"

/** A chat as it should appear in the chat header. */
export interface Chat {
  id: string
  // Display name: the chat's own name, or the resolved bot's name for direct
  // chats (whose `chats.name` is null).
  name: string
  // The editable bot behind the chat (the one whose face/name is shown). Its
  // `avatar` is the face seed, passed straight to ChatAvatar. null when the
  // chat has no member bot — the header then shows no avatar and no edit
  // button.
  bot: EditableBot | null
}

// Fetch a single chat by id, always scoped to the *current* session.
//
// `auth()` is called here (rather than taking a userId) so this can only ever
// return the *current* session's chats — the caller can never widen the scope.
// A chat somebody else owns is indistinguishable from a chat that does not
// exist: both simply come back as null.
//
// The chat is resolved to a single bot — the one that joined first — which
// supplies the avatar face and (for nameless direct chats) the display name.
// Group chats are not treated specially: "the first member" is all the header
// needs, exactly like the sidebar (see getUserChats in queries/bots.ts).
export async function getChat(chatId: string): Promise<Chat | null> {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated || !userId) {
    return null
  }

  // One row per (chat, bot) member. Ordered by join order and limited to the
  // first row, the join resolves directly to the earliest-joined bot.
  const [row] = await db
    .select({
      id: chats.id,
      name: chats.name,
      botId: bots.id,
      botName: bots.name,
      botAvatar: bots.avatar,
      botJob: bots.job,
      botInstructions: bots.instructions,
    })
    .from(chats)
    .leftJoin(chatMembers, eq(chats.id, chatMembers.chatId))
    .leftJoin(bots, eq(chatMembers.botId, bots.id))
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
    .orderBy(asc(chatMembers.joinedAt))
    .limit(1)

  if (!row) {
    return null
  }

  return {
    id: row.id,
    name: row.name ?? row.botName ?? "",
    // All bot columns are notNull (save instructions), so a present botId
    // guarantees a fully-populated editable bot; the left-join only makes the
    // *types* optional, so we assert the three notNull columns back.
    bot: row.botId
      ? {
          id: row.botId,
          name: row.botName!,
          job: row.botJob!,
          instructions: row.botInstructions,
          avatar: row.botAvatar!,
        }
      : null,
  }
}
