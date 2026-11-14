import { isStepCount } from "ai"
import { and, eq } from "drizzle-orm"
import { chat } from "@trigger.dev/sdk/ai"
import { z } from "zod"

import { decryptCredential } from "@/lib/crypto"
import { db } from "@/lib/db"
import { bots, chatMembers, chats, credentials } from "@/lib/db/schema"
import { providers } from "@/providers"

import { buildComputerUseTools } from "./tools"

// Walks an error (and its `cause` chain) to decide whether it means "the
// model is busy / overloaded" rather than "our code is broken". Matches the
// shapes that actually arrive: a timed-out request (a `TimeoutError` from the
// per-request timeouts, or SDK-wrapped) and a provider 5xx/429 (an APICallError
// carrying a statusCode) or a "high demand" style message.
function isBusyError(error: unknown): boolean {
  const busyStatuses = new Set([429, 500, 502, 503, 529])
  const busyMessage =
    /high demand|rate limit|resource exhausted|too many requests|unavailable|overloaded|timed ?out|timeout/i
  let current = error as (Error & { statusCode?: number; cause?: unknown }) | null
  for (let depth = 0; current && depth < 6; depth++) {
    const name = typeof current.name === "string" ? current.name : ""
    const message = typeof current.message === "string" ? current.message : ""
    const statusCode =
      typeof current.statusCode === "number" ? current.statusCode : undefined
    if (name === "TimeoutError" || busyStatuses.has(statusCode ?? -1)) return true
    if (busyMessage.test(message)) return true
    current = current.cause as typeof current
  }
  return false
}

