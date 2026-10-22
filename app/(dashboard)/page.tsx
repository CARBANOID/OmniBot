import { auth } from "@clerk/nextjs/server"
import { nanoid } from "nanoid"

import { BotDialog } from "@/components/bot-dialog"
import { ChatAvatar } from "@/components/chat-avatar"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

export default async function Page() {
  // Signed-out visitors are redirected to sign-in.
  // Clerk middleware (proxy.ts) stays bare and only attaches the session.
  await auth.protect()

  // The empty state previews the face a bot will get. Rendering is per-request
  // (Clerk auth forces dynamic rendering), so a fresh seed lands on every
  // refresh — same nanoid domain the bots.avatar column uses.
  const seed = nanoid()

  return (
    <Empty className="min-h-svh rounded-none border-none">
      <EmptyHeader>
        <EmptyMedia variant="default">
          <ChatAvatar seed={seed} animated className="size-10" />
        </EmptyMedia>
        <EmptyTitle>Meet your first bot</EmptyTitle>
        <EmptyDescription>
          Every bot gets its own personality, memory, and face. Spin one up
          and start the conversation.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <BotDialog />
      </EmptyContent>
    </Empty>
  )
}
