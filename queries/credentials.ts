import { auth } from "@clerk/nextjs/server"
import { and, asc, eq } from "drizzle-orm"

import { decryptCredential } from "@/lib/crypto"
import { db } from "@/lib/db"
import { credentials } from "@/lib/db/schema"

/**
 * A saved credential's metadata — id, name, provider.
 *
 * Never carries the API key: listings only render the picker's labels.
 * The plain key is decrypted exactly where it's needed (the chat route),
 * server-side, and never sent to the browser.
 */
export interface CredentialSummary {
  id: string
  name: string
  provider: string
}

// The signed-in user's credentials, in the order they were added.
//
// `auth()` is called here (rather than taking a userId) so this can only ever
// return the *current* session's rows — the caller can never widen the scope.
export async function getUserCredentials(): Promise<CredentialSummary[]> {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated || !userId) {
    return []
  }

  return db
    .select({
      id: credentials.id,
      name: credentials.name,
      provider: credentials.provider,
    })
    .from(credentials)
    .where(eq(credentials.userId, userId))
    .orderBy(asc(credentials.createdAt))
}

// A single credential's decrypted key, scoped to the current session AND the
// requested provider: a Google credential can never serve an OpenAI request.
// Unknown id, another user's credential, or a mismatched provider all come
// back as null — every miss is indistinguishable, exactly like the bot
// queries.
export async function getCredentialKey(
  credentialId: string,
  providerId: string
): Promise<{ key: string } | null> {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated || !userId) {
    return null
  }

  const [row] = await db
    .select({ apiKey: credentials.apiKey })
    .from(credentials)
    .where(
      and(
        eq(credentials.id, credentialId),
        eq(credentials.userId, userId),
        eq(credentials.provider, providerId)
      )
    )

  if (!row) {
    return null
  }

  try {
    return { key: decryptCredential(row.apiKey) }
  } catch (error) {
    // A corrupt or re-keyed row: log the real error, surface nothing.
    console.error("[getCredentialKey] Failed to decrypt credential:", error)
    return null
  }
}
