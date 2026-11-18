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
  LOCAL_PROVIDER_COOKIE_MAX_AGE,
  LOCAL_PROVIDER_COOKIE_NAME,
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
  // The saved credential currently selected (keyed providers only). null when
  // nothing is selected or a keyless provider is active.
  selectedId: string | null
  // A keyless (local) provider selected with no credential — e.g. Ollama. The
  // only thing set when the active provider needs no saved key. null otherwise.
  activeProviderId: string | null
  // The currently selected credential, and its provider config (name, icon,
  // models) for the UI. null when nothing is selected.
  credential: Credential | null
  // The ACTIVE provider: the keyless one if active, else the credential's.
  provider: ProviderConfig | null
  // True when the active provider needs no saved credential (keyless / local).
  isKeyless: boolean
  // Append a row the server action just created (it returns the id).
  add: (credential: Credential) => void
  // Replace a row in place (after a successful update — e.g. its new name).
  update: (credential: Credential) => void
  // Delete via the server action; on success also drops it from local state.
  // Returns the action result so a future UI can show the inline error.
  remove: (id: string) => Promise<DeleteCredentialResult>
  // Select a saved credential (clears any active keyless provider).
  select: (id: string) => void
  // Select a keyless provider (Ollama) with no credential (clears the
  // credential). No-op if the id isn't a keyless provider in the registry.
  selectKeyless: (providerId: string) => void
}

const CredentialsContext = createContext<CredentialsContextValue | null>(null)

export function CredentialsProvider({
  initial = [],
  initialSelectedId = null,
  initialActiveProviderId = null,
  children,
}: {
  // The user's saved credentials, fetched server-side by the page (see
  // getUserCredentials in queries/credentials.ts) and seeded into the state.
  initial?: Credential[]
  // The credential to restore, read from the selection cookie by the page
  // and validated against the user's own rows — so a refresh paints the
  // selection from the first frame (same first-paint trick as the sidebar).
  initialSelectedId?: string | null
  // The keyless provider to restore (e.g. Ollama), read from its cookie by
  // the page and validated against the registry — never a keyed provider.
  initialActiveProviderId?: string | null
  children: ReactNode
}) {
  const [credentials, setCredentials] = useState<Credential[]>(initial)
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId)
  const [activeProviderId, setActiveProviderId] = useState<string | null>(
    initialActiveProviderId
  )

  const credential = useMemo(
    () => credentials.find((c) => c.id === selectedId) ?? null,
    [credentials, selectedId]
  )
  // Active provider = the keyless one if it's set, else the credential's.
  // A keyless and a credential are mutually exclusive by construction below.
  const provider = useMemo(
    () =>
      (activeProviderId ? (providers[activeProviderId] ?? null) : null) ??
      (credential ? (providers[credential.provider] ?? null) : null),
    [activeProviderId, credential]
  )
  const isKeyless = provider ? provider.requiresApiKey === false : false

  // Keep the credential + keyless-provider cookies in lockstep with the state.
  // Both are empty (max-age=0) when not selected. The id is opaque: the key
  // itself never leaves the server.
  useEffect(() => {
    document.cookie = `${CREDENTIAL_COOKIE_NAME}=${
      selectedId ?? ""
    }; path=/; max-age=${selectedId ? CREDENTIAL_COOKIE_MAX_AGE : 0}`
  }, [selectedId])
  useEffect(() => {
    document.cookie = `${LOCAL_PROVIDER_COOKIE_NAME}=${
      activeProviderId ?? ""
    }; path=/; max-age=${activeProviderId ? LOCAL_PROVIDER_COOKIE_MAX_AGE : 0}`
  }, [activeProviderId])

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

  const select = useCallback((id: string) => {
    // A credential is a keyed provider — a keyless pick and a credential are
    // two ways of naming "the active provider", so picking one clears the other.
    setSelectedId(id)
    setActiveProviderId(null)
  }, [])

  const selectKeyless = useCallback((providerId: string) => {
    // Only a registry provider that declares itself keyless qualifies — this
    // is the client-side guard for "no credential needed".
    if (providers[providerId]?.requiresApiKey !== false) return
    setActiveProviderId(providerId)
    setSelectedId(null)
  }, [])

  const value = useMemo(
    () => ({
      credentials,
      selectedId,
      activeProviderId,
      credential,
      provider,
      isKeyless,
      add,
      update,
      remove,
      select,
      selectKeyless,
    }),
    [
      credentials,
      selectedId,
      activeProviderId,
      credential,
      provider,
      isKeyless,
      add,
      update,
      remove,
      select,
      selectKeyless,
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
