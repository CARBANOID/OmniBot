"use client"

import { useTransition, useState } from "react"
import { useRouter } from "next/navigation"
import { nanoid } from "nanoid"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { ShuffleIcon, TrashIcon } from "lucide-react"

import { deleteBot, updateBot } from "@/actions/bot"
import { ChatAvatar } from "@/components/chat-avatar"
import {
  awaitRendered,
  botHeaderRendered,
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
import { Textarea } from "@/components/ui/textarea"
import {
  type EditableBot,
  updateBotInputSchema,
  type UpdateBotInput,
} from "@/lib/validations/bot"

export interface BotEditDialogProps {
  /** The existing bot to edit; its fields prefill the form. */
  bot: EditableBot
  /**
   * The name shown on the trigger. Falls back to `bot.name`. Pass the header's
   * display name here so a group chat keeps its own title on the button.
   */
  label?: string
  /** Called after a successful delete, before the post-delete navigation. */
  onDeleted?: () => void
}

// The header turns its avatar + name into this button to open the editor.
export function BotEditDialog({ bot, label, onDeleted }: BotEditDialogProps) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            // Hugs the avatar + name: it may shrink (and the name truncate) but
            // never grows to fill the row, so only the title is the click target.
            className="min-w-0 gap-2 px-2"
          >
            <ChatAvatar seed={bot.avatar} className="size-7" />
            <span className="truncate text-sm font-medium">
              {label ?? bot.name}
            </span>
          </Button>
        }
      />
      <BotEditDialogContent
        bot={bot}
        onSuccess={() => setOpen(false)}
        onDeleted={onDeleted}
      />
    </Dialog>
  )
}

export function BotEditDialogContent({
  bot,
  onSuccess,
  onDeleted,
}: {
  bot: EditableBot
  onSuccess: () => void
  onDeleted?: () => void
}) {
  return (
    <DialogContent className="sm:max-w-md">
      <BotEditDialogForm
        bot={bot}
        onSuccess={onSuccess}
        onDeleted={onDeleted}
      />
    </DialogContent>
  )
}

