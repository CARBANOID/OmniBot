"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import { providers } from "@/providers"
import type { ProviderConfig } from "@/providers/types"

/**
 * A saved provider credential. Client state only (placeholder — no DB table
 * yet), shaped so persistence can be layered in later.
 */
export interface Credential {
  id: string
  // Display name chosen when the credential was added (e.g. "Work Google key").
  name: string
  // Provider id from `@/providers` (e.g. "google").
  provider: string
  apiKey: string
}

interface CredentialsContextValue {
  credentials: Credential[]
  selectedId: string | null
  // The currently selected credential, and its provider config (name, icon,
  // models) for the UI. null when nothing is selected.
  credential: Credential | null
  provider: ProviderConfig | null
  add: (credential: Credential) => void
  remove: (id: string) => void
  select: (id: string) => void
}

const CredentialsContext = createContext<CredentialsContextValue | null>(null)

export function CredentialsProvider({ children }: { children: ReactNode }) {
  const [credentials, setCredentials] = useState<Credential[]>([])
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

  const remove = useCallback((id: string) => {
    setCredentials((current) => current.filter((c) => c.id !== id))
    setSelectedId((current) => (current === id ? null : current))
  }, [])

  const select = useCallback((id: string) => setSelectedId(id), [])

  const value = useMemo(
    () => ({
      credentials,
      selectedId,
      credential,
      provider,
      add,
      remove,
      select,
    }),
    [credentials, selectedId, credential, provider, add, remove, select]
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
