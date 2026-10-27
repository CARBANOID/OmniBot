import { auth } from "@clerk/nextjs/server"
import { cookies } from "next/headers"
import { notFound } from "next/navigation"

import { Chat } from "@/components/chat"
import { ChatHeader } from "@/components/chat-header"
import {
  CREDENTIAL_COOKIE_NAME,
  MODEL_COOKIE_NAME,
} from "@/lib/credential-cookie"
import { getChat } from "@/queries/chat"
import { getUserCredentials } from "@/queries/credentials"
import { providerList } from "@/providers"

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

  // Last selected credential, from the selection cookie (the context writes
  // it on every pick/clear). The cookie is user-settable, so trust it only
  // when it names one of THIS user's own credentials — anything else is
  // dropped, and the context starts unselected.
  const cookieStore = await cookies()
  const saved = cookieStore.get(CREDENTIAL_COOKIE_NAME)?.value
  const initialSelectedId =
    saved && credentialSeeds.some((c) => c.id === saved) ? saved : null

  // Last selected model, from its global cookie (the gate writes it on every
  // model pick). The cookie is user-settable, so trust it only when it names
  // a real model in the shared registry — otherwise the gate's per-provider
  // fallback (first model) takes over.
  const savedModel = cookieStore.get(MODEL_COOKIE_NAME)?.value
  const initialModelId =
    savedModel &&
    providerList.some((provider) =>
      provider.models.some((model) => model.id === savedModel)
    )
      ? savedModel
      : null

  // h-svh pins the column to the viewport so only the conversation scrolls
  // (StickToBottom) and the prompt box stays fixed in the bottom.
  return (
    <div className="flex h-svh min-w-0 flex-1 flex-col overflow-hidden">
      <ChatHeader name={chat.name} bot={chat.bot} />
      <Chat
        chatId={chatId}
        bot={chat.bot}
        credentials={credentialSeeds}
        initialSelectedId={initialSelectedId}
        initialModelId={initialModelId}
      />
    </div>
  )
}
