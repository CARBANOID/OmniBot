"use client"

import { MonitorIcon } from "lucide-react"

import { useChatShell } from "@/components/chat-shell"
import { BotEditDialog } from "@/components/bot-edit-dialog"
import { GroupChatAvatar } from "@/components/group-chat-avatar"
import { Button } from "@/components/ui/button"
import type { EditableBot } from "@/lib/validations/bot"

export interface ChatHeaderProps {
  // Display name: the chat's own name for groups, the bot's name for direct
  // chats.
  name: string
  // A group chat (several member bots, no single one to edit).
  isGroup: boolean
  // The member bots' face seeds in join order — what tiles the group avatar.
  memberSeeds: string[]
  // The editable bot behind the chat (its face, name, job, and instructions).
  // Present only for a direct chat with a member bot; a bot-less chat shows
  // no avatar and an uneditable title. Always null for a group chat.
  bot: EditableBot | null
}

export function ChatHeader({
  name,
  isGroup,
  memberSeeds,
  bot,
}: ChatHeaderProps) {
  // Toggles the right-hand panel of the page's <ChatShell> (see the shell
  // in page.tsx); it renders with the header, so this is live on first paint.
  // Group chats offer no panel at all (the desktop button below), but the
  // hook must stay called unconditionally.
  const { panelOpen, togglePanel } = useChatShell()

  if (isGroup) {
    // A group is not a bot: the tiled faces identify it, the name stands in
    // for the (absent) editor, and there is no desktop to open.
    return (
      <header className="flex h-12 shrink-0 items-center gap-2 p-2">
        <GroupChatAvatar seeds={memberSeeds} className="size-7" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{name}</h1>
      </header>
    )
  }

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
