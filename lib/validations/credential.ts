import { createInsertSchema } from "drizzle-zod"
import { z } from "zod"
import { credentials } from "@/lib/db/schema"


export const credentialInsertSchema = createInsertSchema(credentials, {
  name: z.string().min(1, "Give the key a name.").max(50),
  // Registry ids are short; the real check (is it a known provider?) happens
  // in the action against @/providers.
  provider: z.string().min(1).max(50),
  apiKey: z.string().min(1, "Enter the API key.").max(500),
})

// What a client may submit. Server-owned columns are omitted: `id` and
// `createdAt` get defaults, and `userId` is stamped server-side from the
// Clerk session (see actions/credential.ts) — it never travels with the form.
export const createCredentialInputSchema = credentialInsertSchema.omit({
  id: true,
  userId: true,
  createdAt: true,
})

export type CreateCredentialInput = z.infer<typeof createCredentialInputSchema>

// The editable slice of an existing credential. `name` always (it's the
// user-facing row label); `apiKey` is optional — blank keeps the stored key,
// so renaming works without re-pasting the secret. `provider` can be
// re-picked to move the credential to another provider; that combination
// (changed provider + blank key) is rejected in the action, since the
// stored key belongs to the old provider.
export const updateCredentialInputSchema = createInsertSchema(credentials, {
  name: z.string().min(1, "Give the key a name.").max(50),
  provider: z.string().min(1).max(50),
  apiKey: z
    .string()
    .max(500, "That key looks too long.")
    .optional()
    .or(z.literal("")),
}).omit({
  id: true,
  userId: true,
  createdAt: true,
})

export type UpdateCredentialInput = z.infer<typeof updateCredentialInputSchema>
