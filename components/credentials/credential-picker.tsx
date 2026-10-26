"use client"

import { useState } from "react"
import { KeyRoundIcon, PlusIcon } from "lucide-react"

import { AddCredentialDialog } from "./credential-dialog"
import { CredentialEditDialog } from "./credential-edit-dialog"
import { useCredentials } from "./context"
import { PromptInputButton } from "@/components/ai-elements/prompt-input"
import { ProviderIcon } from "@/components/provider-icon"
import { contentColumnCenter } from "@/lib/content-center"
import { providers } from "@/providers"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

/**
 * Footer button that picks the active provider credential. Opens a dialog
 * styled exactly like the sidebar's bot search bar (CommandDialog: top-1/3,
 * no box padding, same size) with a searchable command list of the saved
 * credentials; "Add credential" is pinned at the bottom and opens that
 * dialog.
 */
export function CredentialPicker() {
  const { credentials, credential, selectedId, select } = useCredentials()

  const [open, setOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  // Horizontal center of the content column (see lib/content-center).
  // Captured in the OPEN actions (user event handlers) for BOTH dialogs —
  // Base UI does not call onOpenChange when `open` is set externally, so an
  // effect-on-prop would be needed for the Add dialog, and the
  // react-hooks/set-state-in-effect lint rejects that. Event-time capture
  // covers every open path. null = mobile fallback, viewport centering.
  const [center, setCenter] = useState<number | null>(null)

  // The pick the user made in the list. Committed to the context only once
  // the dialog has fully closed (onOpenChangeComplete), so the footer's
  // selection change doesn't land while the dialog is still animating out.
  const [pendingId, setPendingId] = useState<string | null>(null)
  // True when the user re-picked the ACTIVE credential: that opens the
  // editor (update/delete, like the bot editor in the chat header) instead
  // of a re-select.
  const [editOpen, setEditOpen] = useState(false)

  function openSearch() {
    setCenter(contentColumnCenter())
    setOpen(true)
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(nowOpen) => {
          // Commit the pick only after the closing animation is done.
          if (nowOpen || pendingId == null) return
          select(pendingId)
          setPendingId(null)
        }}
      >
        <DialogTrigger
          render={
            // Always the square key icon, whether or not a credential is
            // selected — the selection shows on its own button (see
            // CredentialEditButton), and this one opens the search bar.
            <PromptInputButton
              // Outline (bordered) so it reads as a deliberate, visible
              // action next to the submit button, instead of a faint ghost.
              variant="outline"
              size="icon-sm"
              aria-label="Choose a credential"
              onClick={openSearch}
            />
          }
        >
          <KeyRoundIcon className="size-5" />
        </DialogTrigger>
        <DialogContent
          // Same geometry AND size as the sidebar's bot search bar
          // (CommandDialog): top-1/3, no box padding, Command's p-1 is the
          // inset, and the default content width (w-full up to sm:max-w-sm)
          // — so the two search dialogs are the same box.
          className="top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0"
          style={center != null ? { left: center } : undefined}
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Choose a credential</DialogTitle>
          </DialogHeader>
          <Command>
            <CommandInput placeholder="Search credentials…" />
            <CommandList>
              <CommandEmpty>No credentials found.</CommandEmpty>
              <CommandGroup>
                {[...credentials].sort((a, b) => {
                  // The active credential always leads the list.
                  if (a.id === selectedId) return -1
                  if (b.id === selectedId) return 1
                  return 0
                }).map((item) => {
                  const itemProvider = providers[item.provider]
                  // name left, provider pinned rightmost; hide the
                  // CommandItem's injected (unused) check icon, whose own
                  // ml-auto would otherwise split the space and prevent the
                  // provider from reaching the edge
                  return (
                    <CommandItem
                      key={item.id}
                      value={`${item.name} ${itemProvider?.name ?? ""}`}
                      onSelect={() => {
                        if (item.id === selectedId) {
                          // Re-picking the active credential opens its
                          // editor; a fresh pick queues a selection.
                          setOpen(false)
                          setEditOpen(true)
                          return
                        }
                        // Queue the pick; the commit happens in
                        // onOpenChangeComplete, once the dialog is closed.
                        setPendingId(item.id)
                        setOpen(false)
                      }}
                      className="justify-between [&>svg:last-child]:hidden"
                    >
                      {/* Keep icon + name together on the left; the name
                          truncates so the provider keeps its slot. */}
                      <span className="flex min-w-0 items-center gap-2">
                        {itemProvider ? <ProviderIcon provider={itemProvider} /> : null}
                        <span className="truncate">{item.name}</span>
                      </span>
                      {itemProvider && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {itemProvider.name}
                        </span>
                      )}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
            {/* Pinned OUTSIDE the filtered list (but inside the command box,
                so it always renders and the box's rounded corners clip it). */}
            <button
              type="button"
              onClick={() => {
                setCenter(contentColumnCenter())
                // Keep the search dialog open underneath: the Add dialog nests
                // over it, and closing that returns to the still-open search.
                setAddOpen(true)
              }}
              className="flex w-full cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground select-none hover:bg-muted hover:text-foreground"
            >
              <PlusIcon className="size-4" />
              Add credential
            </button>
          </Command>
        </DialogContent>
      </Dialog>
      <AddCredentialDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        center={center}
      />
      {/* Only reachable while a credential is selected (re-picking it is
          what opens the editor); render once so its form state is stable.
          `credential ?` guards the TS narrowing. */}
      {credential && (
        <CredentialEditDialog
          credential={credential}
          open={editOpen}
          onOpenChange={setEditOpen}
          center={center}
        />
      )}
    </>
  )
}
