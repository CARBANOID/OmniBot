import { auth } from "@clerk/nextjs/server"
import { notFound } from "next/navigation"

import { Chat } from "@/components/chat"
import { ChatHeader } from "@/components/chat-header"
import { getChat } from "@/queries/chat"
import { getUserCredentials } from "@/queries/credentials"

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

  // Seeds the credentials context; metadata only — the keys stay server-side.
  const credentialSeeds = await getUserCredentials()

  // h-svh pins the column to the viewport so only the conversation scrolls
  // (StickToBottom) and the prompt box stays fixed in the bottom.
  return (
    <div className="flex h-svh min-w-0 flex-1 flex-col overflow-hidden">
      <ChatHeader name={chat.name} bot={chat.bot} />
      <Chat bot={chat.bot} credentials={credentialSeeds} />
    </div>
  )
}
