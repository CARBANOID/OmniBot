"use client"

import { useChat } from "@ai-sdk/react"
import {
  seedTranscriptCursor,
  useLoadTranscript,
  useSubAgentMessages,
  useTriggerChatTransport,
} from "@trigger.dev/sdk/chat/react"
import type { UIMessage } from "ai"
import { useCallback, useEffect, useMemo, useState } from "react"

import {
  loadChatTranscript,
  mintChatAccessToken,
  startChatSession,
} from "@/actions/chat"
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message"
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input"
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input"
import { BotPicker } from "@/components/bot-picker"
import { ChatAvatar } from "@/components/chat-avatar"
import {
  ChatReasoningPart,
  ChatToolPart,
  HandoffPart,
} from "@/components/chat-tools"
import { GroupChatAvatar } from "@/components/group-chat-avatar"
import { CredentialEditButton } from "@/components/credentials/credential-edit-button"
import { CredentialPicker } from "@/components/credentials/credential-picker"
import {
  CredentialsProvider,
  useCredentials,
} from "@/components/credentials/context"
import { ModelPicker } from "@/components/credentials/model-picker"
import { Spinner } from "@/components/ui/spinner"
import {
  MODEL_COOKIE_MAX_AGE,
  MODEL_COOKIE_NAME,
} from "@/lib/credential-cookie"
import type { EditableBot } from "@/lib/validations/bot"
import type { Credential } from "@/components/credentials/context"
import { providerList } from "@/providers"
import type { ChatMemberInfo } from "@/queries/chat"
import type { omnibotChat } from "@/trigger/chat"

export interface ChatProps {
  // The chat this conversation belongs to — the chatId of the Trigger.dev
  // chat agent's session, and the key of its stored transcript.
  chatId: string
  // The chat's kind: a group chat swaps the single-bot empty state for the
  // group avatar + name, and the composer offers the member bot picker.
  kind?: "direct" | "group"
  // The display name — shown by the group chat's empty state.
  name?: string | null
  // The bot behind this chat, when there is one — its face greets the user in
  // the empty state. null for a bot-less chat (and for group chats, which
  // have several bots and no single one).
  bot?: EditableBot | null
  // The member bots in join order — several for a group chat; the first is
  // the default voice. Absent/null for a bot-less direct chat.
  members?: ChatMemberInfo[]
  // The user's saved credentials (fetched server-side by the page) — seeds
  // the credentials context.
  credentials?: Credential[]
  // The credential to restore after a refresh — the page reads it from the
  // selection cookie and passes it only when it belongs to this user.
  initialSelectedId?: string | null
  // The keyless (local) provider to restore after a refresh — the page reads
  // it from its cookie and passes it only when it names a keyless provider.
  initialActiveProviderId?: string | null
  // The model to restore after a refresh — the page reads it from its
  // selection cookie and passes it only when it names a real registry model.
  initialModelId?: string | null
  // The prefetched transcript (page.tsx → queries/transcript.ts) — the
  // conversation as the trigger platform stored it, loaded during SSR.
  // Present (even as `[]`, a brand-new chat) it is authoritative for this
  // render; null means the prefetch failed and the client-side
  // `useLoadTranscript` hook falls back to its own load + spinner.
  initialMessages?: UIMessage[] | null
  // The transcript's `.out` resume cursor (`cursors.lastOutEventId`), captured
  // by the page from the same SSR read that produced `initialMessages`. Seeds
  // the transport's resume position on the SSR path so a `resume` opens the
  // live stream just past the persisted history instead of replaying it —
  // without it the first message after a refresh re-emits the last assistant
  // reply (a duplicate). Absent for a brand-new chat / a failed prefetch.
  initialCursor?: string | null
}

