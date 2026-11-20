"use client"

import { MonitorIcon } from "lucide-react"

import { useChatShell } from "@/components/chat-shell"
import { BotEditDialog } from "@/components/bot-edit-dialog"
import { Button } from "@/components/ui/button"
import type { EditableBot } from "@/lib/validations/bot"

export interface ChatHeaderProps {
  // Display name: the chat's own name, or its bot's name for direct chats.
  name: string
  // The editable bot behind the chat (its face, name, job, and instructions).
  // Present only when the chat has a member bot; null for a bot-less chat, in
  // which case no avatar is shown and the title isn't editable.
  bot: EditableBot | null
}

export function ChatHeader({ name, bot }: ChatHeaderProps) {
  // Toggles the right-hand panel of the page's <ChatShell> (see the shell
  // in page.tsx); it renders with the header, so this is live on first paint.
  const { panelOpen, togglePanel } = useChatShell()

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 p-2">
      {bot ? (
        // Avatar + name grouped into one button that opens the bot editor.
        <BotEditDialog bot={bot} label={name} />
      ) : (
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{name}</h1>
      )}
      {/* The desktop-app entry point: shows/hides the shell's right panel.
          Pressed (open) it reads as "close the panel". */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={panelOpen ? "Close the desktop panel" : "Open the desktop panel"}
        aria-pressed={panelOpen}
        className="ml-auto"
        onClick={togglePanel}
      >
        <MonitorIcon />
      </Button>
    </header>
  )
}
