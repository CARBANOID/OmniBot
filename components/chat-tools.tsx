"use client"

import type { UIDataTypes, UIMessage, UIMessagePart, UITools } from "ai"
import {
  BanIcon,
  CheckIcon,
  ChevronRightIcon,
  FilePenLineIcon,
  FileTextIcon,
  FolderIcon,
  KeyboardIcon,
  MonitorIcon,
  MouseIcon,
  MousePointerClickIcon,
  PlusIcon,
  MousePointerIcon,
  TerminalIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useState } from "react"

import { MessageResponse } from "@/components/ai-elements/message"
import { ChatAvatar } from "@/components/chat-avatar"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Spinner } from "@/components/ui/spinner"
import type { ChatMemberInfo } from "@/queries/chat"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Tool calls in the conversation
//
// Every assistant message part starting with `tool-` is one of the bot's
// sandbox tool calls. Two are treated specially:
//   • view_screen  — the model's own look at the desktop; the user never
//     sees it, so it renders nothing.
//   • show_screen  — a screenshot the bot shared with the user; the part's
//     output carries the image and renders as an <img>.
// The rest are actions (shell, files, mouse, keyboard) and render as a
// compact, expandable row: icon, label, the arguments in one line, and —
// once the call has landed — its result.
//
// UIMessage parts come back as a loose union, and a stored part's input and
// output is plain data read from a transcript, so the fields below are read
// defensively through the `invocation` view — never through a tool's concrete
// schema (the tool set may even have changed between turns).
// ---------------------------------------------------------------------------

/** A message part with the message's default (open) data + tool types. */
type Part = UIMessagePart<UIDataTypes, UITools>

interface Invocation {
  state: string
  input?: Record<string, unknown>
  output?: unknown
  errorText?: string
}

function asInvocation(part: Part): Invocation {
  return part as unknown as Invocation
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {}
}

type Tone = "running" | "done" | "error" | "denied"

function toneOf(inv: Invocation): Tone {
  if (inv.state === "output-available") {
    // A caught failure in the sandbox lands as `{ ok: false, error }` —
    // that is an error for rendering purposes too.
    return asRecord(inv.output).ok === false ? "error" : "done"
  }
  if (inv.state === "output-error") return "error"
  if (inv.state === "output-denied") return "denied"
  // input-streaming, input-available, approval-*
  return "running"
}

const TOOLS: Record<string, { name: string; icon: LucideIcon }> = {
  run_bash: { name: "Run command", icon: TerminalIcon },
  read_file: { name: "Read file", icon: FileTextIcon },
  write_file: { name: "Write file", icon: FilePenLineIcon },
  list_files: { name: "List files", icon: FolderIcon },
  mouse_click: { name: "Click", icon: MousePointerClickIcon },
  mouse_move: { name: "Move mouse", icon: MousePointerIcon },
  mouse_scroll: { name: "Scroll", icon: MouseIcon },
  keyboard_type: { name: "Type text", icon: KeyboardIcon },
  keyboard_press: { name: "Press key", icon: KeyboardIcon },
  view_screen: { name: "View screen", icon: MonitorIcon },
  show_screen: { name: "Share screen", icon: MonitorIcon },
}

