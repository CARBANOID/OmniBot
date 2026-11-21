"use client"

import { useTransition, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { CheckIcon } from "lucide-react"
import { useRouter } from "next/navigation"

import { createGroupChat } from "@/actions/group-chat"
import { ChatAvatar } from "@/components/chat-avatar"
import { GroupChatAvatar } from "@/components/group-chat-avatar"
import { awaitRendered, sidebarRowPresent } from "@/components/render-wait"
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
  const router = useRouter()
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

  // Create with an honest toast lifecycle (mirror of the group editor's).
  // The visible change is the new sidebar row, which lands one RSC re-render
  // of the chat lists after the action commits, so a bare "Created" toast
  // would race ahead of it: a loading toast covers the gap, the lists
  // re-render, and only then does that same toast flip to success.
  // `timeout: 0` stops the pending toast auto-dismissing; the swap passes an
  // explicit timeout to re-arm it.
  function onSubmit(data: GroupChatInput) {
    startTransition(async () => {
      // The membership in join (bot-list) order — the same order the server
      // rewrites membership in, so the row's avatar is exactly these faces,
      // in this order.
      const memberSeeds = selectedBots.map((bot) => bot.avatar)
      const pending = toast.add({
        type: "loading",
        title: "Creating your group chat",
        description: `Assembling ${data.name}…`,
        timeout: 0,
      })
      try {
        const result = await createGroupChat(data)
        if (!result.ok) {
          // Errors surface inline in the dialog, never as toasts.
          toast.close(pending)
          setServerError(result.error)
          return
        }
        // The dialog must keep the name and the picked bots (the member
        // preview) visible until the new row is on screen — `reset` would
        // blank both while the button still loads. The tidy-up happens after
        // the gate, on the way to closing, so it is never seen.
        setServerError(null)
        // Re-render the chat lists (sidebar) from the new row first…
        try {
          await router.refresh()
        } catch (refreshError) {
          // …and hold the toast until the row (the component we created) has
          // actually re-rendered to the saved name and membership and
          // painted them. A refresh hiccup doesn't hang us: the wait has a
          // ceiling, so it degrades to success (the create already committed)
          // past the ceiling.
          console.error(
            "[GroupChatDialog] Refresh after create failed:",
            refreshError
          )
        }
        await awaitRendered(
          () => sidebarRowPresent(data.name, memberSeeds),
          "the new sidebar row"
        )
        toast.update(pending, {
          type: "success",
          title: `Created "${data.name}"`,
          description: `${data.botIds.length} bots will talk to you there.`,
          timeout: 4000,
        })
        // The change is on screen and the success toast is up — only now tidy
        // the form (clear the name and the member picks) so the NEXT open
        // starts clean, and close it. Batched with the close, so none of it
        // is ever visible.
        reset(emptyValues)
        onSuccess()
      } catch (error) {
        toast.close(pending)
        console.error("[GroupChatDialog] Create failed:", error)
        setServerError("Could not create your group chat. Please try again.")
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
