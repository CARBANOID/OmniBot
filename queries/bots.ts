import { auth } from "@clerk/nextjs/server"
import { asc, desc, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { bots, chatMembers, chats } from "@/lib/db/schema"
import type { GroupChatBot } from "@/lib/validations/chat"

/** The shared fields of every chat as it appears in the user's chat list. */
interface UserChatBase {
  id: string
  // Display name: the chat's own name, or the first member bot's name for
  // direct chats (whose `chats.name` is null).
  name: string
  preview: string | null
  lastMessageAt: Date
}

/** A chat as it should appear in the user's chat list.
 *
 * A direct chat carries its single member's face seed; a group chat carries
 * every member's face seed in join order — the group avatar tiles from them,
 * and the first is the chat's default voice.
 */
export type UserChat =
  | (UserChatBase & { kind: "direct"; avatarSeed: string })
  | (UserChatBase & { kind: "group"; memberSeeds: string[] })

// The signed-in user's chats, most recently active first.
//
// `auth()` is called here (rather than taking a userId) so this can only ever
// return the *current* session's chats — the caller can never widen the scope.
export async function getUserChats(): Promise<UserChat[]> {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated || !userId) {
    return []
  }

  // One row per (chat, bot) member, grouped per chat by activity and ordered
  // by join order within it — so a chat's rows stay together in the order the
  // group avatar should tile them. A direct chat is one such row.
  const rows = await db
    .select({
      id: chats.id,
      kind: chats.kind,
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

  // Collapse the per-chat rows into one entry, collecting the member faces in
  // arrival (join) order. A chat with no member bot has no face to render, so
  // it stays out of the list.
  const byId = new Map<
    string,
    Pick<UserChatBase, "name" | "preview" | "lastMessageAt"> & {
      kind: "direct" | "group"
      memberSeeds: string[]
    }
  >()
  for (const row of rows) {
    if (!row.botAvatar) continue
    let acc = byId.get(row.id)
    if (!acc) {
      // Groups are always named; a direct chat borrows its bot's name.
      acc = {
        name: row.name ?? row.botName ?? "",
        preview: row.preview,
        lastMessageAt: row.lastMessageAt,
        kind: row.kind,
        memberSeeds: [],
      }
      byId.set(row.id, acc)
    }
    acc.memberSeeds.push(row.botAvatar)
  }

  return [...byId.entries()].map(([id, acc]) =>
    acc.kind === "group"
      ? {
          id,
          name: acc.name,
          preview: acc.preview,
          lastMessageAt: acc.lastMessageAt,
          kind: "group" as const,
          memberSeeds: acc.memberSeeds,
        }
      : {
          id,
          name: acc.name,
          preview: acc.preview,
          lastMessageAt: acc.lastMessageAt,
          kind: "direct" as const,
          // A direct chat keeps its first-joined bot's face.
          avatarSeed: acc.memberSeeds[0],
        }
  )
}

// The signed-in user's bots, in creation order — the pool a group chat can be
// formed from (the dialog offers them, the server action re-checks ownership).
export async function getUserBots(): Promise<GroupChatBot[]> {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated || !userId) {
    return []
  }
  return db
    .select({ id: bots.id, name: bots.name, avatar: bots.avatar })
    .from(bots)
    .where(eq(bots.userId, userId))
    .orderBy(asc(bots.createdAt))
}
