"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import type { DeleteCredentialResult } from "@/actions/credential"
import { deleteCredential } from "@/actions/credential"
import type { CredentialSummary } from "@/queries/credentials"
import { providers } from "@/providers"
import type { ProviderConfig } from "@/providers/types"

/**
 * A saved provider credential as the client knows it: id, name, and the
 * provider id. The API key itself is NOT here — it lives encrypted in the DB
 * and is decrypted server-side by the chat route from the id (see
 * queries/credentials.ts, app/api/chat/route.ts).
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
  children,
}: {
  // The user's saved credentials, fetched server-side by the page (see
  // getUserCredentials in queries/credentials.ts) and seeded into the state.
  initial?: Credential[]
  children: ReactNode
}) {
  const [credentials, setCredentials] = useState<Credential[]>(initial)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const credential = useMemo(
    () => credentials.find((c) => c.id === selectedId) ?? null,
    [credentials, selectedId]
  )
  const provider = useMemo(
    () => (credential ? (providers[credential.provider] ?? null) : null),
    [credential]
  )

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
