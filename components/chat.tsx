"use client"

import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { useState } from "react"

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
import { CredentialPicker } from "@/components/credentials/credential-picker"
import {
  CredentialsProvider,
  useCredentials,
} from "@/components/credentials/context"
import { ModelPicker } from "@/components/credentials/model-picker"
import type { EditableBot } from "@/lib/validations/bot"
import { providerList } from "@/providers"

export interface ChatProps {
  // The bot behind this chat, when there is one — its face greets the user in
  // the empty state. null for a bot-less chat.
  bot?: EditableBot | null
}

export function Chat({ bot }: ChatProps) {
  return (
    <CredentialsProvider>
      <ChatConversation bot={bot} />
    </CredentialsProvider>
  )
}

function ChatConversation({ bot }: ChatProps) {
  const { messages, status, error, stop, sendMessage } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  })

  const { credential, provider } = useCredentials()

  // The selected model; "reset when the provider changes" is derived, not
  // forced — a model that isn't in the active provider's list (because the
  // provider changed) falls back to that provider's first model.
  const [modelId, setModelId] = useState(providerList[0].models[0].id)
  const effectiveModelId = provider
    ? (provider.models.find((m) => m.id === modelId)?.id ??
      provider.models[0].id)
    : providerList[0].models[0].id

  const [text, setText] = useState("")

  const isGenerating = status === "submitted" || status === "streaming"

  const handleSubmit = (message: PromptInputMessage) => {
    if (!message.text.trim() || !credential) return
    // PromptInput resets the textarea itself; keep `text` in sync.
    setText("")
    sendMessage(
      { text: message.text },
      {
        body: {
          provider: credential.provider,
          model: effectiveModelId,
          apiKey: credential.apiKey,
        },
      }
    )
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
        {error && (
          <p className="pb-2 text-xs text-muted-foreground">
            Something went wrong. Check the provider and API key, then try
            again.
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
              <CredentialPicker />
              {/* Hidden entirely until a credential (provider) is selected. */}
              {provider && (
                <ModelPicker
                  provider={provider}
                  modelId={effectiveModelId}
                  onModelChange={setModelId}
                />
              )}
            </PromptInputTools>
            {/* While generating this is the Stop button (onStop). Idle it is
                disabled until there is a credential and some text. */}
            <PromptInputSubmit
              disabled={!isGenerating && (!credential || !text.trim())}
              status={status}
              onStop={stop}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  )
}
