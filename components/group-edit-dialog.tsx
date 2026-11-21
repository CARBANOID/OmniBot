"use client"

import { useTransition, useState } from "react"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { CheckIcon, TrashIcon } from "lucide-react"

import { deleteGroupChat, updateGroupChat } from "@/actions/group-chat"
import { ChatAvatar } from "@/components/chat-avatar"
import { GroupChatAvatar } from "@/components/group-chat-avatar"
import {
  awaitRendered,
  groupHeaderRendered,
  sidebarRowGone,
} from "@/components/render-wait"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
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
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import {
  type GroupChatBot,
  updateGroupChatInputSchema,
  type UpdateGroupChatInput,
} from "@/lib/validations/chat"
import type { ChatMemberInfo } from "@/queries/chat"

export interface GroupEditDialogProps {
  /** The group chat's row id — the update/delete actions act on it. */
  id: string
  // The chat's current display name — prefills the form and stands in on
  // the trigger button.
  name: string
  // The chat's current members, in join order — preselected in the picker,
  // and whose faces tile the group avatar next to the name.
  members: ChatMemberInfo[]
  // The signed-in user's bots — the pool the member picker offers. The
  // server actions re-validate ownership, so this list is a convenience,
  // not an authority.
  bots: GroupChatBot[]
  /** Called after a successful delete, before the post-delete navigation. */
  onDeleted?: () => void
}

// The header turns the group's avatar + name into this button to open the
// editor — the group-chat twin of BotEditDialog.
export function GroupEditDialog({
  id,
  name,
  members,
  bots,
  onDeleted,
}: GroupEditDialogProps) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            // Hugs the avatar + name: it may shrink (and the name truncate)
            // but never grows to fill the row, so only the title is the
            // click target.
            className="min-w-0 gap-2 px-2"
          >
            <GroupChatAvatar
              seeds={members.map((member) => member.avatar)}
              className="size-7"
            />
            <span className="truncate text-sm font-medium">{name}</span>
          </Button>
        }
      />
      <GroupEditDialogContent
        id={id}
        name={name}
        members={members}
        bots={bots}
        onSuccess={() => setOpen(false)}
        onDeleted={onDeleted}
      />
    </Dialog>
  )
}

function GroupEditDialogContent({
  id,
  name,
  members,
  bots,
  onSuccess,
  onDeleted,
}: Omit<GroupEditDialogProps, "onDeleted"> & {
  onSuccess: () => void
  onDeleted?: () => void
}) {
  return (
    <DialogContent className="sm:max-w-md">
      <GroupEditDialogForm
        id={id}
        name={name}
        members={members}
        bots={bots}
        onSuccess={onSuccess}
        onDeleted={onDeleted}
      />
    </DialogContent>
  )
}