function meta(toolName: string): { name: string; icon: LucideIcon } {
  return TOOLS[toolName] ?? { name: toolName, icon: WrenchIcon }
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(1, max - 1))}…` : value
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

/** The one-line argument summary in the row's header. null when there is none. */
function argSummary(
  toolName: string,
  input: Record<string, unknown> | undefined
): string | null {
  if (!input) return null
  const str = (key: string): string | undefined => {
    const value = input[key]
    return typeof value === "string" && value.length > 0 ? value : undefined
  }
  const num = (key: string): number | undefined =>
    typeof input[key] === "number" ? input[key] : undefined

  switch (toolName) {
    case "run_bash": {
      const command = str("command")
      return command ? clip(oneLine(command), 64) : null
    }
    case "read_file": {
      const path = str("path")
      if (!path) return null
      const offset = num("offset")
      return clip(oneLine(path) + (offset ? ` from line ${offset}` : ""), 64)
    }
    case "write_file": {
      const path = str("path")
      return path ? clip(oneLine(path), 64) : null
    }
    case "list_files":
      return clip(oneLine(str("path") ?? "."), 64)
    case "mouse_click": {
      const x = num("x")
      if (x === undefined) return null
      const button = str("button")
      return `click at ${x}, ${num("y") ?? "?"}${button && button !== "left" ? ` · ${button}` : ""}`
    }
    case "mouse_move": {
      const x = num("x")
      return x === undefined ? null : `to ${x}, ${num("y") ?? "?"}`
    }
    case "mouse_scroll": {
      const direction = str("direction")
      if (!direction) return null
      const amount = num("amount")
      return `${direction}${amount ? ` ${amount}×` : ""} at ${num("x") ?? 0}, ${num("y") ?? 0}`
    }
    case "keyboard_type": {
      const text = str("text")
      return text ? clip(`"${oneLine(text)}"`, 48) : null
    }
    case "keyboard_press": {
      const key = str("key")
      if (!key) return null
      const mods =
        Array.isArray(input.modifiers) && input.modifiers.length > 0
          ? ` + ${input.modifiers.map((m) => String(m)).join(" + ")}`
          : ""
      return clip(oneLine(key + mods), 48)
    }
    default:
      return null
  }
}

/** The short result line, shown once the output has landed. */
function resultText(toolName: string, out: Record<string, unknown>): string {
  const num = (key: string): number | null =>
    typeof out[key] === "number" ? out[key] : null
  const text = (key: string): string | null =>
    typeof out[key] === "string" ? out[key] : null

  switch (toolName) {
    case "run_bash": {
      const code = num("exitCode")
      return code !== null && code !== 0 ? `exit ${code}` : "done"
    }
    case "read_file": {
      if (out.binary === true) return "binary file"
      const start = num("startLine")
      const end = num("endLine")
      return start !== null && end !== null ? `lines ${start}–${end}` : "read"
    }
    case "write_file":
      return num("bytes") !== null ? `${num("bytes")} bytes` : "written"
    case "list_files":
      return num("count") !== null ? `${num("count")} entries` : "listed"
    case "mouse_click":
      return out.double === true ? "double click" : "click"
    case "mouse_move":
      return "moved"
    case "mouse_scroll":
      return "scrolled"
    case "keyboard_type":
      return "typed"
    case "keyboard_press": {
      const key = text("key")
      return key ? `pressed ${key}` : "pressed"
    }
    default:
      return "done"
  }
}

function errorOf(inv: Invocation): string {
  const out = asRecord(inv.output)
  if (typeof out.error === "string" && out.error) return out.error
  if (typeof inv.errorText === "string" && inv.errorText) return inv.errorText
  return "The call failed."
}

const MAX_BLOCK = 12_000 // characters of detail shown in the expanded section

function dump(value: unknown): string {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2)
  if (!text) return ""
  return text.length > MAX_BLOCK
    ? `${text.slice(0, MAX_BLOCK)}\n… [truncated]`
    : text
}

function StatusGlyph({ tone }: { tone: Tone }) {
  if (tone === "running") return <Spinner className="size-3.5" />
  if (tone === "denied") return <BanIcon className="size-3.5 text-orange-600" />
  return tone === "error" ? (
    <XIcon className="size-3.5 text-red-600" />
  ) : (
    <CheckIcon className="size-3.5 text-green-600" />
  )
}

function Block({
  label,
  text,
  tone = "default",
}: {
  label: string
  text: string
  tone?: "default" | "error"
}) {
  if (!text) return null
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <pre
        className={cn(
          "max-h-64 overflow-auto rounded-md bg-muted/50 p-2 text-xs leading-relaxed break-words whitespace-pre-wrap",
          tone === "error" && "bg-destructive/10 text-destructive"
        )}
      >
        {text}
      </pre>
    </div>
  )
}

/** The nine action tools: one compact row, expandable to args + result. */
function ToolRow({
  part,
  toolName,
  className,
}: {
  part: Part
  toolName: string
  className?: string
}) {
  const inv = asInvocation(part)
  const { name, icon: Icon } = meta(toolName)
  const tone = toneOf(inv)
  const summary = argSummary(toolName, inv.input)
  const result =
    tone === "error"
      ? null
      : inv.output !== undefined && inv.output !== null
        ? resultText(toolName, asRecord(inv.output))
        : null
  const failed = tone === "error"

  const detail = failed
    ? errorOf(inv)
    : inv.output !== undefined && inv.output !== null
      ? dump(inv.output)
      : ""

  return (
    <Collapsible
      className={cn("group not-prose max-w-full rounded-md border", className)}
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 p-2 text-left text-sm transition-colors hover:bg-muted/40">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium">{name}</span>
        {summary ? (
          <span className="min-w-0 truncate text-muted-foreground">
            {summary}
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {result ? (
            <span className="hidden truncate text-xs text-muted-foreground [max-inline-size:24ch] sm:inline">
              {result}
            </span>
          ) : null}
          <StatusGlyph tone={tone} />
          <ChevronRightIcon
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              detail ? "group-data-[state=open]:rotate-90" : "hidden"
            )}
          />
        </span>
      </CollapsibleTrigger>
      {detail ? (
        <CollapsibleContent className="flex flex-col gap-3 p-2 pl-8">
          <Block
            label={failed ? "Error" : "Result"}
            text={detail}
            tone={failed ? "error" : "default"}
          />
          {inv.input ? (
            <Block label="Arguments" text={dump(inv.input)} />
          ) : null}
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  )
}

/** show_screen: the bot's shared screenshot — the image, or its failure. */
function ScreenPart({ part, className }: { part: Part; className?: string }) {
  const inv = asInvocation(part)
  const out = asRecord(inv.output)

  // While the call is in flight (or was denied) there is no image yet.
  if (inv.state !== "output-available") {
    const failed = inv.state === "output-error" || inv.state === "output-denied"
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border p-2 text-sm",
          failed && "border-destructive/40 text-destructive",
          className
        )}
      >
        {failed ? <XIcon className="size-4" /> : <Spinner className="size-4" />}
        <MonitorIcon className="size-4 shrink-0" />
        <span>
          {failed ? "Couldn't share the screen" : "Sharing the screen…"}
        </span>
      </div>
    )
  }

  const data = typeof out.data === "string" && out.data ? out.data : null
  if (!data) {
    const message =
      typeof out.error === "string" && out.error
        ? out.error
        : "The capture did not produce an image."
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border p-2 text-sm text-destructive",
          className
        )}
      >
        <XIcon className="size-4 shrink-0" />
        <MonitorIcon className="size-4 shrink-0" />
        <span>{message}</span>
      </div>
    )
  }

  const width = typeof out.width === "number" ? out.width : null
  const height = typeof out.height === "number" ? out.height : null

  return (
    <figure className={cn("max-w-full", className)}>
      {/* A shared screenshot is a runtime data: URL of unknown dimensions —
          next/image has nothing it could optimize here. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- runtime data: URL */}
      <img
        alt="Screenshot of the bot's desktop"
        className="max-h-96 rounded-md border border-border"
        src={`data:${
          typeof out.mediaType === "string" ? out.mediaType : "image/png"
        };base64,${data}`}
      />
      {width !== null && height !== null ? (
        <figcaption className="mt-1 text-xs text-muted-foreground">
          {width}×{height}
        </figcaption>
      ) : null}
    </figure>
  )
}

/**
 * One message part: a tool call or nothing at all. Non-tool parts (text,
 * reasoning, …) render nothing — they are handled where the message is
 * mapped. `view_screen` is the model's own look at the screen and is
 * deliberately invisible to the user.
 */
export function ChatToolPart({
  part,
  className,
}: {
  part: Part
  className?: string
}) {
  const type = part.type
  if (typeof type !== "string" || !type.startsWith("tool-")) return null
  const toolName = type.slice("tool-".length)
  if (toolName === "view_screen") return null
  if (toolName === "show_screen") {
    return <ScreenPart className={className} part={part} />
  }
  return <ToolRow className={className} part={part} toolName={toolName} />
}

/**
 * The model's private thinking (a `reasoning` part), hidden by default.
 * The plus icon is the disclosure — click it and the raw chain of thought
 * appears below; open or closed, the row stays one compact line.
 *
 * While the part is still streaming (the model is thinking right now) the
 * label reads "Thinking…" with a spinner, so a long pre-answer pause shows
 * as visible work instead of a frozen page. Once answered, the same row
 * ("Thinking") documents that the turn did think — and lets the user read
 * how.
 */
export function ChatReasoningPart({
  text,
  streaming,
  className,
}: {
  text: string
  streaming?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <Collapsible
      className={cn("mt-1", className)}
      open={open}
      onOpenChange={setOpen}
    >
      <CollapsibleTrigger
        render={
          <Button
            className="h-7 gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground"
            size="sm"
            variant="ghost"
          />
        }
      >
        <PlusIcon
          className={cn(
            "size-3.5 shrink-0 transition-transform duration-200",
            open && "rotate-45"
          )}
        />
        {streaming ? "Thinking…" : "Thinking"}
        {streaming && <Spinner className="size-3" />}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="max-h-80 space-y-0 overflow-y-auto rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {text || "…"}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * A group-chat handoff: the answering bot delegated the turn to a teammate.
 * It is a tool call, but what matters is the *teammate's* reply — so render
 * that teammate's face, name, the one-line reason, and their full answer
 * (text, reasoning, tool calls). Group-only; a direct chat never emits it.
 *
 * The reply streams in live while the tool call is in flight and is rebuilt
 * from `data-subagent` chunks (`subAgentGet`, keyed by the parent
 * toolCallId). After a reload those transient chunks are gone, so the same
 * reply is read from the persisted tool output (the sub-agent's parts the
 * agent captured on the server).
 */
export function HandoffPart({
  part,
  members,
  subAgentGet,
  isGenerating,
  className,
}: {
  part: Part
  members?: ChatMemberInfo[] | null
  subAgentGet?: (toolCallId: string) => UIMessage | undefined
  isGenerating?: boolean
  className?: string
}) {
  const inv = asInvocation(part)
  const input = asRecord(inv.input)
  const outputRecord = asRecord(inv.output)
  const reason =
    typeof input.reason === "string" && input.reason.length > 0
      ? input.reason
      : undefined

  // Who is answering now: the model names the teammate (the member list in
  // the system prompt shows names, not ids), and the server persists the
  // resolved bot id on the tool OUTPUT as a robust fallback for finding
  // that member's face and name. A raw id must never render as a NAME —
  // if the member can't be resolved, "a teammate" is the floor.
  const nameHint =
    typeof input.targetName === "string" && input.targetName.length > 0
      ? input.targetName
      : undefined
  const idHint =
    typeof outputRecord.targetBotId === "string" &&
    outputRecord.targetBotId.length > 0
      ? outputRecord.targetBotId
      : undefined
  const norm = (s: string) => s.trim().toLowerCase()
  const target =
    members?.find((member) => idHint != null && member.id === idHint) ??
    members?.find(
      (member) => nameHint != null && norm(member.name) === norm(nameHint)
    )
  const name = target?.name ?? nameHint ?? "a teammate"
  const avatar = target?.avatar

  // The teammate's reply: prefer the live stream (in flight now), and fall
  // back to the parts the agent persisted on the server (a reload).
  // A handoff is a tool part, so it always carries the parent toolCallId —
  // the key the live reply is stored under. (Not on every Part variant.)
  const toolCallId = (part as { toolCallId: string }).toolCallId
  const live =
    typeof subAgentGet === "function" ? subAgentGet(toolCallId) : undefined
  const liveParts: Part[] | null =
    live && Array.isArray(live.parts) ? (live.parts as Part[]) : null
  const outputParts: Part[] | null = Array.isArray(outputRecord.parts)
    ? (outputRecord.parts as Part[])
    : null
  const replyParts = liveParts ?? outputParts

  // When the teammate could not answer, explain why — do not fall back to a
  // generic dead-end. Two shapes carry the reason: the tool call errored
  // (state `output-error`, `errorText`) or it resolved to a rejection
  // (`{ ok: false, error }`).
  const error =
    typeof inv.errorText === "string" && inv.errorText.length > 0
      ? inv.errorText
      : outputRecord.ok === false && typeof outputRecord.error === "string"
        ? outputRecord.error
        : undefined

  // Nothing yet: the tool call is in flight and its reply has not streamed —
  // an errored handoff is not pending, so it never shows "answering…".
  const pending = replyParts === null && error === undefined

  return (
    <div className={cn("space-y-2 rounded-md border bg-muted/30 p-3", className)}>
      <div className="flex items-center gap-1.5 text-sm">
        {avatar ? (
          <ChatAvatar animated className="size-5 shrink-0" seed={avatar} />
        ) : null}
        <span className="font-medium">{name}</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          · {reason ?? "hands off the turn"}
        </span>
        {pending && isGenerating ? (
          <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            answering…
          </span>
        ) : null}
      </div>
      {replyParts !== null && replyParts.length > 0 ? (
        replyParts.map((subPart, i) => {
          const type = subPart.type
          const sub = subPart as { text?: unknown }
          if (type === "text" && typeof sub.text === "string") {
            return <MessageResponse key={i}>{sub.text}</MessageResponse>
          }
          if (type === "reasoning" && typeof sub.text === "string") {
            return <ChatReasoningPart key={i} text={sub.text} />
          }
          if (typeof type === "string" && type.startsWith("tool-")) {
            return <ChatToolPart key={i} part={subPart} />
          }
          return null
        })
      ) : null}
      {error ? (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <XIcon className="mt-px size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : pending && !isGenerating ? (
        <p className="text-xs text-muted-foreground">
          The teammate’s reply is not available.
        </p>
      ) : null}
    </div>
  )
}
