"use client"

import { useState } from "react"
import { CheckIcon } from "lucide-react"

import { PromptInputButton } from "@/components/ai-elements/prompt-input"
import { ChatAvatar } from "@/components/chat-avatar"
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { ChatMemberInfo } from "@/queries/chat"

export interface BotPickerProps {
  // The group chat's member bots in join order (the first is the default).
  members: ChatMemberInfo[]
  // The member currently selected to answer.
  botId: string
  onBotChange: (botId: string) => void
}

/**
 * Footer button that picks which member bot of a group chat answers. The
 * label is the current bot's face + name. Opens a popover with the member
 * list — no search box; a handful of names fit.
 *
 * Mirrors ModelPicker (the other composer picker): the per-turn selection
 * rides the transport's clientData live, so no message body is needed.
 */
export function BotPicker({ members, botId, onBotChange }: BotPickerProps) {
  const [open, setOpen] = useState(false)

  const bot = members.find((item) => item.id === botId)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* `group` so the label can brighten on hover (see the span below). */}
      <PopoverTrigger
        render={<PromptInputButton variant="ghost" size="sm" className="group" />}
      >
        {/* Slightly dim normally, full-foreground on hover and while typing
            (the PromptInput's InputGroup is the named `group/input-group`)
            — overrides the footer addon's muted-foreground and reads as a
            subtle brighten. */}
        <span className="flex max-w-40 items-center gap-1.5 text-sm text-foreground/85 group-hover:text-foreground group-focus-within/input-group:text-foreground">
          {bot && (
            <ChatAvatar seed={bot.avatar} className="size-4" aria-hidden />
          )}
          <span className="truncate">{bot?.name ?? "Bot"}</span>
        </span>
      </PopoverTrigger>
      {/* Left edge of the box lines up with the left edge of the button
          (the name), rather than centering over it. */}
      <PopoverContent align="start" className="w-60 p-1">
        <Command>
          {/* No search box: a handful of members fit, more scroll into view. */}
          <CommandList className="max-h-44">
            <CommandGroup>
              {members.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.name}
                  onSelect={() => {
                    onBotChange(item.id)
                    setOpen(false)
                  }}
                >
                  <ChatAvatar seed={item.avatar} className="size-5" aria-hidden />
                  <span className="truncate">{item.name}</span>
                  {item.id === botId && (
                    <CheckIcon className="ml-auto size-4 shrink-0" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
