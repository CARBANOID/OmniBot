"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { and, eq } from "drizzle-orm"

import { encryptCredential } from "@/lib/crypto"
import { db } from "@/lib/db"
import { credentials } from "@/lib/db/schema"
import {
  createCredentialInputSchema,
  updateCredentialInputSchema,
} from "@/lib/validations/credential"
import { providers } from "@/providers"

// Create: the action returns the new id so the UI can select the fresh
// credential. Delete is a plain ok/no-op result — the client already knows
// the id it asked to drop.
export type CreateCredentialResult =
  | { ok: true; id: string }
  | { ok: false; error: string }
export type DeleteCredentialResult =
  | { ok: true }
  | { ok: false; error: string }
export type UpdateCredentialResult =
  | { ok: true }
  | { ok: false; error: string }

// The user's chat pages seed the credentials context server-side; refresh
// them so every open tab picks the change up on its next render.
function revalidateCredentials() {
  revalidatePath("/chats", "page")
}

// Postgres' unique_violation code. The (userId, name) unique index makes a
// duplicate credential name the one predictable failure in create and
// update — answer it with the name, not a generic error.
//
// drizzle-orm wraps the driver's error in its own DrizzleQueryError and
// carries the original pg error (the one with `code: "23505"`) in `cause`,
// so walk the chain rather than checking the top-level object only.
function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === code
  )
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; current !== null && typeof current === "object" && depth < 5; depth++) {
    if (hasCode(current, "23505")) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

export async function createCredential(
  input: unknown
): Promise<CreateCredentialResult> {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated || !userId) {
    return { ok: false, error: "Sign in to add a credential." }
  }

  let data: ReturnType<typeof createCredentialInputSchema.parse>
  try {
    data = createCredentialInputSchema.parse(input)
  } catch {
    return { ok: false, error: "Fill in the name, provider, and API key." }
  }

  // The picker's list is the registry, but the action is callable directly —
  // an unknown provider is a client bug, answered plainly.
  if (!providers[data.provider]) {
    return { ok: false, error: "Unknown provider." }
  }

  try {
    const [created] = await db
      .insert(credentials)
      .values({
        name: data.name,
        provider: data.provider,
        // Only the ciphertext is stored; the plain key is discarded here.
        apiKey: encryptCredential(data.apiKey),
        userId,
      })
      .returning({ id: credentials.id })

    revalidateCredentials()
    return { ok: true, id: created.id }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        error: "API key name already exists. Please choose a different name.",
      }
    }
    console.error("[createCredential] Failed to create credential:", error)
    return {
      ok: false,
      error: "Could not save your credential. Please try again.",
    }
  }
}

export async function updateCredential(
  credentialId: string,
  input: unknown
): Promise<UpdateCredentialResult> {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated || !userId) {
    return { ok: false, error: "Sign in to update a credential." }
  }

  let data: ReturnType<typeof updateCredentialInputSchema.parse>
  try {
    data = updateCredentialInputSchema.parse(input)
  } catch {
    return { ok: false, error: "Fill in the name and provider." }
  }

  // Picked in the dialog, but the action is callable directly — answer an
  // unknown provider plainly, same as createCredential.
  if (!providers[data.provider]) {
    return { ok: false, error: "Unknown provider." }
  }

  try {
    // Read the existing row first (ownership-scoped, so someone else's
    // credential simply isn't found): the stored provider decides whether a
    // blank key means "keep it" or "you switched providers without a key".
    const [existing] = await db
      .select({ provider: credentials.provider })
      .from(credentials)
      .where(
        and(eq(credentials.id, credentialId), eq(credentials.userId, userId))
      )

    if (!existing) {
      return { ok: false, error: "That credential no longer exists." }
    }

    // The stored key is a credential OF its provider: switching providers
    // without pasting the new provider's key would re-tag a Google key as
    // OpenAI's — refuse it rather than write a broken row.
    const key = (data.apiKey ?? "").trim()
    if (existing.provider !== data.provider && !key) {
      return {
        ok: false,
        error: "Enter the new provider's API key to switch providers.",
      }
    }

    // Ownership-guarded update (same shape as updateBot in actions/bot.ts):
    // scoping the WHERE to the current user means a credential someone else
    // owns is simply not found — the zero-row check doubles as the
    // authorization check.
    const [updated] = await db
      .update(credentials)
      .set({
        name: data.name,
        provider: data.provider,
        // Re-encrypt only when the form supplied a fresh key; otherwise the
        // stored ciphertext stays exactly as it was.
        ...(key ? { apiKey: encryptCredential(key) } : {}),
      })
      .where(
        and(eq(credentials.id, credentialId), eq(credentials.userId, userId))
      )
      .returning({ id: credentials.id })

    if (!updated) {
      return { ok: false, error: "That credential no longer exists." }
    }

    revalidateCredentials()
    return { ok: true }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        error: "API key name already exists. Please choose a different name.",
      }
    }
    console.error("[updateCredential] Failed to update credential:", error)
    return {
      ok: false,
      error: "Could not update your credential. Please try again.",
    }
  }
}

export async function deleteCredential(
  credentialId: string
): Promise<DeleteCredentialResult> {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated || !userId) {
    return { ok: false, error: "Sign in to delete a credential." }
  }

  try {
    // Ownership-guarded delete: scoped to the current user, so a credential
    // someone else owns is simply not found.
    const [removed] = await db
      .delete(credentials)
      .where(
        and(eq(credentials.id, credentialId), eq(credentials.userId, userId))
      )
      .returning({ id: credentials.id })

    if (!removed) {
      return { ok: false, error: "That credential no longer exists." }
    }

    revalidateCredentials()
    return { ok: true }
  } catch (error) {
    console.error("[deleteCredential] Failed to delete credential:", error)
    return {
      ok: false,
      error: "Could not delete that credential. Please try again.",
    }
  }
}
