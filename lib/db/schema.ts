import { relations } from "drizzle-orm"
import { nanoid } from "nanoid"
import {
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core"

export const bots = pgTable(
  "bots",
  {
    id: text("id").primaryKey().$default(() => nanoid()),
    // Third-party id (Clerk user id: user_...).
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    // Seed for the bot's face; generated as a nanoid when not provided.
    avatar: text("avatar").notNull().$default(() => nanoid()),
    // What the bot is for, in a phrase.
    job: text("job").notNull(),
    // How it should go about the job, if any.
    instructions: text("instructions"),
    // Third-party id of the bot's sandbox, created lazily later.
    sandboxId: text("sandbox_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("bots_user_id_idx").on(t.userId)]
)

export type Bot = typeof bots.$inferSelect
export type NewBot = typeof bots.$inferInsert

export const chatKinds = pgEnum("chat_kind", ["direct", "group"])

export const chats = pgTable(
  "chats",
  {
    id: text("id").primaryKey().$default(() => nanoid()),
    // Third-party id (Clerk user id: user_...).
    userId: text("user_id").notNull(),
    kind: chatKinds("kind").notNull().default("direct"),
    // null for direct chats, which use the bot's name.
    name: text("name"),
    lastMessagePreview: text("last_message_preview"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("chats_user_id_idx").on(t.userId)]
)

export const chatMembers = pgTable(
  "chat_members",
  {
    // One bot can only join a chat once.
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("chat_members_bot_id_idx").on(t.botId),
    primaryKey({ columns: [t.chatId, t.botId] }),
  ]
)

export type Chat = typeof chats.$inferSelect
export type NewChat = typeof chats.$inferInsert
export type ChatMember = typeof chatMembers.$inferSelect
export type NewChatMember = typeof chatMembers.$inferInsert

export const botsRelations = relations(bots, ({ many }) => ({
  memberships: many(chatMembers),
}))

export const chatsRelations = relations(chats, ({ many }) => ({
  members: many(chatMembers),
}))

export const chatMembersRelations = relations(chatMembers, ({ one }) => ({
  chat: one(chats, {
    fields: [chatMembers.chatId],
    references: [chats.id],
  }),
  bot: one(bots, {
    fields: [chatMembers.botId],
    references: [bots.id],
  }),
}))
