"use client"

import { useState } from "react"
import { EyeIcon, EyeOffIcon } from "lucide-react"

import { createCredential } from "@/actions/credential"
import { useCredentials } from "./context"
import { Button } from "@/components/ui/button"
import { ProviderIcon } from "@/components/provider-icon"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/toast"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { providerList } from "@/providers"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

export interface AddCredentialDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Horizontal center (px) of the content column, measured by the opener in
  // its open action (Base UI does not fire onOpenChange for an externally
  // set `open` — so this rides in as a prop instead). Applied as `left`, it
  // lands this dialog on the same axis as the credential search bar; null
  // lets the dialog keep its default viewport centering (mobile).
  center: number | null
}

/**
 * "Add credential" dialog: a name, a searchable provider list, and an
 * API key input. Saving posts to the createCredential server action
 * (encrypted at rest) and, on success, adds + selects it in the
 * credentials context.
 */
export function AddCredentialDialog({
  open,
  onOpenChange,
  center,
}: AddCredentialDialogProps) {
  const { add, select } = useCredentials()

  const [name, setName] = useState("")
  const [providerId, setProviderId] = useState<string | null>(null)
  const [providerOpen, setProviderOpen] = useState(false)
  const [apiKey, setApiKey] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const provider = providerList.find((p) => p.id === providerId) ?? null

  // Reset the draft every time the dialog opens, and again when it closes
  // without saving — the content unmounts per session, so the fields must
  // be cleared here, not in the popup's tree.
  function handleOpenChange(next: boolean) {
    if (!next) {
      setName("")
      setProviderId(null)
      setApiKey("")
      setShowKey(false)
      setError(null)
    }
    onOpenChange(next)
  }

  async function onSave() {
    if (!name.trim()) {
      setError("Enter a name.")
      return
    }
    if (!providerId) {
      setError("Pick a provider.")
      return
    }
    if (!apiKey.trim()) {
      setError("Enter the API key.")
      return
    }
    if (saving) return
    setSaving(true)
    try {
      // Server action: validates against the registry AND the insert schema,
      // encrypts the key, and returns the new id for selection.
      const result = await createCredential({
        name: name.trim(),
        provider: providerId,
        apiKey: apiKey.trim(),
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      add({ id: result.id, name: name.trim(), provider: providerId })
      select(result.id)
      toast.add({
        type: "success",
        title: "Credential added",
        description: `${name.trim()} was saved.`,
      })
      setName("")
      setProviderId(null)
      setApiKey("")
      setShowKey(false)
      setError(null)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogDescription className="sr-only">
        Add a provider credential to chat with.
      </DialogDescription>
      <DialogContent
        // Same positioning as the credential search bar: top edge at 33vh
        // (top-1/3, translate-y-0) and centered over the content column
        // (inline left from the `center` prop, set by the opener).
        className="top-1/3 translate-y-0 sm:max-w-sm"
        style={center != null ? { left: center } : undefined}
      >
        <DialogHeader>
          <DialogTitle>Add credential</DialogTitle>
          <DialogDescription>
            A credential is a provider plus the API key to use for it.
          </DialogDescription>
        </DialogHeader>

        <form
          id="credential-form"
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            onSave()
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="credential-name">Name</FieldLabel>
              <Input
                id="credential-name"
                placeholder="Work Google key"
                value={name}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setName(event.target.value)
                  setError(null)
                }}
              />
              <FieldDescription>
                A label you recognize when picking it.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel>Provider</FieldLabel>
              <div className="flex gap-2">
                <Popover open={providerOpen} onOpenChange={setProviderOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        variant="outline"
                        className={cn(
                          "h-8 w-full justify-start",
                          !provider && "text-muted-foreground"
                        )}
                      >
                        {provider ? (
                          <>
                            <ProviderIcon provider={provider} />
                            {provider.name}
                          </>
                        ) : (
                          "Search provider…"
                        )}
                      </Button>
                    }
                  />
                  <PopoverContent align="start" className="w-64 p-0">
                    <Command>
                      <CommandInput placeholder="Search providers…" />
                      <CommandList>
                        <CommandEmpty>No providers found.</CommandEmpty>
                        <CommandGroup>
                          {providerList.map((item) => (
                            <CommandItem
                              key={item.id}
                              value={item.name}
                              onSelect={() => {
                                setProviderId(item.id)
                                setProviderOpen(false)
                                setError(null)
                              }}
                            >
                              <ProviderIcon provider={item} />
                              {item.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </Field>

            <Field>
              <FieldLabel htmlFor="credential-api-key">API key</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="credential-api-key"
                  type={showKey ? "text" : "password"}
                  placeholder="Paste the key"
                  value={apiKey}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => {
                    setApiKey(event.target.value)
                    setError(null)
                  }}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={showKey ? "Hide key" : "Show key"}
                  onClick={() => setShowKey((current) => !current)}
                >
                  {showKey ? (
                    <EyeOffIcon className="size-4" />
                  ) : (
                    <EyeIcon className="size-4" />
                  )}
                </Button>
              </div>
              <FieldDescription>
                Stored encrypted on your account.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </form>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <DialogClose
            render={
              <Button type="button" variant="outline">
                Cancel
              </Button>
            }
          />
          <Button type="submit" form="credential-form" disabled={saving}>
            {saving ? "Saving…" : "Add credential"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
