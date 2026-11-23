"use client"

import { MonitorIcon } from "lucide-react"

import { useChatShell } from "@/components/chat-shell"
import { ThemeTintDialog } from "@/components/theme-tint-dialog"
import { BotEditDialog } from "@/components/bot-edit-dialog"
import { GroupChatAvatar } from "@/components/group-chat-avatar"
import { GroupEditDialog } from "@/components/group-edit-dialog"
import { Button } from "@/components/ui/button"
import type { EditableBot } from "@/lib/validations/bot"
import type { GroupChatBot } from "@/lib/validations/chat"
import type { ChatMemberInfo } from "@/queries/chat"

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
  // The editable group chat (groups only): its id (the edit/delete actions
  // act on it), display name, and current members in join order (the
  // editor's preselection and avatar tiles). Null for direct chats.
  group: { id: string; name: string; members: ChatMemberInfo[] } | null
  // The signed-in user's bots — the pool the group editor's member picker
  // offers. The server actions re-validate ownership, so this is a
  // convenience, not an authority.
  bots: GroupChatBot[]
}

export function ChatHeader({
  name,
  isGroup,
  memberSeeds,
  bot,
  group,
  bots,
}: ChatHeaderProps) {
  // Toggles the right-hand panel of the page's <ChatShell> (see the shell
  // in page.tsx); it renders with the header, so this is live on first paint.
  // Group chats offer no panel at all (the desktop button below), but the
  // hook must stay called unconditionally.
  const { panelOpen, togglePanel } = useChatShell()

  if (isGroup) {
    // A group is not a bot: the tiled faces identify it. As with a direct
    // chat — where the avatar + name are one button opening the bot editor —
    // so is a group's, opening the group editor (rename, add/remove
    // members, delete). There is no desktop to open either way.
    return (
      <header className="flex h-12 shrink-0 items-center gap-2 p-2">
        {group ? (
          <GroupEditDialog
            id={group.id}
            name={group.name}
            members={group.members}
            bots={bots}
          />
        ) : (
          // A group with no member bot can't form (create enforces two), so
          // this is the degenerate fallback: a faceless, uneditable title —
          // the same shape the bot-less direct chat below gets.
          <>
            <GroupChatAvatar seeds={memberSeeds} className="size-7" />
            <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
              {name}
            </h1>
          </>
        )}
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
      {/* Background tint settings: pick a tone color and its opacity (see
          components/theme-tint-dialog.tsx). Sits to the left of the desktop
          icon. */}
      <ThemeTintDialog className="ml-auto" />
      {/* The desktop-app entry point: shows/hides the shell's right panel.
          Pressed (open) it reads as "close the panel". */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={panelOpen ? "Close the desktop panel" : "Open the desktop panel"}
        aria-pressed={panelOpen}
        onClick={togglePanel}
      >
        <MonitorIcon />
      </Button>
    </header>
  )
}
