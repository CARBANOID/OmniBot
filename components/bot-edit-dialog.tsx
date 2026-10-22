"use client"

import { useTransition, useState } from "react"
import { useRouter } from "next/navigation"
import { nanoid } from "nanoid"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { ShuffleIcon, TrashIcon } from "lucide-react"

import { deleteBot, updateBot } from "@/actions/bot"
import { ChatAvatar } from "@/components/chat-avatar"
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

  function onSubmit(data: UpdateBotInput) {
    startSubmitting(async () => {
      setServerError(null)
      const result = await updateBot(bot.id, { ...data, avatar: seed })
      if (result.ok) {
        toast.add({
          type: "success",
          title: "Bot updated",
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
      const result = await deleteBot(bot.id)
      if (result.ok) {
        setConfirmOpen(false)
        toast.add({
          type: "success",
          title: "Bot deleted",
          description: `${bot.name} was removed.`,
        })
        onDeleted?.()
        // The chat this edited is gone (an empty direct chat is dropped with
        // its only bot), so leave it — home re-renders the fresh chat list.
        router.replace("/")
      } else {
        // Keep the editor open and surface the failure inline.
        setServerError(result.error)
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