function GroupEditDialogForm({
  id,
  name,
  members,
  bots,
  onSuccess,
  onDeleted,
}: {
  id: string
  name: string
  members: ChatMemberInfo[]
  bots: GroupChatBot[]
  onSuccess: () => void
  onDeleted?: () => void
}) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, startSubmitting] = useTransition()
  const [deleting, startDeleting] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const {
    register,
    setValue,
    watch,
    handleSubmit,
    formState: { errors },
  } = useForm<UpdateGroupChatInput>({
    resolver: zodResolver(updateGroupChatInputSchema),
    // Prefill from the chat's current state: its name, and its current
    // membership already checked in the picker.
    defaultValues: {
      name,
      botIds: members.map((member) => member.id),
    },
  })

  const selectedIds = watch("botIds", [])
  // The selected bots in the user's bot-list order — the same order the
  // server rewrites membership in, so the preview shows exactly the avatar
  // the sidebar will get (and the first face is the default voice).
  const selectedBots = bots.filter((bot) => selectedIds.includes(bot.id))

  function toggle(botId: string) {
    setServerError(null)
    setValue(
      "botIds",
      selectedIds.includes(botId)
        ? selectedIds.filter((selected) => selected !== botId)
        : [...selectedIds, botId],
      { shouldValidate: true }
    )
  }

  // Save with an honest toast lifecycle. The visible change (the sidebar's
  // name and avatar tiles) lands one RSC re-render *after* the action
  // commits, so a plain "Saved" toast would beat the change itself onto the
  // screen. Instead: a loading toast covers the whole gap, the page is
  // re-rendered from the saved rows, and only then does that same toast
  // become the success toast. `timeout: 0` keeps a pending toast from
  // auto-dismissing mid-work; the swap passes an explicit timeout, which
  // re-arms the normal auto-dismiss of the finished one.
  function onSubmit(data: UpdateGroupChatInput) {
    startSubmitting(async () => {
      setServerError(null)
      const pending = toast.add({
        type: "loading",
        title: "Saving group chat",
        description: `Applying changes to ${data.name}…`,
        timeout: 0,
      })
      try {
        const result = await updateGroupChat(id, data)
        if (!result.ok) {
          // Errors surface inline in the dialog, never as toasts.
          toast.close(pending)
          setServerError(result.error)
          return
        }
        // Re-render the lists (sidebar) from the saved rows first…
        try {
          await router.refresh()
        } catch (refreshError) {
          // …and hold the toast until the header (the component we edited) has
          // actually re-rendered to the new name and faces and painted them. A
          // refresh hiccup doesn't hang us: the wait has a ceiling, so it
          // degrades to success (the save already committed) past the ceiling.
          console.error(
            "[GroupEditDialog] Refresh after save failed:",
            refreshError
          )
        }
        // The group avatar paints the first three members in join (bot-list)
        // order plus a >3 count tile. `selectedBots` is in that same order —
        // the server rewrites membership in bot-list order too — so its face
        // seeds are exactly what the new header should show. Pass the whole
        // list; the match picks the faces and count that actually render.
        const memberSeeds = selectedBots.map((bot) => bot.avatar)
        await awaitRendered(
          () => groupHeaderRendered(data.name, memberSeeds),
          "the chat header with the saved name and faces"
        )
        toast.update(pending, {
          type: "success",
          title: "Group chat updated",
          description: `${data.name} was saved.`,
          timeout: 4000,
        })
        onSuccess()
      } catch (error) {
        console.error("[GroupEditDialog] Save failed:", error)
        toast.close(pending)
        setServerError("Could not save your changes. Please try again.")
      }
    })
  }

  // Confirmation modal: the group chat disappears whole (its whole
  // conversation), so the Delete beside Save needs an explicit second click.
  // Same toast lifecycle as Save — but the change only becomes visible after
  // leaving this page, so the loading toast rides until home's fresh list is
  // up, then flips to success.
  function onDelete() {
    startDeleting(async () => {
      const pending = toast.add({
        type: "loading",
        title: "Deleting group chat",
        description: `Removing ${name} and its conversation…`,
        timeout: 0,
      })
      try {
        const result = await deleteGroupChat(id)
        if (!result.ok) {
          toast.close(pending)
          // Keep the dialog open and surface the failure inline.
          setServerError(result.error)
          return
        }
        setConfirmOpen(false)
        // The chat this dialog edited is gone — leave it. The URL flip is
        // NOT the finish line: in this router `replace()` resolves before the
        // destination has even fetched its data, so pathname alone reads true
        // while the sidebar still shows the deleted group. Gate on the
        // content instead — home on screen AND this group's row actually
        // gone — which can only be read against the freshly rendered state.
        try {
          await router.replace("/")
        } catch (navigateError) {
          console.error(
            "[GroupEditDialog] Navigation after delete failed:",
            navigateError
          )
        }
        // `members` is the chat's membership in join order — the same faces
        // (and >3 count tile) its sidebar row paints.
        await awaitRendered(
          () =>
            window.location.pathname === "/" &&
            sidebarRowGone(name, members.map((member) => member.avatar)),
          "home with the deleted group's row gone"
        )
        toast.update(pending, {
          type: "success",
          title: "Group chat deleted",
          description: `${name} was removed.`,
          timeout: 4000,
        })
        onDeleted?.()
      } catch (error) {
        console.error("[GroupEditDialog] Delete failed:", error)
        toast.close(pending)
        setServerError("Could not delete the group chat. Please try again.")
      }
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit group chat</DialogTitle>
        <DialogDescription>
          Rename it, add or remove bots, or delete the chat.
        </DialogDescription>
      </DialogHeader>

      <form
        id="group-edit-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit(onSubmit)}
      >
        <FieldGroup>
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

          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="group-edit-name">Name</FieldLabel>
            <Input
              id="group-edit-name"
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
              <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the group chat and its whole conversation. The
                bots themselves stay — only their membership is gone. It
                can&rsquo;t be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>
                Cancel
              </AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                disabled={deleting}
                aria-busy={deleting}
                onClick={onDelete}
              >
                {deleting && <Spinner data-icon="inline-start" />}
                Delete group chat
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
            form="group-edit-form"
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