export function Chat({
  chatId,
  kind = "direct",
  name = null,
  bot,
  members,
  credentials,
  initialSelectedId,
  initialActiveProviderId,
  initialModelId,
  initialMessages,
  initialCursor,
}: ChatProps) {
  const isGroup = kind === "group"
  return (
    <CredentialsProvider
      initial={credentials}
      initialSelectedId={initialSelectedId}
      initialActiveProviderId={initialActiveProviderId}
    >
      <ChatGate
        chatId={chatId}
        name={name}
        bot={isGroup ? null : bot ?? null}
        members={isGroup ? (members ?? []) : null}
        initialModelId={initialModelId}
        initialMessages={initialMessages}
        initialCursor={initialCursor}
      />
    </CredentialsProvider>
  )
}

// The bot who answered a given turn. The agent stamps every assistant message
// with a `data-group-bot` part carrying that bot's identity (trigger/chat.ts);
// in a group chat it is the member the composer picked, in a direct chat the
// single member. The part streams live and persists with the message, so the
// same face shows on reload as it did while streaming. Messages stamped before
// this feature exist carry no part, so this stays undefined there.
type RespondingBot = { name: string; avatar: string }

function respondingBotOf(message: UIMessage): RespondingBot | undefined {
  const part = message.parts.find(
    (candidate) => candidate.type === "data-group-bot",
  ) as { data?: unknown } | undefined
  const data = part?.data
  if (
    typeof data === "object" &&
    data !== null &&
    typeof (data as { name?: unknown }).name === "string" &&
    typeof (data as { avatar?: unknown }).avatar === "string"
  ) {
    const bot = data as { name: string; avatar: string }
    // Both fields must be real display values. The previous fallback
    // (`name ?? avatar`) would print the avatar seed — a 21-character
    // nanoid — as the bot's name whenever `name` was absent; hiding the
    // identity row is strictly better than showing the seed.
    if (bot.name.trim() === "" || bot.avatar.trim() === "") return undefined
    return { name: bot.name, avatar: bot.avatar }
  }
  return undefined
}

