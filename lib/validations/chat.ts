import { createInsertSchema } from "drizzle-zod"
import { z } from "zod"

import { chats } from "@/lib/db/schema"

/** A bot as a group-chat member candidate: its id and display face. */
export interface GroupChatBot {
  id: string
  name: string
  // Seed the bot's face is generated from (passed straight to the avatars).
  avatar: string
}

// Insert schema derived from the drizzle table, so validation stays in
// lockstep with the columns declared in lib/db/schema.ts. A group chat is
// the one column with a fixed value — its `kind` is "group", by definition.
const chatInsertSchema = createInsertSchema(chats, {
  name: z.string().min(1, "Give your group chat a name.").max(50),
})

// What a client may submit when creating a group chat: the chat's name plus
// the ids of the bots that join it (the chat_members rows). The rest is
// server-owned and omitted: `id` and `createdAt` have defaults, `userId` is
// stamped from the Clerk session (see actions/group-chat.ts), `kind` is
// "group", and the last-message columns are populated by the platform when
// the conversation happens.
export const createGroupChatInputSchema = chatInsertSchema
  .omit({
    id: true,
    userId: true,
    createdAt: true,
    kind: true,
    lastMessagePreview: true,
    lastMessageAt: true,
  })
  .extend({
    botIds: z
      .array(z.string().min(1))
      .min(2, "Pick at least two bots to talk to."),
  })

export type GroupChatInput = z.infer<typeof createGroupChatInputSchema>

// What a client may submit when updating an existing group chat: the new
// name plus the full set of member bot ids — a group stays a group (named,
// at least two bots), so the editable slice is identical to create; only the
// server action differs (update-in-place vs insert). `id` names the row and
// is passed separately to the action, never through the form.
export const updateGroupChatInputSchema = chatInsertSchema
  .omit({
    id: true,
    userId: true,
    createdAt: true,
    kind: true,
    lastMessagePreview: true,
    lastMessageAt: true,
  })
  .extend({
    botIds: z
      .array(z.string().min(1))
      .min(2, "Pick at least two bots to talk to."),
  })

export type UpdateGroupChatInput = z.infer<typeof updateGroupChatInputSchema>
