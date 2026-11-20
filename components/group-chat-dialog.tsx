"use client"

import { useTransition, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { CheckIcon } from "lucide-react"

import { createGroupChat } from "@/actions/group-chat"
import { ChatAvatar } from "@/components/chat-avatar"
import { GroupChatAvatar } from "@/components/group-chat-avatar"
import { Button } from "@/components/ui/button"
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import {
  createGroupChatInputSchema,
  type GroupChatBot,
  type GroupChatInput,
} from "@/lib/validations/chat"

const emptyValues: GroupChatInput = { name: "", botIds: [] }

// The dialog is mounted by its host (the sidebar's "Create a group chat"
// dropdown); this is the controlled content, mirroring BotDialogContent.
export interface GroupChatDialogContentProps {
  // The signed-in user's bots — the pool the member pick offers. The server
  // action re-validates ownership, so this list is a convenience, not an
  // authority.
  bots: GroupChatBot[]
  onSuccess: () => void
}

export function GroupChatDialogContent({
  bots,
  onSuccess,
}: GroupChatDialogContentProps) {
  return (
    <DialogContent className="sm:max-w-md">
      <GroupChatDialogForm bots={bots} onSuccess={onSuccess} />
    </DialogContent>
  )
}

function GroupChatDialogForm({
  bots,
  onSuccess,
}: {
  bots: GroupChatBot[]
  onSuccess: () => void
}) {
  const [serverError, setServerError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const {
    register,
    setValue,
    watch,
    reset,
    handleSubmit,
    formState: { errors },
  } = useForm<GroupChatInput>({
    resolver: zodResolver(createGroupChatInputSchema),
    defaultValues: emptyValues,
  })

  const selectedIds = watch("botIds", [])
  // The selected bots in the server's membership order (the user's bot-list
  // order) — the preview shows exactly the avatar the sidebar will get.
  const selectedBots = bots.filter((bot) => selectedIds.includes(bot.id))

  function toggle(id: string) {
    setServerError(null)
    setValue(
      "botIds",
      selectedIds.includes(id)
        ? selectedIds.filter((selected) => selected !== id)
        : [...selectedIds, id],
      { shouldValidate: true }
    )
  }

  function onSubmit(data: GroupChatInput) {
    startTransition(async () => {
      const result = await createGroupChat(data)
      if (result.ok) {
        reset(emptyValues)
        setServerError(null)
        toast.add({
          type: "success",
          title: `Created "${data.name}"`,
          description: `${data.botIds.length} bots will talk to you there.`,
        })
        onSuccess()
      } else {
        setServerError(result.error)
      }
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>New group chat</DialogTitle>
        <DialogDescription>
          Name the chat and pick the bots that join it.
        </DialogDescription>
      </DialogHeader>

      <form
        id="group-chat-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit(onSubmit)}
      >
        {selectedBots.length > 0 && (
          <Field orientation="horizontal">
            <GroupChatAvatar
              seeds={selectedBots.map((bot) => bot.avatar)}
              className="size-9 self-center"
            />
            <FieldContent>
              <FieldTitle>Face</FieldTitle>
              <FieldDescription>
                This is how the chat shows up in your list.
              </FieldDescription>
            </FieldContent>
          </Field>
        )}

        <FieldGroup>
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="group-chat-name">Name</FieldLabel>
            <Input
              id="group-chat-name"
              placeholder="Late night project room"
              aria-invalid={!!errors.name}
              {...register("name")}
            />
            <FieldError>{errors?.name?.message}</FieldError>
          </Field>

          <Field data-invalid={!!errors.botIds}>
            <FieldLabel>Bots</FieldLabel>
            <div
              role="listbox"
              aria-multiselectable
              aria-label="Bots that join the chat"
              className="flex max-h-56 flex-col gap-0.5 overflow-auto rounded-lg border border-input p-1"
            >
              {bots.length === 0 ? (
                <p className="p-2 text-xs text-muted-foreground">
                  You need at least two bots before a group chat can form.
                </p>
              ) : (
                bots.map((bot) => {
                  const isSelected = selectedIds.includes(bot.id)
                  return (
                    <Button
                      key={bot.id}
                      type="button"
                      variant="ghost"
                      aria-pressed={isSelected}
                      className="h-auto w-full justify-start gap-2.5 rounded-md px-2 py-2"
                      onClick={() => toggle(bot.id)}
                    >
                      <ChatAvatar seed={bot.avatar} className="size-6" />
                      <span className="min-w-0 flex-1 truncate text-left text-sm">
                        {bot.name}
                      </span>
                      {isSelected && (
                        <CheckIcon className="size-4 shrink-0" />
                      )}
                    </Button>
                  )
                })
              )}
            </div>
            <FieldError>{errors?.botIds?.message}</FieldError>
          </Field>
        </FieldGroup>
      </form>

      {serverError && (
        <p role="alert" className="text-sm text-destructive">
          {serverError}
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
        <Button
          type="submit"
          form="group-chat-form"
          disabled={isPending}
          aria-busy={isPending}
        >
          {isPending && <Spinner data-icon="inline-start" />}
          Create group chat
        </Button>
      </DialogFooter>
    </>
  )
}
