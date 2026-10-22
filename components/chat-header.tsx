"use client"

import { MonitorIcon } from "lucide-react"

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
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 p-2">
      {bot ? (
        // Avatar + name grouped into one button that opens the bot editor.
        <BotEditDialog bot={bot} label={name} />
      ) : (
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{name}</h1>
      )}
      {/* Placeholder: the desktop-app entry point is not wired up yet. */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Desktop"
        className="ml-auto"
      >
        <MonitorIcon />
      </Button>
    </header>
  )
}