// The chat agent behind a chat page. The session's chat id IS the app's
// `chats.id`, so the worker resolves the chat's owner straight from the DB —
// there is no Clerk session in a Trigger worker, and the owner's id is what
// scopes the credential lookup below.
//
// The provider/model/selection rides in `clientData` (the picker's state,
// typed by the schema): only ids travel the wire, the key itself is
// decrypted here, exactly like the old /api/chat route did.
export const omnibotChat = chat.agent({
  id: "omnibot-chat",
  clientDataSchema: z.object({
    provider: z.string(),
    model: z.string(),
    credentialId: z.string(),
  }),
  // The bot's computer-use tools (shell, files, mouse, keyboard, screen),
  // rebuilt for each turn's chat id. Declaring them on the agent — not just
  // handing them to streamText — is what lets the SDK re-apply each tool's
  // toModelOutput when it re-converts saved history on later turns
  // (view_screen's image, show_screen's one-liner).
  tools: ({ chatId }) => buildComputerUseTools(chatId),
  // Stream errors (rate limits, provider failures) are sanitized before they
  // reach the browser — the raw message can carry provider internals.
  uiMessageStreamOptions: {
    onError: (error) => {
      console.error("[omnibot-chat] Stream error:", error)
      // Busy / overloaded is the common one (Google answers with 503
      // "high demand", and a stalled connection trips the per-request
      // timeouts below). Say so plainly and point at the retry, instead of a
      // generic line that reads like our bug.
      if (isBusyError(error)) {
        return "That model is busy right now. Wait a moment and try again."
      }
      return "Something went wrong while generating a response. Please try again."
    },
  },
  run: async ({ chatId, messages, clientData, signal, streamText, tools }) => {
    // The UI gates sending on a selected credential, but the turn reaches
    // here without clientData if it doesn't — answer the gap, don't crash.
    if (!clientData) {
      throw new Error("Choose a credential to start chatting.")
    }
    const { provider: providerId, model: modelId, credentialId } = clientData

    // The provider + model pair is validated against the registry. An
    // unknown pair is a client bug — fail the turn with the plain message
    // the old route answered with (it becomes the user-facing errorText).
    const provider = providers[providerId]
    if (!provider || !provider.models.some((model) => model.id === modelId)) {
      throw new Error(`Unknown provider "${providerId}" or model "${modelId}".`)
    }

    // Who owns this chat — the credential must belong to THEM, and to the
    // requested provider, exactly like the old getCredentialKey query.
    const [chatRow] = await db
      .select({ userId: chats.userId })
      .from(chats)
      .where(eq(chats.id, chatId))
    if (!chatRow) {
      throw new Error("Unknown chat.")
    }

    // One bot per direct chat: resolve it via the membership table. The row
    // carries the identity the base instructions describe — name, job
    // (what the bot is for), and instructions (how it should carry the job out).
    const [membership] = await db
      .select({ botId: chatMembers.botId })
      .from(chatMembers)
      .where(eq(chatMembers.chatId, chatId))
    if (!membership) {
      throw new Error("No bot is set up for this chat.")
    }
    const [bot] = await db
      .select({
        name: bots.name,
        job: bots.job,
        instructions: bots.instructions,
        sandboxId: bots.sandboxId,
      })
      .from(bots)
      .where(eq(bots.id, membership.botId))
      .limit(1)
    if (!bot) {
      throw new Error("No bot is set up for this chat.")
    }

    const [row] = await db
      .select({ apiKey: credentials.apiKey })
      .from(credentials)
      .where(
        and(
          eq(credentials.id, credentialId),
          eq(credentials.userId, chatRow.userId),
          eq(credentials.provider, providerId)
        )
      )
    if (!row) {
      throw new Error("Unknown credential.")
    }

    let key: string
    try {
      key = decryptCredential(row.apiKey)
    } catch (error) {
      // A corrupt or re-keyed row: log the real error, surface nothing.
      console.error("[omnibot-chat] Failed to decrypt credential:", error)
      throw new Error("Unknown credential.")
    }

    // `streamText`, `signal`, `tools`, and the already-converted `messages`
    // all come from the run — the managed streamText carries the agent's
    // options, the resolved tool set is the one declared on the agent (the
    // `tools` function above), and the signal is what makes Stop abort the
    // model call server-side.
    //
    // The system prompt is per-bot — each chat maps to exactly one bot, and the
    // bot's row IS the identity: name, job (what it's for), purpose (how it
    // should carry the job out), and the Daytona sandbox it runs in. When
    // the sandbox hasn't been created yet (or was left over from a failed
    // create), we still describe the environment in generic terms; the tools
    // create or recover it on demand.
    const system = [
      `You are ${bot.name}.`,
      `Your job: ${bot.job}.`,
      ...(bot.instructions?.trim()
        ? [`Your purpose: ${bot.instructions.trim()}.`]
        : []),
      bot.sandboxId
        ? `You run inside a Daytona sandbox (id: \`${bot.sandboxId}\`). This is your execution environment.`
        : "You run inside a Daytona sandbox. This is your execution environment.",
      "Work step by step: take an action, observe the result (a command output, a file, the screen), and adjust.",
    ].join("\n")

    return streamText({
      model: provider.createProvider(key)(modelId),
      system,
      messages,
      tools,
      // The AI SDK caps the tool loop at ONE step by default — one model
      // call, its tools run, and over. Desktop work needs many
      // act-observe-act round trips, so the limit is lifted explicitly. 50
      // model calls (each running its own tool batch) is the runway for a
      // turn; the model simply stops calling tools when the job is done.
      stopWhen: isStepCount(50),
      abortSignal: signal,
      // Bounded per-request time. Without these, a model that stalls (a
      // provider under "high demand" opens the stream and sends nothing) runs
      // the whole run to its maxDuration before the scaffold drops the pipe —
      // and the browser is left with a stream that ends in neither finish nor
      // error, so it spins forever. With them, a stalled call aborts on its
      // own: the AI SDK surfaces a clean error (routed through onError above),
      // so the client always settles. Every bound is per-step, so a long,
      // multi-step turn is fine; a single wedged model call is not.
      timeout: {
        // First output of a step. Generous — a reasoning model chewing on a
        // ~200 KB screenshot can be slow — but finite, so a stall can't hide.
        firstChunkMs: 90_000,
        // Silence between outputs once a step has started.
        chunkMs: 120_000,
        // Whole step (model call + retries + local tool runs) ceiling.
        stepMs: 300_000,
        // One Daytona tool call — screenshots and most commands land well
        // inside this; it bounds a wedged one.
        toolMs: 120_000,
      },
      // A few attempts over a transient "high demand" 503 before we give up.
      // Each 503 is fast; the timeouts above cap how long the set can run.
      maxRetries: 3,
    })
  },
})
