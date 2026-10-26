"use client"

import { useTransition, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { EyeIcon, EyeOffIcon, TrashIcon } from "lucide-react"

import { updateCredential } from "@/actions/credential"
import { Button } from "@/components/ui/button"
import { ProviderIcon } from "@/components/provider-icon"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
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
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { providerList, providers } from "@/providers"
import {
  updateCredentialInputSchema,
  type UpdateCredentialInput,
} from "@/lib/validations/credential"
import { useCredentials, type Credential } from "./context"

export interface CredentialEditDialogProps {
  // The credential being edited; its label prefills the form.
  credential: Credential
  open: boolean
  onOpenChange: (open: boolean) => void
  // Horizontal center (px) of the content column — same positioning as the
  // search bar and the add dialog (see credential-picker.tsx); null keeps
  // the default viewport centering (mobile).
  center: number | null
}

// The picker opens this when the user re-selects the ACTIVE credential:
// pre-filled name (and an optional fresh key) to update, or a confirmed
// delete — the same shape as BotEditDialog.
export function CredentialEditDialog({
  credential,
  open,
  onOpenChange,
  center,
}: CredentialEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Same geometry as the add dialog: top edge at 33vh (top-1/3,
        // translate-y-0) and on the content column axis via `center`.
        className="top-1/3 translate-y-0 sm:max-w-sm"
        style={center != null ? { left: center } : undefined}
      >
        <CredentialEditDialogForm
          credential={credential}
          onSuccess={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

function CredentialEditDialogForm({
  credential,
  onSuccess,
}: {
  credential: Credential
  onSuccess: () => void
}) {
  const { update, remove } = useCredentials()
  const [serverError, setServerError] = useState<string | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [submitting, startSubmitting] = useTransition()
  const [deleting, startDeleting] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Open state of the provider search popover.
  const [providerOpen, setProviderOpen] = useState(false)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<UpdateCredentialInput>({
    resolver: zodResolver(updateCredentialInputSchema),
    defaultValues: {
      name: credential.name,
      // Prefilled with the stored provider; re-picking moves the credential
      // to another provider (the action then requires that provider's key).
      provider: credential.provider,
      // Blank on open: the action treats an empty key as "keep the stored
      // one", so a plain rename doesn't force a re-paste.
      apiKey: "",
    },
  })

  // The provider the form currently points at (icon + name for the trigger).
  const formProvider = providers[watch("provider")]

  function onSubmit(data: UpdateCredentialInput) {
    startSubmitting(async () => {
      setServerError(null)
      const result = await updateCredential(credential.id, {
        name: data.name,
        provider: data.provider,
        apiKey: data.apiKey?.trim() ?? "",
      })
      if (result.ok) {
        // The local row: its label or provider can have changed (a key swap
        // is invisible in metadata) — patch both onto it. Patching the
        // provider also swaps the footer pill and the model list over to the
        // new provider's models.
        update({ ...credential, name: data.name, provider: data.provider })
        toast.add({
          type: "success",
          title: "Credential updated",
          description: `${data.name} was saved.`,
        })
        onSuccess()
      } else {
        setServerError(result.error)
      }
    })
  }

  // Confirmation modal: deleting is irreversible, so the form's Save button
  // sits beside a Delete that requires an explicit second click to proceed.
  function onDelete() {
    startDeleting(async () => {
      // remove() calls the server action, then drops the row (and the
      // selection, if it was active) from local state on success.
      const result = await remove(credential.id)
      if (result.ok) {
        setConfirmOpen(false)
        onSuccess()
        toast.add({
          type: "success",
          title: "Credential deleted",
          description: `${credential.name} was removed.`,
        })
      } else {
        // Keep the editor open and surface the failure inline.
        setServerError(result.error)
      }
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit credential</DialogTitle>
        <DialogDescription>
          Rename it, swap in a fresh key, or move it to another provider.
        </DialogDescription>
      </DialogHeader>

      <form
        id="credential-edit-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit(onSubmit)}
      >
        <FieldGroup>
          {/* The provider is re-pickable (same search popover as the add
              dialog, prefilled with the stored provider). Switching it
              requires the new provider's key — enforced in the action,
              since a key always belongs to the provider it was saved for. */}
          <Field>
            <FieldLabel>Provider</FieldLabel>
            <Popover open={providerOpen} onOpenChange={setProviderOpen}>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 w-full justify-start"
                  >
                    {formProvider ? (
                      <>
                        <ProviderIcon provider={formProvider} />
                        {formProvider.name}
                      </>
                    ) : (
                      "Select provider…"
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
                            setValue("provider", item.id, {
                              shouldValidate: true,
                            })
                            setProviderOpen(false)
                            setServerError(null)
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
            <FieldDescription>
              Switching providers requires the new provider&rsquo;s key.
            </FieldDescription>
          </Field>

          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="credential-edit-name">Name</FieldLabel>
            <Input
              id="credential-edit-name"
              aria-invalid={!!errors.name}
              autoComplete="off"
              spellCheck={false}
              {...register("name")}
            />
            <FieldError>{errors?.name?.message}</FieldError>
          </Field>

          <Field data-invalid={!!errors.apiKey}>
            <FieldLabel htmlFor="credential-edit-key">API key</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="credential-edit-key"
                type={showKey ? "text" : "password"}
                placeholder="Leave blank to keep the current key"
                aria-invalid={!!errors.apiKey}
                autoComplete="off"
                spellCheck={false}
                className="flex-1"
                {...register("apiKey")}
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
            <FieldError>{errors?.apiKey?.message}</FieldError>
            <FieldDescription>
              Blank keeps the stored key — required when you switch providers.
            </FieldDescription>
          </Field>
        </FieldGroup>
      </form>

      {serverError && (
        <p role="alert" className="text-sm text-destructive">
          {serverError}
        </p>
      )}

      <DialogFooter className="justify-between">
        {/* Delete lives on the opposite side from Save so it reads as a
            distinct, deliberate action rather than part of the submit row. */}
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogTrigger
            render={
              <Button
                type="button"
                variant="destructive"
                disabled={submitting}
                onClick={() => setServerError(null)}
              >
                <TrashIcon data-icon="inline-start" />
                Delete
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {credential.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the credential and its API key. It can&rsquo;t be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                disabled={deleting}
                aria-busy={deleting}
                onClick={onDelete}
              >
                {deleting && <Spinner data-icon="inline-start" />}
                Delete credential
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="flex gap-2">
          <DialogClose
            render={
              <Button type="button" variant="outline" disabled={submitting}>
                Cancel
              </Button>
            }
          />
          <Button
            type="submit"
            form="credential-edit-form"
            disabled={submitting}
            aria-busy={submitting}
          >
            {submitting && <Spinner data-icon="inline-start" />}
            Save changes
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}
