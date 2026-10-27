"use client"

import { useState } from "react"

import { PromptInputButton } from "@/components/ai-elements/prompt-input"
import { ProviderIcon } from "@/components/provider-icon"
import { contentColumnCenter } from "@/lib/content-center"
import { providers } from "@/providers"
import { CredentialEditDialog } from "./credential-edit-dialog"
import { useCredentials } from "./context"

/**
 * The selected credential as a label, e.g. `Google (key-1)` — the key name
 * stays whole under 20 chars, longer ones are truncated to 20 + ellipsis to
 * keep the pill compact. Clicking it opens the update/delete editor (same
 * dialog as re-picking it in the search bar). Renders nothing while no
 * credential is selected.
 */
export function CredentialEditButton() {
  const { credential, provider } = useCredentials()

  const [open, setOpen] = useState(false)
  // Same centering as the credential dialogs: captured in the OPEN action
  // (Base UI doesn't call onOpenChange for an externally set `open`).
  // null = mobile fallback, viewport centering.
  const [center, setCenter] = useState<number | null>(null)

  if (!credential || !provider) return null

  const keyName =
    credential.name.length > 20
      ? `${credential.name.slice(0, 20)}…`
      : credential.name

  return (
    <>
      <PromptInputButton
        variant="ghost"
        size="sm"
        // `group` so the label can brighten on hover (see the span below).
        className="group"
        onClick={() => {
          setCenter(contentColumnCenter())
          setOpen(true)
        }}
      >
        {/* Slightly dim at rest, full on hover AND while the prompt box has
            focus (typing) — the focus state comes from the PromptInput's
            InputGroup, which is the named `group/input-group`. */}
        <ProviderIcon
          provider={provider}
          className="opacity-85 group-hover:opacity-100 group-focus-within/input-group:opacity-100"
        />
        {/* Slightly dim normally, full-foreground on hover and while typing —
            overrides the footer addon's muted-foreground and reads as a
            subtle brighten. */}
        <span className="max-w-48 truncate text-sm text-foreground/85 group-hover:text-foreground group-focus-within/input-group:text-foreground">
          {provider.name} ({keyName})
        </span>
      </PromptInputButton>
      <CredentialEditDialog
        credential={credential}
        open={open}
        onOpenChange={setOpen}
        center={center}
      />
    </>
  )
}
