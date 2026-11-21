import { auth } from "@clerk/nextjs/server"
import { cookies } from "next/headers"
import { notFound } from "next/navigation"
import { Suspense } from "react"

import { Chat, type ChatProps } from "@/components/chat"
import { ChatHeader } from "@/components/chat-header"
import { ChatShell } from "@/components/chat-shell"
import { Spinner } from "@/components/ui/spinner"
import {
  CREDENTIAL_COOKIE_NAME,
  LOCAL_PROVIDER_COOKIE_NAME,
  MODEL_COOKIE_NAME,
} from "@/lib/credential-cookie"
import { getChat } from "@/queries/chat"
import { getUserCredentials } from "@/queries/credentials"
import { getChatTranscript } from "@/queries/transcript"
import { providerList, providers } from "@/providers"

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
  // Unknown id (or a chat another user owns) is a 404 — the query refuses
  // to leak ownership, so it simply comes back as null. This must fire
  // before any Suspense boundary further down, where it would be a
  // mid-stream 200 instead.
  if (!chat) notFound()

  // Seeds the credentials context; metadata only — the keys stay server-side.
  const credentialSeeds = await getUserCredentials()

  // Last selected credential, from the selection cookie (the context writes
  // it on every pick/clear). The cookie is user-settable, so trust it only
  // when it names one of THIS user's own credentials — anything else is
  // dropped, and the context starts unselected.
  const cookieStore = await cookies()

  // The last active provider: EITHER a keyless (local) one — named by its own
  // cookie and trusted only when it's a keyless provider in the registry —
  // OR a saved credential, named by its cookie and trusted only when it
  // belongs to this user. The two cookies are mutually exclusive in the
  // context (picking one clears the other), so a keyless pick is the more
  // deliberate, more recent one and takes precedence.
  const savedLocal = cookieStore.get(LOCAL_PROVIDER_COOKIE_NAME)?.value
  const keylessCookieValid =
    savedLocal != null && providers[savedLocal]?.requiresApiKey === false

  const saved = cookieStore.get(CREDENTIAL_COOKIE_NAME)?.value
  const initialSelectedId =
    !keylessCookieValid && saved && credentialSeeds.some((c) => c.id === saved)
      ? saved
      : null
  const initialActiveProviderId = keylessCookieValid ? savedLocal : null

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

  // h-svh pins the shell to the viewport so only the conversation scrolls
  // (StickToBottom) and the prompt box stays fixed in the bottom.
  return (
    <div className="flex h-svh min-w-0 flex-1 overflow-hidden">
      {/* Header and conversation render *together*: both sit behind one
          Suspense boundary, so until the transcript lands the whole area
          shows the spinner — no header-paints-first-then-conversation-
          pops-in. The header's data (`chat`) and the `notFound()` check
          already ran above, outside the boundary, so an unknown id stays a
          clean 404. Switching bots shows loading.tsx for the whole segment
          instead of holding the old bot on screen.
          <ChatShell> composes the page into one ResizablePanelGroup: the
          chat (header + conversation above) in the left panel and the bot's
          desktop (a persistent noVNC iframe) in the right panel, which the
          header's Desktop button collapses/expands — the panel is always
          mounted, so the desktop's VNC session never unloads. It takes
          chatId because the signed desktop URL is minted per chat
          (actions/desktop.ts). */}
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center">
            <Spinner className="size-5" />
          </div>
        }
      >
        <ChatShell
          chatId={chatId}
          botName={chat.bot?.name ?? null}
          // Group chats have several bots and no single one to run a desktop
          // for — the right panel (and its handle) don't exist at all.
          desktop={chat.kind !== "group"}
        >
          <ChatHeader
            name={chat.name}
            isGroup={chat.kind === "group"}
            memberSeeds={chat.members.map((member) => member.avatar)}
            bot={chat.bot}
          />
          <ChatWithTranscript
            chatId={chatId}
            kind={chat.kind}
            name={chat.name}
            bot={chat.bot}
            members={chat.members}
            credentials={credentialSeeds}
            initialSelectedId={initialSelectedId}
            initialActiveProviderId={initialActiveProviderId}
            initialModelId={initialModelId}
          />
        </ChatShell>
      </Suspense>
    </div>
  )
}

// Server component inside the page's Suspense boundary: reads the
// transcript server-side (the boundary's spinner shows while it is in
// flight), then seeds <Chat> with it — messages and the resume cursor from
// the same read, so the transport opens its live stream exactly where the
// persisted history ends. A failed read passes null and the client hook in
// components/chat.tsx retries with its own spinner (the hook then seeds the
// cursor itself). Props are <Chat>'s minus the two this function supplies.
async function ChatWithTranscript(
  props: Omit<ChatProps, "initialMessages" | "initialCursor">,
) {
  const transcript = await getChatTranscript(props.chatId)
  return (
    <Chat
      {...props}
      initialMessages={transcript ? transcript.messages : null}
      initialCursor={transcript?.cursors?.lastOutEventId ?? null}
    />
  )
}
