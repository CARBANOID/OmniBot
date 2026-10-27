import { auth } from "@clerk/nextjs/server"
import { asc, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { credentials } from "@/lib/db/schema"

/**
 * A saved credential's metadata — id, name, provider.
 *
 * Never carries the API key: listings only render the picker's labels.
 * The plain key is decrypted exactly where it's needed (the chat agent),
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
