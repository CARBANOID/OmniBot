import { auth } from "@clerk/nextjs/server"
import { notFound } from "next/navigation"

import { ChatHeader } from "@/components/chat-header"
import { getChat } from "@/queries/chat"

export default async function ChatPage({
  params,
}: {
  params: Promise<{ chatId: string }>
}) {
  // Signed-out visitors are redirected to sign-in.
  // Clerk middleware (proxy.ts) stays bare and only attaches the session.
  await auth.protect()

  const { chatId } = await params
  const chat = await getChat(chatId)
  // Unknown id (or a chat another user owns) is a 404 — the query refuses to
  // leak ownership, so both simply come back as null.
  if (!chat) notFound()

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ChatHeader name={chat.name} bot={chat.bot} />
    </div>
  )
}
