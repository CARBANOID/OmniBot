import { auth } from "@clerk/nextjs/server"
import { asc, desc, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { bots, chatMembers, chats } from "@/lib/db/schema"

/** A chat as it should appear in the user's chat list. */
export interface UserChat {
  id: string
  // Display name: the chat's own name, or the resolved bot's name for direct
  // chats (whose `chats.name` is null).
  name: string
  preview: string | null
  lastMessageAt: Date
  // Seed the bot's face is generated from (passed straight to ChatAvatar).
  avatarSeed: string
}

// The signed-in user's chats, most recently active first.
//
// Each chat is resolved to a single bot — the one that joined first — which
// supplies the avatar face and (for nameless direct chats) the display name.
// There is no per-kind branch: a direct chat's only member and a group chat's
// first member both reduce to "the first bot", which is all the sidebar needs.
//
// `auth()` is called here (rather than taking a userId) so this can only ever
// return the *current* session's chats — the caller can never widen the scope.
export async function getUserChats(): Promise<UserChat[]> {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated || !userId) {
    return []
  }

  // One row per (chat, bot) pair. A chat shows up N times (once per member
  // bot), so we order each chat's rows by join order and keep only the first
  // one — the earliest-joined bot. Sorting `lastMessageAt` first means the
  // output is already grouped per chat and in the order we want to render.
  const rows = await db
    .select({
      id: chats.id,
      name: chats.name,
      preview: chats.lastMessagePreview,
      lastMessageAt: chats.lastMessageAt,
      botName: bots.name,
      botAvatar: bots.avatar,
    })
    .from(chats)
    .leftJoin(chatMembers, eq(chats.id, chatMembers.chatId))
    .leftJoin(bots, eq(chatMembers.botId, bots.id))
    .where(eq(chats.userId, userId))
    .orderBy(desc(chats.lastMessageAt), asc(chatMembers.joinedAt))

  const result: UserChat[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    // Skip extra members of a chat we've already taken; and skip chats with no
    // member bot, since without a bot there is no face to render.
    if (seen.has(row.id) || !row.botAvatar) continue
    seen.add(row.id)
    result.push({
      id: row.id,
      name: row.name ?? row.botName ?? "",
      preview: row.preview,
      lastMessageAt: row.lastMessageAt,
      avatarSeed: row.botAvatar,
    })
  }

  return result
}
