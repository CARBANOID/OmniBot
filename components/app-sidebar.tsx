"use client"

import { useEffect, useState } from "react"
import { UserButton } from "@clerk/nextjs"
import {
  differenceInCalendarDays,
  differenceInMinutes,
  format,
  formatDistanceToNowStrict,
} from "date-fns"
import { BotIcon, MessagesSquareIcon, PlusIcon, SearchIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { BotDialogContent } from "@/components/bot-dialog"
import { ChatAvatar } from "@/components/chat-avatar"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Dialog } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarRail,
} from "@/components/ui/sidebar"
import type { UserChat } from "@/queries/bots"

// Clerk's UserButton ships its own trigger <button>, so it is hosted inside
// SidebarMenuButton rendered as a <span> (no nested buttons). The span keeps
// the row's size/hover/active treatment but gives up its padding (p-0!); that
// 8px inset becomes padding ON the Clerk trigger button instead, so the
// button fills the entire menu row and the whole row is clickable — not just
// the avatar and name.
const userButtonAppearance = {
  elements: {
    rootBox: "flex h-full w-full",
    // the row's inset lives here (on the button) so the click area is the
    // full row — the span's own p-* is overridden by p-0! below
    userButtonTrigger:
      "flex h-full w-full cursor-pointer items-center rounded-none p-2 group-data-[collapsible=icon]:p-0",
    userButtonBox:
      "flex w-full items-center gap-2 group-data-[collapsible=icon]:justify-center",
    // avatar pinned left (Clerk's DOM order is name -> avatar) at 1.75rem;
    // in collapsed icon mode the name hides and it fills the 48px button
    userButtonAvatarBox: "order-first size-7",
    // name fills the remaining width, inherits the row's hover/open color,
    // drops Clerk's inner 8px left pad; hidden in the collapsed icon mode
    userButtonOuterIdentifier:
      "min-w-0 flex-1 truncate pl-0 group-hover/menu-button:text-inherit [[data-open]_&]:text-inherit group-data-[collapsible=icon]:hidden",
  },
}

// Compact "since when" label for a chat row, most recent first.
//   today, <1h  -> "41 minutes ago"
//   today       -> "11:17 AM"
//   this week   -> "Mon"
//   older       -> "Sep 8"
function formatChatTime(date: Date, now: Date = new Date()): string {
  const days = differenceInCalendarDays(now, date)
  if (days <= 0) {
    // Same day (or a future skew): relative under an hour, else clock time.
    return differenceInMinutes(now, date) < 60
      ? formatDistanceToNowStrict(date, { addSuffix: true })
      : format(date, "h:mm a")
  }
  if (days < 7) return format(date, "EEE")
  return format(date, "MMM d")
}

interface AppSidebarProps {
  // The signed-in user's chats, most recently active first (see queries/bots).
  chats: UserChat[]
}

export function AppSidebar({ chats }: AppSidebarProps) {
  const router = useRouter()
  const [createBotOpen, setCreateBotOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  // Toggle the chat search with ⌘K / Ctrl+K.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Some environments dispatch keydown with key === undefined — guard
      // before reading it (same lesson as the theme hotkey in theme-provider).
      const key = event.key?.toLowerCase()
      if (!key) return
      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex justify-end group-data-[collapsible=icon]:justify-center">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Create new"
                  className="group-data-[collapsible=icon]:size-12"
                >
                  <PlusIcon />
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => setCreateBotOpen(true)}>
                <BotIcon />
                Create a new bot
              </DropdownMenuItem>
              <DropdownMenuItem>
                <MessagesSquareIcon />
                Create a group chat
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* Styled like the Input (h-8 / rounded-lg / border-input / px-2.5 /
            typography copied from ui/input.tsx's default classes), but it is a
            Button, so it keeps the button's hover/press treatment instead of
            the input's lack of one. */}
        <Button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex w-full min-w-0 items-center gap-2 rounded-lg border-input bg-transparent px-2.5 text-base text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:hover:bg-muted/50 group-data-[collapsible=icon]:size-12 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-transparent"
        >
          <SearchIcon />
          <span className="truncate group-data-[collapsible=icon]:hidden">
            Search
          </span>
          <Kbd className="ml-auto group-data-[collapsible=icon]:hidden">
            ⌘K
          </Kbd>
        </Button>
      </SidebarHeader>
      <SidebarContent>
        {chats.length > 0 && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {chats.map((chat) => (
                  <SidebarMenuItem key={chat.id}>
                    <SidebarMenuButton
                      size="lg"
                      // Links to the chat page for this chat id.
                      render={<Link href={`/chats/${chat.id}`} />}
                      className="h-auto p-2.5 group-data-[collapsible=icon]:size-12! group-data-[collapsible=icon]:justify-center"
                      tooltip={chat.name}
                    >
                      <ChatAvatar seed={chat.avatarSeed} className="size-7" />
                      <span className="flex min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden">
                        <span className="flex items-center gap-2">
                          {/* flex-1 so the name claims the free space and pins the
                              timestamp to the right edge of the row. */}
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {chat.name}
                          </span>
                          <span className="shrink-0 text-xs text-sidebar-foreground/60">
                            {formatChatTime(chat.lastMessageAt)}
                          </span>
                        </span>
                        {chat.preview && (
                          <span className="truncate text-xs text-sidebar-foreground/60">
                            {chat.preview}
                          </span>
                        )}
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        {/* p-0: the footer already insets 8px (p-2); without this the group's
            padding leaves only 32px in icon mode and the 48px row overflows,
            pushing the avatar off-center. Now the slot matches the header
            and chat columns (48px). */}
        <SidebarGroup className="p-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<span />}
                className="p-0! group-data-[collapsible=icon]:size-12! has-[[data-open]]:bg-sidebar-accent has-[[data-open]]:font-medium has-[[data-open]]:text-sidebar-accent-foreground"
              >
                <UserButton appearance={userButtonAppearance} showName />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarFooter>
      {/* Toggles the collapsed icon rail; visible on desktop only. */}
      <SidebarRail />

      <Dialog open={createBotOpen} onOpenChange={setCreateBotOpen}>
        <BotDialogContent onSuccess={() => setCreateBotOpen(false)} />
      </Dialog>
      <CommandDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        title="Search"
        description="Search your chats"
      >
        <Command>
          <CommandInput placeholder="Search your chats..." />
          <CommandList>
            <CommandEmpty>No chats found.</CommandEmpty>
            <CommandGroup>
              {chats.map((chat) => (
                <CommandItem
                  key={chat.id}
                  value={chat.name}
                  // Same destination as the sidebar rows.
                  onSelect={() => {
                    setSearchOpen(false)
                    router.push(`/chats/${chat.id}`)
                  }}
                >
                  <ChatAvatar seed={chat.avatarSeed} className="size-6" />
                  <span className="truncate">{chat.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </Sidebar>
  )
}