// Transport + transcript + the picker state that feeds the transport's
// clientData live here, ahead of the useChat component, whose initial
// messages and the transport's resume cursor must describe the same saved
// conversation. Two ways in: the page normally prefetched the transcript
// during SSR (initialMessages) and it mounts straight away; otherwise the
// `useLoadTranscript` hook loads it client-side behind a spinner.
function ChatGate({
  chatId,
  // The chat's display name (the group's, at least) — the empty state title.
  name = null,
  // The bot behind the chat (direct chats) — null for a group chat.
  bot = null,
  // The member bots (group chats) — null for a direct chat. Presence of a
  // list is what makes this a group: several voices to pick from.
  members = null,
  // Restored model pick — the page seeds it from the model cookie.
  initialModelId = null,
  // Prefetched by the page during SSR; null when the prefetch failed. See
  // ChatProps.initialMessages.
  initialMessages = null,
  // See ChatProps.initialCursor.
  initialCursor = null,
}: {
  chatId: string
  name?: string | null
  bot?: EditableBot | null
  members?: ChatMemberInfo[] | null
  initialModelId?: string | null
  initialMessages?: UIMessage[] | null
  initialCursor?: string | null
}) {
  // Which member bot answers (group chats) — the picker's state, live. A
  // direct chat has exactly one member, which the agent resolves, so this
  // stays null and never rides the wire. The default is the first member
  // (the chat's default voice).
  const [botId, setBotId] = useState<string | null>(members?.[0]?.id ?? null)
  const { credential, provider } = useCredentials()

  // The selected model; "reset when the provider changes" is derived, not
  // forced — a model that isn't in the active provider's list (because the
  // provider changed) falls back to that provider's first model.
  const [modelId, setModelId] = useState(
    initialModelId ?? providerList[0].models[0].id
  )

  // Keep the model pick in a global cookie (alongside the credential
  // selection one) so a refresh doesn't fall back to the provider's first
  // model. A pick for a non-active provider still falls back via
  // effectiveModelId below — the cookie just remembers the intent.
  useEffect(() => {
    document.cookie = `${MODEL_COOKIE_NAME}=${modelId}; path=/; max-age=${MODEL_COOKIE_MAX_AGE}`
  }, [modelId])
  const effectiveModelId = provider
    ? (provider.models.find((m) => m.id === modelId)?.id ??
      provider.models[0].id)
    : providerList[0].models[0].id

  // The provider/model/credential/bot selection rides with every turn as
  // clientData (live-updated as the pickers change) — only ids travel the
  // wire; the key is resolved + decrypted server-side by the agent. For a
  // keyless (local) provider there is no credential id to send, and a direct
  // chat sends no bot id (its single member is the only answerer).
  const clientData = provider
    ? {
        provider: provider.id,
        model: effectiveModelId,
        ...(credential ? { credentialId: credential.id } : {}),
        ...(botId ? { botId } : {}),
      }
    : undefined

  const transport = useTriggerChatTransport<typeof omnibotChat>({
    task: "omnibot-chat",
    accessToken: ({ chatId }) => mintChatAccessToken(chatId),
    startSession: ({ chatId, clientData }) =>
      startChatSession({ chatId, clientData }),
    clientData,
  })

  // The SSR path seeds the transcript straight into <Chat> (no client load),
  // so it skips the cursor seeding `useLoadTranscript` performs on the
  // fallback path. Without it, ChatConversation's `useChat` resume-reconnects
  // the live ".out" stream from the START of the persisted history rather
  // than just past it — and the first message after a refresh re-emits the
  // last assistant reply (the duplicate we want to kill). Seed the same
  // cursor so both entry points open the stream past the history. No-op when
  // the transcript carried no cursor (brand-new / empty chat).
  useEffect(() => {
    if (initialMessages) {
      seedTranscriptCursor(transport, chatId, {
        lastOutEventId: initialCursor ?? undefined,
      })
    }
  }, [initialMessages, initialCursor, transport, chatId])

  // The page prefetched the transcript during SSR — it is in the initial
  // HTML, and a chatId cannot change while this page is mounted (it is the
  // route param, so switching chats remounts). The hook would just repeat
  // the same presign + fetch round trip for identical data, so the seeded
  // history mounts straight away; `null` (prefetch failed) falls back to
  // <ChatFallback/>, a component of its own so `useLoadTranscript` stays
  // unconditionally called in its render.
  if (initialMessages) {
    return (
      <ChatConversation
        chatId={chatId}
        name={name}
        bot={bot}
        members={members}
        botId={botId}
        onBotChange={setBotId}
        transport={transport}
        initialMessages={initialMessages}
        modelId={effectiveModelId}
        onModelChange={setModelId}
      />
    )
  }

  return (
    <ChatFallback
      chatId={chatId}
      name={name}
      bot={bot}
      members={members}
      botId={botId}
      onBotChange={setBotId}
      transport={transport}
      modelId={effectiveModelId}
      onModelChange={setModelId}
    />
  )
}

// The page's SSR prefetch failed — load the transcript client-side and
// gate the conversation on it (spinner, then error).
function ChatFallback({
  chatId,
  name,
  bot,
  members,
  botId,
  onBotChange,
  transport,
  modelId,
  onModelChange,
}: {
  chatId: string
  name?: string | null
  bot?: EditableBot | null
  members?: ChatMemberInfo[] | null
  botId: string | null
  onBotChange: (id: string) => void
  transport: ReturnType<typeof useTriggerChatTransport>
  modelId: string
  onModelChange: (id: string) => void
}) {
  const { messages, isLoading, error } = useLoadTranscript(
    chatId,
    loadChatTranscript,
    { transport }
  )

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-5" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="text-xs text-muted-foreground">
          Couldn&apos;t load this chat&apos;s messages. Refresh the page to try
          again.
        </p>
      </div>
    )
  }

  return (
    <ChatConversation
      chatId={chatId}
      name={name}
      bot={bot}
      members={members}
      botId={botId}
      onBotChange={onBotChange}
      transport={transport}
      initialMessages={messages}
      modelId={modelId}
      onModelChange={onModelChange}
    />
  )
}

