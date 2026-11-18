"use client"

import { useChat } from "@ai-sdk/react"
import {
  useLoadTranscript,
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
import { ChatAvatar } from "@/components/chat-avatar"
import { ChatReasoningPart, ChatToolPart } from "@/components/chat-tools"
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
import type { omnibotChat } from "@/trigger/chat"

export interface ChatProps {
  // The chat this conversation belongs to — the chatId of the Trigger.dev
  // chat agent's session, and the key of its stored transcript.
  chatId: string
  // The bot behind this chat, when there is one — its face greets the user in
  // the empty state. null for a bot-less chat.
  bot?: EditableBot | null
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
}

export function Chat({
  chatId,
  bot,
  credentials,
  initialSelectedId,
  initialActiveProviderId,
  initialModelId,
}: ChatProps) {
  return (
    <CredentialsProvider
      initial={credentials}
      initialSelectedId={initialSelectedId}
      initialActiveProviderId={initialActiveProviderId}
    >
      <ChatGate chatId={chatId} bot={bot} initialModelId={initialModelId} />
    </CredentialsProvider>
  )
}

// Transport + transcript load + the picker state that feeds the transport's
// clientData live here. The useChat component only mounts once the
// transcript has loaded: its initial messages and the transport's resume
// cursor must describe the same saved conversation.
function ChatGate({
  chatId,
  bot,
  // Restored model pick — the page seeds it from the model cookie.
  initialModelId = null,
}: {
  chatId: string
  bot?: EditableBot | null
  initialModelId?: string | null
}) {
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

  // The provider/model/credential selection rides with every turn as
  // clientData (live-updated as the picker changes) — only ids travel the
  // wire; the key is resolved + decrypted server-side by the agent. For a
  // keyless (local) provider there is no credential id to send.
  const clientData = provider
    ? {
        provider: provider.id,
        model: effectiveModelId,
        ...(credential ? { credentialId: credential.id } : {}),
      }
    : undefined

  const transport = useTriggerChatTransport<typeof omnibotChat>({
    task: "omnibot-chat",
    accessToken: ({ chatId }) => mintChatAccessToken(chatId),
    startSession: ({ chatId, clientData }) =>
      startChatSession({ chatId, clientData }),
    clientData,
  })

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
      bot={bot}
      transport={transport}
      initialMessages={messages}
      modelId={effectiveModelId}
      onModelChange={setModelId}
    />
  )
}

function ChatConversation({
  chatId,
  bot,
  transport,
  initialMessages,
  modelId,
  onModelChange,
}: {
  chatId: string
  bot?: EditableBot | null
  transport: ReturnType<typeof useTriggerChatTransport>
  initialMessages: UIMessage[]
  modelId: string
  onModelChange: (id: string) => void
}) {
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
                bot ? (
                  <ChatAvatar seed={bot.avatar} animated className="size-14" />
                ) : undefined
              }
              title={bot ? bot.name : "Start the conversation"}
              description={
                bot ? bot.job : "Send the first message to get things going."
              }
            />
          ) : (
            uniqueMessages.map((message) => (
              <Message from={message.role} key={message.id}>
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
                    ) : part.type.startsWith("tool-") ? (
                      <ChatToolPart key={`${message.id}-${i}`} part={part} />
                    ) : null
                  )}
                </MessageContent>
              </Message>
            ))
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
            placeholder={bot ? `Message ${bot.name}…` : "Message…"}
            value={text}
          />
          <PromptInputFooter>
            <PromptInputTools>
              {/* The selected credential, when there is one: its label, and
                  it opens the update/delete editor. null until selected. */}
              <CredentialEditButton />
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