function BotEditDialogForm({
  bot,
  onSuccess,
  onDeleted,
}: {
  bot: EditableBot
  onSuccess: () => void
  onDeleted?: () => void
}) {
  const router = useRouter()
  const [seed, setSeed] = useState(bot.avatar)
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, startSubmitting] = useTransition()
  const [deleting, startDeleting] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<UpdateBotInput>({
    resolver: zodResolver(updateBotInputSchema),
    defaultValues: {
      name: bot.name,
      job: bot.job,
      // The column is nullable; prefill with whatever the bot has (blank if
      // none) so the form doesn't fight an empty field.
      instructions: bot.instructions ?? "",
    },
  })

  // Save with an honest toast lifecycle (mirror of the group editor's). The
  // sidebar's name and face re-render one RSC round trip after the action
  // commits, so a bare "Saved" toast would race ahead of the change: a
  // loading toast covers the gap, the lists re-render, and only then does
  // that same toast flip to success. `timeout: 0` stops the pending toast
  // auto-dismissing; the swap passes an explicit timeout to re-arm it.
  function onSubmit(data: UpdateBotInput) {
    startSubmitting(async () => {
      setServerError(null)
      const pending = toast.add({
        type: "loading",
        title: "Saving bot",
        description: `Applying changes to ${data.name}…`,
        timeout: 0,
      })
      try {
        const result = await updateBot(bot.id, { ...data, avatar: seed })
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
          // actually re-rendered to the new name and face and painted them. A
          // refresh hiccup doesn't hang us: the wait has a ceiling, so it
          // degrades to success (the save already committed) past the ceiling.
          console.error(
            "[BotEditDialog] Refresh after save failed:",
            refreshError
          )
        }
        // `seed` (set by the Shuffle button, saved as the bot's avatar) is the
        // single face the header's avatar will paint, with the saved name.
        await awaitRendered(
          () => botHeaderRendered(data.name, seed),
          "the chat header with the saved name and face"
        )
        toast.update(pending, {
          type: "success",
          title: "Bot updated",
          description: `${data.name} was saved.`,
          timeout: 4000,
        })
        onSuccess()
      } catch (error) {
        console.error("[BotEditDialog] Save failed:", error)
        toast.close(pending)
        setServerError("Could not save your bot. Please try again.")
      }
    })
  }

  // Confirmation modal: deleting is irreversible, so the form's Save button
  // sits beside a Delete that requires an explicit second click to proceed.
  // Same toast lifecycle as Save — the deletion only becomes visible after
  // leaving, so the loading toast rides until home's fresh list is up.
  function onDelete() {
    startDeleting(async () => {
      const pending = toast.add({
        type: "loading",
        title: "Deleting bot",
        description: `Removing ${bot.name}…`,
        timeout: 0,
      })
      try {
        const result = await deleteBot(bot.id)
        if (!result.ok) {
          toast.close(pending)
          // Keep the editor open and surface the failure inline.
          setServerError(result.error)
          return
        }
        setConfirmOpen(false)
        // The chat this edited is gone (an empty direct chat is dropped with
        // its only bot) — leave it. The URL flip is NOT the finish line: in
        // this router `replace()` resolves before the destination has even
        // fetched its data, so pathname alone reads true while the sidebar
        // still shows the deleted row. Gate on the content instead — home
        // on screen AND the bot's row actually gone — which can only be
        // read against the freshly rendered state.
        try {
          await router.replace("/")
        } catch (navigateError) {
          console.error(
            "[BotEditDialog] Navigation after delete failed:",
            navigateError
          )
        }
        await awaitRendered(
          () =>
            window.location.pathname === "/" &&
            sidebarRowGone(bot.name, [bot.avatar]),
          "home with the deleted bot's row gone"
        )
        toast.update(pending, {
          type: "success",
          title: "Bot deleted",
          description: `${bot.name} was removed.`,
          timeout: 4000,
        })
        onDeleted?.()
      } catch (error) {
        console.error("[BotEditDialog] Delete failed:", error)
        toast.close(pending)
        setServerError("Could not delete your bot. Please try again.")
      }
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit bot</DialogTitle>
        <DialogDescription>
          Update the name, the job, or shuffle the face.
        </DialogDescription>
      </DialogHeader>

      <form
        id="bot-edit-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit(onSubmit)}
      >
        <FieldGroup>
          <Field orientation="horizontal">
            <ChatAvatar seed={seed} className="size-9 self-center" />
            <FieldContent>
              <FieldTitle>Face</FieldTitle>
              <FieldDescription>
                Shuffle until you find one you like.
              </FieldDescription>
            </FieldContent>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSeed(nanoid())}
            >
              <ShuffleIcon data-icon="inline-start" />
              Shuffle
            </Button>
          </Field>

          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="bot-edit-name">Name</FieldLabel>
            <Input
              id="bot-edit-name"
              aria-invalid={!!errors.name}
              {...register("name")}
            />
            <FieldError>{errors?.name?.message}</FieldError>
          </Field>

          <Field data-invalid={!!errors.job}>
            <FieldLabel htmlFor="bot-edit-job">Job</FieldLabel>
            <Input
              id="bot-edit-job"
              aria-invalid={!!errors.job}
              {...register("job")}
            />
            <FieldError>{errors?.job?.message}</FieldError>
          </Field>

          <Field data-invalid={!!errors.instructions}>
            <FieldLabel htmlFor="bot-edit-instructions">
              How it should work
            </FieldLabel>
            <Textarea
              id="bot-edit-instructions"
              rows={4}
              aria-invalid={!!errors.instructions}
              {...register("instructions")}
            />
            <FieldError>{errors?.instructions?.message}</FieldError>
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
              <AlertDialogTitle>Delete {bot.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the bot and its direct chat. It can&rsquo;t be
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
                Delete bot
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
            form="bot-edit-form"
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
