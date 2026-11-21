"use client"

import { useTransition, useState } from "react"
import { nanoid } from "nanoid"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { PlusIcon, ShuffleIcon } from "lucide-react"
import { useRouter } from "next/navigation"

import { createBot } from "@/actions/bot"
import { ChatAvatar } from "@/components/chat-avatar"
import { awaitRendered, sidebarRowPresent } from "@/components/render-wait"
import { Button } from "@/components/ui/button"
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
import { Textarea } from "@/components/ui/textarea"
import { createBotInputSchema, type BotInput } from "@/lib/validations/bot"

// Starting points for what a bot should do — each preset fills the Job
// and "How it should work" fields.
const templates = [
  {
    label: "Research assistant",
    job: "Research assistant",
    instructions:
      "Answer briefly, cite sources, and ask before running anything destructive.",
  },
  {
    label: "Code reviewer",
    job: "Code reviewer",
    instructions:
      "Review for bugs, security issues, and clarity. Suggest concrete fixes and explain trade-offs.",
  },
  {
    label: "Writing editor",
    job: "Writing editor",
    instructions:
      "Tighten the prose, fix grammar, and keep the author's voice. Flag anything overwrought.",
  },
  {
    label: "Tutor",
    job: "Tutor",
    instructions:
      "Explain concepts step by step and check understanding with a quick question after each step.",
  },
] as const

const emptyValues: BotInput = { name: "", job: "", instructions: "" }

export function BotDialog() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="lg">
            <PlusIcon data-icon="inline-start" />
            Create a new bot
          </Button>
        }
      />
      <BotDialogContent onSuccess={() => setOpen(false)} />
    </Dialog>
  )
}

export function BotDialogContent({ onSuccess }: { onSuccess: () => void }) {
  return (
    <DialogContent className="sm:max-w-md">
      <BotDialogForm onSuccess={onSuccess} />
    </DialogContent>
  )
}

function BotDialogForm({ onSuccess }: { onSuccess: () => void }) {
  const router = useRouter()
  const [seed, setSeed] = useState(() => nanoid())
  const [serverError, setServerError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const {
    register,
    setValue,
    reset,
    handleSubmit,
    formState: { errors },
  } = useForm<BotInput>({
    resolver: zodResolver(createBotInputSchema),
    defaultValues: emptyValues,
  })

  function applyTemplate(template: (typeof templates)[number]) {
    setServerError(null)
    setValue("job", template.job, { shouldValidate: true })
    setValue("instructions", template.instructions, { shouldValidate: true })
  }

  // Create with an honest toast lifecycle (mirror of the bot editor's). The
  // visible change is the new sidebar row, which lands one RSC re-render of
  // the chat lists after the action commits, so a bare "ready" toast would
  // race ahead of it: a loading toast covers the gap, the lists re-render,
  // and only then does that same toast flip to success. `timeout: 0` stops
  // the pending toast auto-dismissing; the swap passes an explicit timeout
  // to re-arm it.
  function onSubmit(data: BotInput) {
    startTransition(async () => {
      const pending = toast.add({
        type: "loading",
        title: "Creating your bot",
        description: `Spinning up ${data.name}'s sandbox…`,
        timeout: 0,
      })
      try {
        const result = await createBot({ ...data, avatar: seed })
        if (!result.ok) {
          // Errors surface inline in the dialog, never as toasts.
          toast.close(pending)
          setServerError(result.error)
          return
        }
        // The dialog must keep showing exactly what the user submitted —
        // name, job, face — until the new row is on screen. Clearing the
        // form (or re-rolling the face) here would flash it to defaults
        // while the button still loads. The tidy-up happens after the gate,
        // on the way to closing, so it is never seen.
        setServerError(null)
        // Re-render the chat lists (sidebar) from the new row first…
        try {
          await router.refresh()
        } catch (refreshError) {
          // …and hold the toast until the row (the component we created) has
          // actually re-rendered to the saved name and face and painted
          // them. A refresh hiccup doesn't hang us: the wait has a ceiling,
          // so it degrades to success (the create already committed) past
          // the ceiling.
          console.error(
            "[BotDialog] Refresh after create failed:",
            refreshError
          )
        }
        // `seed` (submitted as the bot's avatar) is the single face the new
        // row's avatar paints, alongside the saved name.
        await awaitRendered(
          () => sidebarRowPresent(data.name, [seed]),
          "the new sidebar row"
        )
        toast.update(pending, {
          type: "success",
          title: `${data.name} is ready`,
          description: "Your new bot was created.",
          timeout: 4000,
        })
        // The change is on screen and the success toast is up — only now tidy
        // the form so the NEXT open starts clean, and close it. Batched with
        // the close, so none of it is ever visible.
        reset(emptyValues)
        setSeed(nanoid())
        onSuccess()
      } catch (error) {
        toast.close(pending)
        console.error("[BotDialog] Create failed:", error)
        setServerError("Could not create your bot. Please try again.")
      }
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>New bot</DialogTitle>
        <DialogDescription>
          Give it a face, a name, and a job to do.
        </DialogDescription>
      </DialogHeader>

      <form
        id="bot-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={handleSubmit(onSubmit)}
      >
        <div className="flex flex-wrap gap-2">
          {templates.map((template) => (
            <Button
              key={template.label}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyTemplate(template)}
            >
              {template.label}
            </Button>
          ))}
        </div>

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
            <FieldLabel htmlFor="bot-name">Name</FieldLabel>
            <Input
              id="bot-name"
              placeholder="Ada"
              aria-invalid={!!errors.name}
              {...register("name")}
            />
            <FieldError>{errors?.name?.message}</FieldError>
          </Field>

          <Field data-invalid={!!errors.job}>
            <FieldLabel htmlFor="bot-job">Job</FieldLabel>
            <Input
              id="bot-job"
              placeholder="Research assistant"
              aria-invalid={!!errors.job}
              {...register("job")}
            />
            <FieldError>{errors?.job?.message}</FieldError>
          </Field>

          <Field data-invalid={!!errors.instructions}>
            <FieldLabel htmlFor="bot-instructions">
              How it should work
            </FieldLabel>
            <Textarea
              id="bot-instructions"
              rows={4}
              placeholder="Answer briefly, cite sources, and ask before running anything destructive."
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
          form="bot-form"
          disabled={isPending}
          aria-busy={isPending}
        >
          {isPending && <Spinner data-icon="inline-start" />}
          Create bot
        </Button>
      </DialogFooter>
    </>
  )
}
