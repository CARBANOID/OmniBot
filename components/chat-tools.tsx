"use client"

import type { UIDataTypes, UIMessagePart, UITools } from "ai"
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
  MousePointerIcon,
  TerminalIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Spinner } from "@/components/ui/spinner"
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
