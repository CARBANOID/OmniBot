"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import type { DeleteCredentialResult } from "@/actions/credential"
import { deleteCredential } from "@/actions/credential"
import {
  CREDENTIAL_COOKIE_MAX_AGE,
  CREDENTIAL_COOKIE_NAME,
} from "@/lib/credential-cookie"
import type { CredentialSummary } from "@/queries/credentials"
import { providers } from "@/providers"
import type { ProviderConfig } from "@/providers/types"

/**
 * A saved provider credential as the client knows it: id, name, and the
 * provider id. The API key itself is NOT here — it lives encrypted in the DB
 * and is decrypted server-side by the chat agent from the id (see
 * trigger/chat.ts).
 */
export type Credential = CredentialSummary

interface CredentialsContextValue {
  credentials: Credential[]
  selectedId: string | null
  // The currently selected credential, and its provider config (name, icon,
  // models) for the UI. null when nothing is selected.
  credential: Credential | null
  provider: ProviderConfig | null
  // Append a row the server action just created (it returns the id).
  add: (credential: Credential) => void
  // Replace a row in place (after a successful update — e.g. its new name).
  update: (credential: Credential) => void
  // Delete via the server action; on success also drops it from local state.
  // Returns the action result so a future UI can show the inline error.
  remove: (id: string) => Promise<DeleteCredentialResult>
  select: (id: string) => void
}

const CredentialsContext = createContext<CredentialsContextValue | null>(null)

export function CredentialsProvider({
  initial = [],
  initialSelectedId = null,
  children,
}: {
  // The user's saved credentials, fetched server-side by the page (see
  // getUserCredentials in queries/credentials.ts) and seeded into the state.
  initial?: Credential[]
  // The credential to restore, read from the selection cookie by the page
  // and validated against the user's own rows — so a refresh paints the
  // selection from the first frame (same first-paint trick as the sidebar).
  initialSelectedId?: string | null
  children: ReactNode
}) {
  const [credentials, setCredentials] = useState<Credential[]>(initial)
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId
  )

  const credential = useMemo(
    () => credentials.find((c) => c.id === selectedId) ?? null,
    [credentials, selectedId]
  )
  const provider = useMemo(
    () => (credential ? (providers[credential.provider] ?? null) : null),
    [credential]
  )

  // Keep the selection cookie in lockstep with the state — every change,
  // pick or clear, lands in the cookie (path=/, so it is site-global), and
  // an empty value (max-age=0) removes it when the selection is cleared.
  // The id is opaque: the key itself never leaves the server.
  useEffect(() => {
    document.cookie = `${CREDENTIAL_COOKIE_NAME}=${
      selectedId ?? ""
    }; path=/; max-age=${selectedId ? CREDENTIAL_COOKIE_MAX_AGE : 0}`
  }, [selectedId])

  const add = useCallback((newCredential: Credential) => {
    setCredentials((current) => [...current, newCredential])
  }, [])

  const update = useCallback((next: Credential) => {
    setCredentials((current) =>
      current.map((c) => (c.id === next.id ? next : c))
    )
  }, [])

  const remove = useCallback(async (id: string) => {
    const result = await deleteCredential(id)
    if (result.ok) {
      setCredentials((current) => current.filter((c) => c.id !== id))
      setSelectedId((current) => (current === id ? null : current))
    }
    return result
  }, [])

  const select = useCallback((id: string) => setSelectedId(id), [])

  const value = useMemo(
    () => ({
      credentials,
      selectedId,
      credential,
      provider,
      add,
      update,
      remove,
      select,
    }),
    [
      credentials,
      selectedId,
      credential,
      provider,
      add,
      update,
      remove,
      select,
    ]
  )

  return (
    <CredentialsContext.Provider value={value}>
      {children}
    </CredentialsContext.Provider>
  )
}

export function useCredentials() {
  const context = useContext(CredentialsContext)
  if (!context) {
    throw new Error("useCredentials must be used inside a CredentialsProvider")
  }
  return context
}
