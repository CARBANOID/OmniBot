import { auth } from "@clerk/nextjs/server"
import { and, asc, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { bots, chatMembers, chats } from "@/lib/db/schema"
import type { EditableBot } from "@/lib/validations/bot"

/** A member bot of a chat, in the order it joined (the first is the default voice). */
export interface ChatMemberInfo {
  id: string
  name: string
  // What the bot is for — offered as context in the group chat's empty state.
  job: string
  // Seed the bot's face is generated from (passed straight to the avatars).
  avatar: string
}

/** A chat as it should appear on the chat page. */
export interface Chat {
  id: string
  // Display name: the chat's own name (groups are always named; direct chats
  // fall back to their bot's name).
  name: string
  kind: "direct" | "group"
  // The editable bot behind the chat (direct chats only) — the name/face the
  // header's bot editor works on, and the composer's placeholder. Always null
  // for a group chat (which has several bots and no single one to edit).
  bot: EditableBot | null
  // Every member bot in join order — one for a direct chat, several for a
  // group. Tiles the group avatar and feeds the composer's bot picker.
  members: ChatMemberInfo[]
}

// Fetch a single chat by id, always scoped to the *current* session.
//
// `auth()` is called here (rather than taking a userId) so this can only ever
// return the *current* session's chats — the caller can never widen the scope.
// A chat somebody else owns is indistinguishable from a chat that does not
// exist: both simply come back as null.
export async function getChat(chatId: string): Promise<Chat | null> {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated || !userId) {
    return null
  }

  // One row per (chat, bot) member, in join order (the first is the default
  // voice; a direct chat is a single row). The chat columns repeat on every
  // row — they come from the outer join.
  const rows = await db
    .select({
      id: chats.id,
      kind: chats.kind,
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

  const [chatRow] = rows
  if (!chatRow) {
    return null
  }

  const members: ChatMemberInfo[] = []
  let first: (typeof rows)[number] | null = null
  for (const row of rows) {
    if (!row.botId) continue
    if (!first) first = row
    members.push({
      id: row.botId,
      // All bot columns are notNull (save instructions), so a present botId
      // guarantees a fully-populated member — the left join only makes the
      // *types* optional, so the three notNull columns are asserted back.
      name: row.botName!,
      job: row.botJob!,
      avatar: row.botAvatar!,
    })
  }
  // A chat with no member bot has no face to render and nothing to say —
  // treat it as absent, the way the pre-group world did.
  if (first === null) {
    return null
  }

  return {
    id: chatRow.id,
    name: chatRow.name ?? members[0].name,
    kind: chatRow.kind,
    bot:
      chatRow.kind === "direct"
        ? {
            id: first.botId!,
            name: first.botName!,
            job: first.botJob!,
            instructions: first.botInstructions,
            avatar: first.botAvatar!,
          }
        : null,
    members,
  }
}
