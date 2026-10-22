import { createInsertSchema } from "drizzle-zod"
import { z } from "zod"

import { bots } from "@/lib/db/schema"

// Insert schema derived from the drizzle table, so validation stays in
// lockstep with the columns declared in lib/db/schema.ts.
export const botInsertSchema = createInsertSchema(bots, {
  name: z.string().min(1, "Give your bot a name.").max(50),
  job: z.string().min(1, "Every bot needs a job to do.").max(100),
  instructions: z.string().max(2000).optional(),
  avatar: z.string().min(1).max(64).optional(),
})

// What a client may submit. Server-owned columns are omitted: `id` and
// `createdAt` get defaults, and `userId` is stamped server-side from the
// Clerk session (see actions/bot.ts) — it never travels with the form.
export const createBotInputSchema = botInsertSchema.omit({
  id: true,
  userId: true,
  createdAt: true,
})

export type BotInput = z.infer<typeof createBotInputSchema>

// The editable slice of an existing bot, as read by the chat header and
// written back by the update form. `id` names the row to update/delete; the
// rest are exactly the client-editable columns above.
export interface EditableBot {
  id: string
  name: string
  job: string
  instructions: string | null
  avatar: string
}

// A client updating an existing bot submits the same editable columns as
// create — the shape is identical, only the server action differs
// (update-in-place vs insert). `id` is passed separately to the action, not
// through the form.
export const updateBotInputSchema = botInsertSchema.omit({
  id: true,
  userId: true,
  createdAt: true,
})

export type UpdateBotInput = z.infer<typeof updateBotInputSchema>