// Three fading "the bot is working" typing dots — shown while a turn is
// live but the model has not produced any output yet (worker pickup,
// routing, model latency: the silence before the first token). Pure opacity
// (no spatial motion), staggered by delay into the classic ● ● ● wave, and
// therefore it survives the reduced-motion block in globals.css, which
// strips spatial animation but preserves opacity.
function TypingDots() {
  return (
    <span
      role="status"
      aria-label="The bot is typing"
      className="flex items-center gap-0.5"
    >
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className="size-1 animate-typing rounded-full bg-muted-foreground"
          style={{ animationDelay: `${dot * 0.2}s` }}
        />
      ))}
    </span>
  )
}

function ChatConversation({
  chatId,
  name,
  bot,
  members,
  botId,
  onBotChange,
  transport,
  initialMessages,
  modelId,
  onModelChange,
}: {
  chatId: string
  name?: string | null
  bot?: EditableBot | null
  members?: ChatMemberInfo[] | null
  botId: string | null
  onBotChange: (id: string) => void
  transport: ReturnType<typeof useTriggerChatTransport>
  initialMessages: UIMessage[]
  modelId: string
  onModelChange: (id: string) => void
}) {
  const isGroup = members != null
  // The group's currently-selected answerer (the empty state greets you by
  // naming it, so a refresh into an empty group chat shows a person, not a
  // committee).
  const activeBot = isGroup
    ? members?.find((member) => member.id === botId) ?? members?.[0]
    : undefined
  // Live sub-agent replies (the group's handoff target answering on a
  // parent tool call) are streamed as transient `data-subagent` chunks and
  // rebuilt here, keyed by the parent's toolCallId. Group-only — a direct
  // chat has no handoff, so this is simply unused there.
  const subAgents = useSubAgentMessages()

  // `resume` reconnects to an in-flight stream after a mid-answer refresh
  // (the transport replays from the loaded transcript's cursor); with an
  // empty transcript there is nothing to reconnect to yet.
  const {
    messages,
    status,
    error,
    stop: aiStop,
    sendMessage,
  } = useChat({
    id: chatId,
    transport,
    messages: initialMessages,
    resume: initialMessages.length > 0,
    // Feed every data chunk to the sub-agent builder so handoff replies
    // render live while their tool call is still in flight.
    onData: subAgents.onData,
  })

  // `useChat`'s `messages` array can momentarily contain the same logical
  // message twice — same `id` — while a continuation is streaming (the
  // transport re-appends the in-flight assistant turn) or when a `resume`
  // replays an entry. React requires unique keys per sibling, so handing it
  // two `<Message key={message.id}>` with the same id throws the
  // "two children with the same key" error we saw in dev. Collapse duplicate
  // ids before mapping, keeping the first (canonical, earliest-positioned)
  // copy — both copies carry identical content so nothing is lost.
  const uniqueMessages = useMemo(() => {
    const seen = new Set<string>()
    const result: UIMessage[] = []
    for (const message of messages) {
      if (message.id) {
        if (seen.has(message.id)) continue
        seen.add(message.id)
      }
      result.push(message)
    }
    return result
  }, [messages])

  const { credential, provider, isKeyless } = useCredentials()
  const [text, setText] = useState("")

  // A turn can be sent once a provider is active AND (it needs no key, or a
  // credential is selected). A keyless (local) provider needs no credential.
  const ready = provider != null && (isKeyless || credential != null)

  const isGenerating = status === "submitted" || status === "streaming"

  // ── The "bot is working" typing indicator ─────────────────────────────────
  // A turn can be live (submitted/streaming) long before the model emits
  // anything. During that silence the bot's identity shows TypingDots. Two
  // shapes:
  //  - the assistant's message has arrived but carries no visible output
  //    yet (no non-empty text, no reasoning, no tool activity) — dots in
  //    its identity row;
  //  - it has not arrived at all — a fresh identity row after the user's
  //    last message, identifying the addressed bot (the picked member in a
  //    group, the single bot in a direct chat).
  // Reasoning and tool parts count as output — their rows already carry
  // working indicators (Thinking… / answering…), so the dots stand down.
  const hasVisibleOutput = (message: UIMessage): boolean =>
    message.parts.some((part) => {
      if (part.type === "text") return part.text.trim().length > 0
      if (part.type === "reasoning") return true
      if (part.type.startsWith("tool-")) return true
      return false
    })

  const lastMessage = uniqueMessages[uniqueMessages.length - 1]
  const lastMessageTyping =
    isGenerating &&
    lastMessage != null &&
    lastMessage.role !== "user" &&
    !hasVisibleOutput(lastMessage)
  const pendingFirstToken =
    isGenerating && (lastMessage == null || lastMessage.role === "user")
  const typingBot = (isGroup ? activeBot : bot) as
    | ({ name?: string; avatar?: string } | null)
    | undefined

  // Stop must reach the run: aiStop() settles the local subscription, and
  // stopGeneration tells the worker to abort the in-flight streamText —
  // after a resume, a plain local stop alone would not.
  const stop = useCallback(() => {
    aiStop()
    void transport.stopGeneration(chatId)
  }, [aiStop, transport, chatId])

  const handleSubmit = (message: PromptInputMessage) => {
    if (!message.text.trim() || !ready) return
    // PromptInput resets the textarea itself; keep `text` in sync.
    // The provider/model/credential ride along in the transport's
    // clientData — no per-message body needed.
    setText("")
    sendMessage({ text: message.text })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Conversation>
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={
                isGroup && members && members.length > 0 ? (
                  <GroupChatAvatar
                    seeds={members.map((member) => member.avatar)}
                    className="size-14"
                  />
                ) : bot ? (
                  <ChatAvatar seed={bot.avatar} animated className="size-14" />
                ) : undefined
              }
              title={
                isGroup && name
                  ? name
                  : activeBot
                    ? activeBot.name
                    : bot
                      ? bot.name
                      : "Start the conversation"
              }
              description={
                isGroup
                  ? `${members.length} bots are here. Pick one below and say hi.`
                  : bot
                    ? bot.job
                    : "Send the first message to get things going."
              }
            />
          ) : (
            <>
              {uniqueMessages.map((message) => {
              // The answering bot sits above its answer — the stamp the agent
              // wrote into the message (`data-group-bot`). In a group chat this
              // is the picked member, so you can tell who replied; in a direct
              // chat it is the single bot. The user's own messages stay plain
              // (their side is already right-aligned).
              const responder =
                message.role !== "user" ? respondingBotOf(message) : undefined
              return (
                <Message from={message.role} key={message.id}>
                  {responder && (
                    <div className="flex items-center gap-1.5">
                      <ChatAvatar
                        animated
                        className="size-6 shrink-0"
                        seed={responder.avatar}
                      />
                      <span className="text-xs font-medium">
                        {responder.name}
                      </span>
                      {/* Only the current turn's identity row waits on its
                          first token — the dots must not ride on earlier
                          stamps of bots that have already replied.
                          `lastMessage` comes from this same array, so
                          referential identity is the anchor. */}
                      {lastMessageTyping && message === lastMessage ? (
                        <TypingDots />
                      ) : null}
                    </div>
                  )}
                  <MessageContent>
                  {message.parts.map((part, i) =>
                    part.type === "text" ? (
                      <MessageResponse key={`${message.id}-${i}`}>
                        {part.text}
                      </MessageResponse>
                    ) : part.type === "reasoning" ? (
                      // The model's thinking — plus-icon disclosure. While a
                      // reasoning part is the live edge of a streaming
                      // message, the model is thinking *right now* (label
                      // "Thinking…" + spinner); once text/tools follow, the
                      // same row stays as a "read what it thought" toggle.
                      <ChatReasoningPart
                        key={`${message.id}-${i}`}
                        streaming={
                          isGenerating && i === message.parts.length - 1
                        }
                        text={part.text}
                      />
                    ) : part.type === "tool-handoff" ? (
                      // A handoff is a tool call, but its content is the
                      // delegated bot's reply — render the target's face,
                      // name and their answer, not the generic tool row.
                      <HandoffPart
                        key={`${message.id}-${i}`}
                        part={part}
                        members={members}
                        subAgentGet={subAgents.get}
                        isGenerating={isGenerating}
                      />
                    ) : part.type.startsWith("tool-") ? (
                      <ChatToolPart key={`${message.id}-${i}`} part={part} />
                    ) : null
                  )}
                </MessageContent>
              </Message>
              );
              })}

              {/* A turn is in flight but no output has arrived at all yet
                  (the assistant's message hasn't even started streaming):
                  a fresh identity row announces the addressed bot — the
                  picked member in a group, the single bot in a direct chat. */}
              {pendingFirstToken && typingBot?.avatar ? (
                <div className="flex items-center gap-1.5">
                  <ChatAvatar
                    className="size-6 shrink-0"
                    seed={typingBot.avatar}
                  />
                  {typingBot.name ? (
                    <span className="text-xs font-medium">
                      {typingBot.name}
                    </span>
                  ) : null}
                  <TypingDots />
                </div>
              ) : null}
            </>
          )}
        </ConversationContent>
        {/* Needs to live inside <Conversation>: reads its scroll context. */}
        <ConversationScrollButton />
      </Conversation>

      <div className="mx-auto w-full max-w-3xl p-4">
        {/* Every error that lands here passes through our server actions,
            which throw user-safe messages (or the agent's onError string) —
            show the real one, fall back to the generic line. */}
        {error && (
          <p className="pb-2 text-xs text-muted-foreground">
            {error.message ||
              "Something went wrong. Check the provider and API key, then try again."}
          </p>
        )}
        {!provider && (
          <p className="pb-2 text-xs text-muted-foreground">
            Choose a credential or a local provider below to start chatting.
          </p>
        )}
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputTextarea
            onChange={(event) => setText(event.target.value)}
            placeholder={
              isGroup
                ? `Message ${activeBot?.name ?? "the group"}…`
                : bot
                  ? `Message ${bot.name}…`
                  : "Message…"
            }
            value={text}
          />
          <PromptInputFooter>
            <PromptInputTools>
              {/* The selected credential, when there is one: its label, and
                  it opens the update/delete editor. null until selected. */}
              <CredentialEditButton />
              {/* Group chats pick the answering bot per turn — it rides the
                  transport's clientData, like the model. */}
              {isGroup && members && members.length > 0 && (
                <BotPicker
                  members={members}
                  botId={activeBot?.id ?? members[0].id}
                  onBotChange={onBotChange}
                />
              )}
              {/* Hidden entirely until a credential (provider) is selected. */}
              {provider && (
                <ModelPicker
                  provider={provider}
                  modelId={modelId}
                  onModelChange={onModelChange}
                />
              )}
            </PromptInputTools>
            <div className="flex items-center gap-1">
              {/* Always the key icon — opens the credential search bar,
                  sitting just left of the enter button. */}
              <CredentialPicker />
              {/* While generating this is the Stop button (onStop). Idle it
                  is disabled until a provider is active (and, for keyed
                  ones, a credential) and there's some text. */}
              <PromptInputSubmit
                disabled={!isGenerating && (!ready || !text.trim())}
                status={status}
                onStop={stop}
              />
            </div>
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  )
}
