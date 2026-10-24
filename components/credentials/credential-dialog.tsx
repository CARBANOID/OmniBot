"use client"

import { useState } from "react"
import { nanoid } from "nanoid"
import { EyeIcon, EyeOffIcon } from "lucide-react"

import { useCredentials } from "./context"
import { Button } from "@/components/ui/button"
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
 * API key input. Plain local state (placeholder, no DB table) — saving adds
 * the credential to the credentials context and selects it.
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

  function onSave() {
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
    const credential = {
      id: nanoid(),
      name: name.trim(),
      provider: providerId,
      apiKey: apiKey.trim(),
    }
    add(credential)
    select(credential.id)
    setName("")
    setProviderId(null)
    setApiKey("")
    setShowKey(false)
    setError(null)
    onOpenChange(false)
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
                            {(() => {
                              const Icon = provider.icon
                              return <Icon className="size-4" />
                            })()}
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
                          {providerList.map((item) => {
                            const Icon = item.icon
                            return (
                              <CommandItem
                                key={item.id}
                                value={item.name}
                                onSelect={() => {
                                  setProviderId(item.id)
                                  setProviderOpen(false)
                                  setError(null)
                                }}
                              >
                                <Icon className="size-4" />
                                {item.name}
                              </CommandItem>
                            )
                          })}
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
              <FieldDescription>Stored only for this session.</FieldDescription>
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
          <Button type="submit" form="credential-form">
            Add credential
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
