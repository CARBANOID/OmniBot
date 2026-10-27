"use client"

import { useChat } from "@ai-sdk/react"
import {
  useLoadTranscript,
  useTriggerChatTransport,
} from "@trigger.dev/sdk/chat/react"
import type { UIMessage } from "ai"
import { useCallback, useEffect, useState } from "react"

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
  // The model to restore after a refresh — the page reads it from its
  // selection cookie and passes it only when it names a real registry model.
  initialModelId?: string | null
}

export function Chat({
  chatId,
  bot,
  credentials,
  initialSelectedId,
  initialModelId,
}: ChatProps) {
  return (
    <CredentialsProvider
      initial={credentials}
      initialSelectedId={initialSelectedId}
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
  // wire; the key is resolved + decrypted server-side by the agent.
  const clientData = credential
    ? {
        provider: credential.provider,
        model: effectiveModelId,
        credentialId: credential.id,
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
          Couldn't load this chat's messages. Refresh the page to try again.
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
  const { messages, status, error, stop: aiStop, sendMessage } = useChat({
    id: chatId,
    transport,
    messages: initialMessages,
    resume: initialMessages.length > 0,
  })

  const { credential, provider } = useCredentials()
  const [text, setText] = useState("")

  const isGenerating = status === "submitted" || status === "streaming"

  // Stop must reach the run: aiStop() settles the local subscription, and
  // stopGeneration tells the worker to abort the in-flight streamText —
  // after a resume, a plain local stop alone would not.
  const stop = useCallback(() => {
    aiStop()
    void transport.stopGeneration(chatId)
  }, [aiStop, transport, chatId])

  const handleSubmit = (message: PromptInputMessage) => {
    if (!message.text.trim() || !credential) return
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
            messages.map((message) => (
              <Message from={message.role} key={message.id}>
                <MessageContent>
                  {message.parts.map((part, i) =>
                    part.type === "text" ? (
                      <MessageResponse key={`${message.id}-${i}`}>
                        {part.text}
                      </MessageResponse>
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
        {!credential && (
          <p className="pb-2 text-xs text-muted-foreground">
            Choose a credential below to start chatting.
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
                  is disabled until there is a credential and some text. */}
              <PromptInputSubmit
                disabled={!isGenerating && (!credential || !text.trim())}
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
