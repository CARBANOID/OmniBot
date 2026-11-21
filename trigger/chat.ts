import {
  isStepCount,
  streamText as aiStreamText,
  tool,
  type StopCondition,
  type ToolSet,
} from "ai"
import { asc, and, eq } from "drizzle-orm"
import { chat } from "@trigger.dev/sdk/ai"
import { z } from "zod"

import { decryptCredential } from "@/lib/crypto"
import { db } from "@/lib/db"
import { readBotMemory } from "@/lib/daytona"
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
  let current = error as
    (Error & { statusCode?: number; cause?: unknown }) | null
  for (let depth = 0; current && depth < 6; depth++) {
    const name = typeof current.name === "string" ? current.name : ""
    const message = typeof current.message === "string" ? current.message : ""
    const statusCode =
      typeof current.statusCode === "number" ? current.statusCode : undefined
    if (name === "TimeoutError" || busyStatuses.has(statusCode ?? -1))
      return true
    if (busyMessage.test(message)) return true
    current = current.cause as typeof current
  }
  return false
}

// Ollama rejects a request whose context is so large it had to truncate
// the front of the prompt: the qwen renderer then finds no plain user
// turn left and returns 500 "no user query found in messages". It is not
// transient — retrying never helps. Tell the user in words they can act
// on (new chat), not with a "model is busy" line that invites a retry.
function isContextOverflowError(error: unknown): boolean {
  let current = error as (Error & { cause?: unknown }) | null
  for (let depth = 0; current && depth < 6; depth++) {
    const message = typeof current.message === "string" ? current.message : ""
    if (/no user query found in messages/i.test(message)) return true
    current = current.cause as typeof current
  }
  return false
}

// Per-step time bounds, applied identically to the answering bot's model call
// and to the target bot's handed-off call. Without these, a model that stalls
// (a provider under "high demand" opens the stream and sends nothing) runs
// the whole run to its maxDuration before the scaffold drops the pipe — and
// the browser is left with a stream that ends in neither finish nor error, so
// it spins forever. With them, a stalled call aborts on its own: the AI SDK
// surfaces a clean error (routed through onError), so the client always
// settles. Every bound is per-step, so a long, multi-step turn is fine; a
// single wedged model call is not.
const turnTimeout = {
  // First output of a step. Generous — a reasoning model chewing on a
  // ~200 KB screenshot can be slow — but finite, so a stall can't hide.
  firstChunkMs: 90_000,
  // Silence between outputs once a step has started.
  chunkMs: 120_000,
  // Whole step (model call + retries + local tool runs) ceiling.
  stepMs: 300_000,
  // One Daytona tool call — screenshots and most commands land well inside
  // this; it bounds a wedged one.
  toolMs: 120_000,
}

// A member bot's row as the agent needs it: identity (name, job — what it
// is for), instructions (how it carries the job out — also its stated
// purpose), the seed the bot's face is generated from, and its sandbox.
// This IS the prompt: each bot is judged by these fields, so the group's
// member list each bot sees is the others' name + job + stated purpose (a
// bot may route a turn to a teammate on what that teammate is built to do).
interface BotRow {
  botId: string
  name: string
  job: string
  instructions: string | null
  avatar: string
  sandboxId: string | null
}

// A turn that ends in a RESOLVED handoff is done. The handoff's `execute`
// already streamed the teammate's answer into this very message, so any
// further step would only add the answering bot's "handing this to ~ /
// all set!" narration over a reply that is already on screen — and the
// transcript is the example the models copy: the observed failure was a
// bot *answering* as "That one's handed to Capra — hang tight! 🧮" after
// reading such narration in the history. Stopping the loop right after a
// successful handoff kills the narration and keeps the history clean.
// A *failed* handoff (unknown member, a sub-agent hiccup) does not match:
// the loop returns to the answering bot, which can pick another member or
// step in itself — exactly what its error line asks of it.
const stopAfterResolvedHandoff: StopCondition<ToolSet> = ({ steps }) => {
  const last = steps[steps.length - 1]
  if (!last?.content) return false
  return last.content.some((part) => {
    if (part.type !== "tool-result" || part.toolName !== "handoff") return false
    const output = part.output as { ok?: unknown } | null
    return output?.ok === true
  })
}

// Both group tools take a teammate NAME (the prompts show names, not ids),
// and both must reject a miss with the same actionable words — here's who is
// actually in the room — so the small model can retry or fall back correctly.
// One helper, one shape: a hit (the member row) or a miss (the error line).
function resolveMember(
  members: BotRow[],
  selfBotId: string,
  wanted: string
):
  | { kind: "found"; target: BotRow }
  | { kind: "missing"; error: string } {
  const wantedTrimmed = wanted.trim()
  const norm = (s: string) => s.trim().toLowerCase()
  const target = members.find(
    (member) =>
      norm(member.name) === norm(wantedTrimmed) || member.botId === wantedTrimmed
  )
  if (!target) {
    const otherNames = members
      .filter((member) => member.botId !== selfBotId)
      .map((member) => member.name)
      .join(", ")
    return {
      kind: "missing",
      error: `There is no such teammate as "${wanted}". The other members of this chat are: ${otherNames}.`,
    }
  }
  return { kind: "found", target }
}

// The instruction set a bot reads on a turn. Direct chats get the plain
// single-bot framing the bot has always had; group chats add the members
// (so the bot knows who is in the room and what each is for) and — when it
// holds the handoff tool — how to use it. A bot receiving a handoff gets the
// reason, framed as an instruction to take the job on.
function buildSystemPrompt(
  bot: BotRow,
  roster: BotRow[],
  options: {
    canHandOff?: boolean
    handoffReason?: string
    memoryQuery?: string
    // Group recall: the OTHER members' private notes (their MEMORY.md, read
    // at turn start), presented as this bot's own long-term memory of what
    // the user shared with the team privately.
    teammateMemory?: Array<{ name: string; notes: string }>
  } = {}
): string {
  const others = roster.filter((row) => row.botId !== bot.botId)
  const lines: string[] = [
    `You are ${bot.name}.`,
    `Your job: ${bot.job}.`,
    ...(bot.instructions?.trim()
      ? [`Your purpose: ${bot.instructions.trim()}.`]
      : []),
    bot.sandboxId
      ? `You run inside a Daytona sandbox (id: \`${bot.sandboxId}\`). This is your execution environment.`
      : "You run inside a Daytona sandbox. This is your execution environment.",
    "Work step by step: take an action, observe the result (a command output, a file, the screen), and adjust.",
    // Long-term memory. It goes in the COMMON part of the prompt — before
    // the handoff branch's early return — because the handed-TO bot is
    // precisely who a group will route a privately-known topic to, and it
    // must be told where its own notes are:
    "",
    "## Your long-term memory",
    "You keep personal notes at `~/MEMORY.md` in your sandbox (the file `MEMORY.md` in your home directory). They persist across chats and over days — unlike the conversation, which you only see while it lasts. Use it both ways:",
    "- NOTE IT: when the user tells you something worth keeping — a preference, a fact about them or their project, a decision, or something shared in a private 1:1 chat — add one short, dated line, e.g. run_bash:  echo \"- 2026-11-21: prefers dark mode\" >> ~/MEMORY.md",
    "- LOOK IT UP FIRST: when the turn is about the past (“what did I tell you about…”), or it is a group chat and the topic may have come up in a private 1:1 — run_bash:  cat ~/MEMORY.md   (or read_file “MEMORY.md”).",
    "Your memory is only what that file and the conversation actually say. If neither covers it, say you don't remember — never invent recall. In a group, answer from your memory, but don't paste the file's contents into the group.",
  ]

  if (options.teammateMemory && options.teammateMemory.length > 0) {
    // The structural half of group recall. The user shared personal facts
    // with individual members of the group in their 1:1s; those facts sit in
    // THOSE members' memory files, not this bot's. This bot may well be the
    // one asked, and a small local model told to "ask the team" will often
    // just answer "I don't know" instead — so the facts are pulled in here,
    // at turn start, and presented as this bot's own memory of the team's
    // private knowledge. The `ask_teammate_memory` tool stays as the live
    // path (a teammate may have just learned something, or its notes file
    // holds more than the excerpt below).
    lines.push("")
    lines.push("## Your team's private notes")
    lines.push(
      "What the user has shared privately with the members of this group is kept in their notes, and those notes are yours to use too. Treat them exactly as your own long-term memory: when the user asks about something the notes cover, answer from them as if you had always known it — and never mention notes, files, other members, or where the information came from. They are simply things you know about the user."
    )
    for (const entry of options.teammateMemory) {
      lines.push(`  • ${entry.name}:`)
      for (const line of entry.notes.split("\n")) {
        if (line.trim()) lines.push(`      ${line}`)
      }
    }
  }

  if (options.handoffReason) {
    // A bot receiving a handoff is the one answering: no handoff tool is
    // in play, so the mechanism is never MENTIONED (mentioning it is what
    // nudges a small model to try calling it, or to narrate around it).
    // Its history is crowded with routing chatter — "handed off to ~ —
    // hang tight!" — and a small local model copies the style it reads,
    // so the prompt must say the answer is the reply itself, and that the
    // chatter is not to be imitated.
    lines.push("")
    lines.push("## This turn is yours — answer the user")
    lines.push(
      `A teammate routed this turn to you because: “${options.handoffReason}”. ` +
        "You are the one answering — the user reads your words directly, so do the work in your own sandbox and deliver the actual answer. " +
        "Never mention routing, handoffs, or other members in your reply, and never write lines like “handed to ~”, “hang tight”, or “a teammate will…”: you ARE the responder. " +
        "If earlier messages contain such lines, they were routing chatter — do not copy that style or imitate it."
    )
    return lines.join("\n")
  }

  if (options.memoryQuery) {
    // A teammate in this group asked this bot internally for a recollection
    // (the group's "who remembers?" path). This bot is NOT conversing with
    // the user — it supplies the fact, or a clean denial, in a line the
    // asker can drop straight into its reply. It must not narrate the
    // mechanism, and the asker must be able to tell "nothing" apart from
    // "something", so the denial has one exact shape.
    lines.push("")
    lines.push("## A teammate is asking your memory (help them recall)")
    lines.push(
      `They need to know: “${options.memoryQuery}”. ` +
        "First check your notes (run_bash: cat ~/MEMORY.md), and what this conversation itself says. " +
        "If either has the answer, reply with ONLY the relevant fact or facts in one or two plain sentences — no greeting, no commentary, no mention of teammates, notes, or files. " +
        "If neither does, reply exactly: NO RECOLLECTION."
    )
    return lines.join("\n")
  }

  if (others.length > 0) {
    lines.push("")
    lines.push(`## Group rules — run this BEFORE you do any work`)
    lines.push(
      `This is a group chat of ${roster.length} bots. You are ${bot.name}.`
    )
    lines.push("The members, their jobs, and each one's stated purpose (so you can route to whoever is actually built for the task, not just the closest job title):")
    for (const m of roster) {
      const you = m.botId === bot.botId ? "  (that is you)" : ""
      const purpose = m.instructions?.trim()
        ? `  Purpose: “${m.instructions.trim()}”.`
        : ""
      lines.push(`  • ${m.name} — Job: ${m.job}.${purpose}${you}`)
    }
    lines.push("")
    lines.push("Decision procedure — decide who should answer, then act on the verdict:")
    lines.push("1. Read the user's request. Compare it against EVERY member's job AND stated purpose above, including yours. Route by what a member is actually built to do — a purpose like “write and review code” means writing code is squarely that member's lane, not just reviewing it.")
    lines.push("2. If it clearly fits ANOTHER member's job or stated purpose better than yours: hand the turn to that member with the `handoff` tool right now — name them exactly as in the list, with one line on why they fit. Do NOT do the work yourself first; do it in their lane, not yours.")
    lines.push("3. If it clearly fits YOUR job or stated purpose, or no member fits more clearly than you: answer the user yourself.")
    lines.push("4. If it is about something you don't know and no member's job clearly covers it — especially anything personal or private: the user's pets, family, preferences, projects, plans, or things they may have told a teammate in a private 1:1 — do NOT answer “I don't know” right away, and check the team's knowledge in order: FIRST the “Your team's private notes” section above — if it covers the question, your answer is already in context, just give it. ONLY if the notes don't cover it, ask the team's memories internally: call `ask_teammate_memory` for each teammate who might have heard it (if you're unsure, each one), and give each a one-line topic. Then give the user ONE clean reply — as if you always knew it. Never reveal the checking: no “I checked with ~”, no naming a teammate, no mention of memory, notes, or files. If the notes and the asking both come up empty, say plainly that you don't remember this.")
    lines.push("")
    lines.push("Never answer a request that clearly belongs to a teammate, and never hand off a request that clearly belongs to you. When in doubt, do not hand off to someone equally or less suited — if your job is the closest match, that IS your job.")
    lines.push("Every member has its own job and its own Daytona sandbox, so the right member can do the work directly the moment it takes the turn.")
  }

  if (options.canHandOff) {
    lines.push("")
    lines.push(
      "To hand off, call the `handoff` tool with the target member's name (exactly as listed above) and a one-line reason — and say nothing to the user before or after the call: no “handing this to ~”, no confirmations, no summaries of what the teammate will do. " +
        "When the call succeeds, your turn is over and the message ends there; the teammate's answer appears directly under the handoff, and nothing of yours may follow it."
    )
  }

  return lines.join("\n")
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
    // Present only for keyless providers (Ollama / local). Keyed providers
    // always send their credential id; a keyless one has no saved credential,
    // so this is optional and must be absent for it.
    credentialId: z.string().optional(),
    // Present only for a group chat: which member bot answers this turn
    // (the composer's picker, live). A direct chat sends none — its single
    // member is the only answerer, and the agent resolves it.
    botId: z.string().optional(),
  }),
  // The bot's computer-use tools (shell, files, mouse, keyboard, screen),
  // rebuilt for each turn's chat id. Declaring them on the agent — not just
  // handing them to streamText — is what lets the SDK re-apply each tool's
  // toModelOutput when it re-converts saved history on later turns
  // (view_screen's image, show_screen's one-liner).
  //
  // A group chat's per-turn pick (clientData.botId) is handed to the sandbox
  // resolver too — the answering bot's desktop is where its work happens. It
  // is validated against the chat's membership first: an unknown bot must not
  // earn a sandbox (creation writes its bot row), so a forged id degrades to
  // the chat's default bot instead.
  tools: async ({ chatId, clientData }) => {
    let botId: string | null = null
    const requested = clientData?.botId
    if (requested) {
      const [member] = await db
        .select({ botId: chatMembers.botId })
        .from(chatMembers)
        .where(
          and(eq(chatMembers.chatId, chatId), eq(chatMembers.botId, requested))
        )
        .limit(1)
      if (member) botId = requested
    }
    return buildComputerUseTools(chatId, botId)
  },
  // Stream errors (rate limits, provider failures) are sanitized before they
  // reach the browser — the raw message can carry provider internals.
  uiMessageStreamOptions: {
    onError: (error) => {
      console.error("[omnibot-chat] Stream error:", error)
      // Context overflow arrives as a deterministic 500 (see
      // isContextOverflowError), and isBusyError would swallow it as a
      // "busy" — check it first so the message says start a new chat.
      if (isContextOverflowError(error)) {
        return "This conversation is too long for the local model's context. Start a new chat and ask again."
      }
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
  // The predecessor run may have died mid-answer (a Stop click, a crash, a
  // worker restart, a TTL expiry mid-stream). The SDK's smart default keeps
  // that partial answer in context — but only when a follow-up user message
  // is present, splices the interrupted question without checking whether it
  // is already in the chain, and in the no-follow-up case drops the partial
  // outright. All three are wrong on this app: the user SAW the partial
  // stream, so the model must see it too, or it next answers as if that
  // reply never happened (a "or did that last one get cut off?" greeting, or
  // re-answering a question already in the transcript). Policy here:
  //
  // - the partial is ALWAYS spliced at the tail of the chain — and if the
  //   chain already carries an earlier, less-complete capture of the same
  //   in-flight message (a repeated recovery boot), that entry is replaced
  //   instead of duplicated;
  // - the interrupted question (first in-flight user) is spliced before the
  //   partial only when its id is not already in the chain — a second
  //   recovery boot otherwise leaves the same client message id twice;
  // - users who arrived AFTER the interrupted question are the follow-ups
  //   that booted this run — re-dispatch them in order, and leave the
  //   interrupted question in the chain rather than re-asking it;
  // - with NO follow-up (a bare retry after a crash) re-dispatch the
  //   interrupted question itself so the interrupted turn completes instead
  //   of stranding — the model sees question, its partial answer, and the
  //   question again, and finishes it.
  onRecoveryBoot: async ({
    settledMessages,
    inFlightUsers,
    partialAssistant,
  }) => {
    if (!partialAssistant) return
    const chain = [...settledMessages]
    const interrupted = inFlightUsers[0]
    if (
      interrupted &&
      interrupted.role === "user" &&
      !chain.some((message) => message.id === interrupted.id)
    ) {
      chain.push(interrupted)
    }
    const tail = chain[chain.length - 1]
    if (tail && tail.id === partialAssistant.id) {
      chain[chain.length - 1] = partialAssistant
    } else {
      chain.push(partialAssistant)
    }
    const hasFollowUp = inFlightUsers.length > 1
    return {
      chain,
      recoveredTurns: hasFollowUp ? inFlightUsers.slice(1) : inFlightUsers,
    }
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

    // Which bot answers this turn: the chat's members in join order. For a
    // direct chat there is exactly one; for a group chat the composer's pick
    // (clientData.botId) overrides the default (first member) — and is
    // validated against the membership, so a bot outside the chat cannot
    // answer in it. The row carries the identity the base instructions
    // describe — name, job (what the bot is for), and instructions (how it
    // should carry the job out).
    const members = await db
      .select({
        botId: chatMembers.botId,
        name: bots.name,
        job: bots.job,
        instructions: bots.instructions,
        avatar: bots.avatar,
        sandboxId: bots.sandboxId,
      })
      .from(chatMembers)
      .innerJoin(bots, eq(chatMembers.botId, bots.id))
      .where(eq(chatMembers.chatId, chatId))
      .orderBy(asc(chatMembers.joinedAt))
    if (members.length === 0) {
      throw new Error("No bot is set up for this chat.")
    }
    let targetBotId = members[0].botId
    if (clientData.botId) {
      if (!members.some((member) => member.botId === clientData.botId)) {
        throw new Error("That bot is not a member of this chat.")
      }
      targetBotId = clientData.botId
    }
    const bot =
      members.find((member) => member.botId === targetBotId) ?? members[0]
    // A group chat has two or more members — the only shape where a bot can
    // hand the turn to a different one, and the only shape that carries the
    // handoff tool. A direct chat is a single member with no one to hand to.
    const isGroup = members.length >= 2

    // Group recall, structural side. The user told individual MEMBERS of this
    // group private things in their 1:1s (their name, their project, ...);
    // each member kept those in its OWN sandbox's MEMORY.md, so the member
    // who happens to answer THIS turn does not know them — and a small local
    // model told to "ask the team internally" will often just answer "I don't
    // know" instead. So every group turn ships the other members' notes in
    // the answering bot's system prompt, as its own long-term memory of what
    // the user shared with the team. Direct chats skip this entirely (the one
    // member's own memory prompt already covers its own 1:1s).
    // Best-effort and time-capped, in parallel, and never fatal: a stopped,
    // wedged, or dead teammate sandbox just contributes no notes — the turn
    // still answers, and `ask_teammate_memory` remains the live path.
    let teammateMemory: Array<{ name: string; notes: string }> = []
    if (isGroup) {
      const reads = Promise.all(
        members
          .filter((member) => member.botId !== bot.botId)
          .map(async (member) => {
            const notes = await readBotMemory(member.botId)
            return notes ? { name: member.name, notes } : null
          })
      ).then((results) => results.filter((notes): notes is NonNullable<typeof notes> => notes !== null))
      teammateMemory =
        (await Promise.race([
          reads,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 30_000)),
        ])) ?? []
    }

    // The transcript must remember WHICH bot said what: a group chat is
    // answered by whichever member the composer picked for the turn, and even
    // a direct chat's owner may want the bot's face by its reply. Stamp this
    // assistant message with the answering bot's identity — `avatar` is the
    // same seed the group avatar and the picker render from, so the face next
    // to the message matches everywhere else. The data part streams live and
    // persists with the message, so the stamp survives a reload.
    chat.response.write({
      type: "data-group-bot",
      data: { id: targetBotId, name: bot.name, avatar: bot.avatar },
    })

    // A keyless (local) provider — Ollama — needs no saved credential, so the
    // owner-scoped lookup + decrypt below only runs for keyed ones. For a
    // keyless one `key` stays undefined and createProvider() omits the
    // Authorization header (Ollama ignores it).
    let key: string | undefined
    if (provider.requiresApiKey !== false) {
      if (!credentialId) {
        throw new Error("Choose a credential to start chatting.")
      }

      // Who owns this chat — the credential must belong to THEM, and to the
      // requested provider, exactly like the old getCredentialKey query.
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

      try {
        key = decryptCredential(row.apiKey)
      } catch (error) {
        // A corrupt or re-keyed row: log the real error, surface nothing.
        console.error("[omnibot-chat] Failed to decrypt credential:", error)
        throw new Error("Unknown credential.")
      }
    }

    // `streamText`, `signal`, `tools`, and the already-converted `messages`
    // all come from the run — the managed streamText carries the agent's
    // options, the resolved tool set is the one declared on the agent (the
    // `tools` function above), and the signal is what makes Stop abort the
    // model call server-side.
    //
    // The system prompt is built once per bot from its row (name, job,
    // purpose, sandbox) plus — for a group — the member roster (so the bot
    // knows who is in the room and what each is for) and, on the answering
    // bot only, how to use the handoff tool.
    const makeModel = () => provider.createProvider(key)(modelId)
    const system = buildSystemPrompt(bot, members, {
      canHandOff: isGroup,
      teammateMemory,
    })

    // The group-only handoff tool, built here rather than in the agent's
    // `tools` function because the answering bot's identity and the
    // conversation it is handing off to are only known in the run. Its
    // `execute` starts a fully separate model call for the target bot —
    // same provider and model, but that bot's own identity, sandbox tools,
    // and the same conversation — and streams the answer back into this
    // turn (as the parent's tool result) via `chat.forwardSubAgent`. The
    // target gets no handoff tool of its own, so the hand cannot bounce
    // between members.
    let toolsForTurn: ToolSet = tools
    if (isGroup) {
      toolsForTurn = {
        ...tools,
        // ----- Internal memory recall -------------------------------------
        // The quiet team tool, group-only like `handoff`: ask a teammate to
        // check THEIR long-term memory (what the user may have told them in
        // a 1:1) about a topic. Unlike `handoff` the teammate does NOT take
        // the turn — its recollection comes back into the ANSKER's context
        // as the tool output, and the asker delivers the one final reply.
        // Hence two deliberate omissions: no chat.forwardSubAgent (forwarding
        // would stream the teammate's words into the message the way the
        // handoff does — this exchange must stay internal), and no stop
        // condition (stopAfterResolvedHandoff keys off the "handoff" tool
        // name and ok:true, so it can't fire here — the asker must be free
        // to combine several recollections and then speak).
        ask_teammate_memory: tool({
          description:
            "Ask a teammate in this group chat to check their long-term memory about a topic — for things the user may have told them privately (in a 1:1) over time: the user's pets, family, preferences, projects, plans, personal facts. " +
            "You stay the one answering the user: the teammate's recollection comes back to you here, and you deliver the final reply yourself. " +
            "Use it only for recall. Do NOT use it to make a teammate do their job — for that, hand off.",
          inputSchema: z.object({
            targetName: z
              .string()
              .min(1)
              .describe(
                "The name of a different member bot in this chat to ask, exactly as shown in the member list above (e.g. \"David\"). Never your own name.",
              ),
            topic: z
              .string()
              .min(1)
              .describe(
                "One short line on what to recall, e.g. \"the user's cat's name\".",
              ),
          }),
          execute: async ({ targetName, topic }, { abortSignal }) => {
            const hit = resolveMember(members, bot.botId, targetName)
            if (hit.kind === "missing") {
              return {
                ok: false,
                error:
                  hit.error +
                  " Ask one of them by name, or read your own memory (run_bash: cat ~/MEMORY.md) and answer the user yourself.",
              }
            }
            if (hit.target.botId === bot.botId) {
              return {
                ok: false,
                error:
                  "That is you — read your own memory instead (run_bash: cat ~/MEMORY.md).",
              }
            }

            // The teammate answers with their OWN identity, in their OWN
            // sandbox — so they can read their own MEMORY.md (their private
            // 1:1 notes), which the asker cannot touch at all. The sub's
            // prompt (the memoryQuery branch) tells them to reply with just
            // the fact(s) or the exact sentinel "NO RECOLLECTION".
            const targetSystem = buildSystemPrompt(hit.target, members, {
              memoryQuery: topic,
            })
            const targetTools = buildComputerUseTools(chatId, hit.target.botId)
            const sub = aiStreamText({
              model: makeModel(),
              system: targetSystem,
              messages,
              tools: targetTools,
              // A recall is short: check the file, answer. Ten calls is far
              // more runway than needed and still finite.
              stopWhen: isStepCount(10),
              abortSignal,
              timeout: turnTimeout,
              maxRetries: 3,
              providerOptions: { openaiCompatible: { keep_alive: "1h" } },
            })

            // Run the sub to completion WITHOUT forwarding it: no
            // chat.forwardSubAgent, so nothing of its stream rides to the
            // chat UI — the recall stays internal (that is the whole point
            // of this tool vs `handoff`). `await sub.text` is sufficient to
            // drive the stream to completion: in ai@7 the Result's text
            // getter self-consumes (verified in the installed
            // createStreamResult: `get text() { consumeStream(); … }`), and
            // it resolves with the accumulated text or rejects on a stream
            // error — both handled here. (Notably we do NOT touch
            // `fullStream`: once claimed it is single-access, and claiming
            // it would be pointless without a consumer.)
            let recollection = ""
            try {
              recollection = (await sub.text).trim()
            } catch (error) {
              console.error("[omnibot-chat] memory-query sub-agent errored:", error)
            }

            if (!recollection) {
              return {
                ok: false,
                error:
                  "The teammate could not check their memory just now. Read your own memory (run_bash: cat ~/MEMORY.md) or answer the user yourself.",
              }
            }

            return {
              ok: true,
              targetName: hit.target.name,
              recollection,
            }
          },
          toModelOutput: ({ output }) => {
            // The tool OUTPUT is a plain record — the rejection
            // ({ ok: false, error }) or the teammate's recollection
            // ({ ok: true, recollection }). Hand the asker a line they can
            // act on: a fact to build into the reply, or a clean "nothing
            // here" (the exact sentinel the receiver was told to send, so
            // the asker never has to guess whether vague silence means
            // "nothing" or "truncated something").
            const record = output as
              | { ok: false; error: string }
              | { ok: true; targetName: string; recollection: string }
            if (record.ok !== true) {
              const errorText =
                record.ok === false && typeof record.error === "string"
                  ? record.error
                  : "The teammate could not check their memory."
              // `error-text` carries a plain string, not an object.
              return { type: "error-text", value: errorText }
            }
            const recollection = (record.recollection ?? "").trim()
            if (!recollection || /^no recollection/i.test(recollection)) {
              return {
                type: "text",
                value: `${record.targetName} has no recollection of this.`,
              }
            }
            return {
              type: "text",
              value: `${record.targetName} recalls: ${recollection}`,
            }
          },
        }),
        handoff: tool({
          description:
            "Hand the turn to a more suitable teammate in this group chat. " +
            "Use it only when the user's request fits another member's job clearly " +
            "better than yours — name that member (use their name from the member " +
            "list), and say in one line why. After you hand off, that teammate " +
            "takes the turn; do not keep working. " +
            "This delegates a JOB — to recall something a teammate may have been " +
            "told privately, use `ask_teammate_memory` instead: their recollection " +
            "comes back to you and you keep the reply.",
          inputSchema: z.object({
            targetName: z
              .string()
              .min(1)
              .describe(
                "The name of a different member bot in this chat to hand the turn " +
                  "to, exactly as shown in the member list above (e.g. \"Capra\")."
              ),
            reason: z
              .string()
              .min(1)
              .describe("One short sentence on why that member is the better fit."),
          }),
          execute: async ({ targetName, reason }, { toolCallId, abortSignal }) => {
            // Validate the target against the actual members of THIS chat: a
            // handoff to a bot outside the room is rejected in words so the
            // answering bot can choose someone else (or step in itself).
            // (Name resolution shared with `ask_teammate_memory` — see
            // resolveMember; the model may echo a raw bot id, which is
            // tolerated.)
            const hit = resolveMember(members, bot.botId, targetName)
            if (hit.kind === "missing") {
              return {
                ok: false,
                error:
                  hit.error +
                  " Hand the turn to one of them by name, or answer the user yourself.",
              }
            }
            const target = hit.target
            if (target.botId === bot.botId) {
              return {
                ok: false,
                error:
                  "That is you — you cannot hand off to yourself. Answer the user's request directly.",
              }
            }
            // The target bot answers the same conversation with its own
            // identity and sandbox. Bot A's turn already stamped the parent
            // message with its own face; the sub-agent reply is rendered
            // under the handoff with the TARGET's face and name (the client
            // looks the target bot up in the group member list).
            const targetSystem = buildSystemPrompt(target, members, {
              handoffReason: reason,
            })
            const targetTools = buildComputerUseTools(chatId, target.botId)
            const sub = aiStreamText({
              model: makeModel(),
              system: targetSystem,
              messages,
              tools: targetTools,
              stopWhen: isStepCount(40),
              abortSignal,
              timeout: turnTimeout,
              maxRetries: 3,
              providerOptions: { openaiCompatible: { keep_alive: "1h" } },
            })
            // Stream the target bot's reply through this tool call: its
            // chunks ride `data-subagent` (transient) to the browser while it
            // runs, and forwardSubAgent resolves with the final message. We
            // persist that final message's parts as the tool's OUTPUT (a
            // concrete, JSON-friendly record — not the generic UIMessage,
            // which would defeat the tool()'s output-type inference), so the
            // handoff answer still renders after a reload.
            //
            // A sub-agent stream that ERRORS (a wedged/`no user query` local
            // model, a 5xx, context overflow) rejects here; one that ends
            // EMPTY resolves `undefined`. Neither may be swallowed silently —
            // capture the real reason, log it, and hand the answering bot a
            // line it can act on, so the client shows WHY not "not available".
            // The reply is recovered on two layers so a server-side hiccup
            // (a wedged local model, an overflowed context, a failed managed
            // stream) never leaves the user with a dead-end. Layer 1 is
            // forwardSubAgent's final message (its reducer); layer 2 is the
            // sub result's own text, which is proven to resolve even after the
            // UI stream is consumed, and is used when the message comes back
            // empty or the call throws.
            let forwarded
            let forwardError: unknown
            try {
              forwarded = await chat.forwardSubAgent(
                sub.toUIMessageStream(),
                { toolCallId },
              )
            } catch (error) {
              forwardError = error
              console.error(
                "[omnibot-chat] handoff sub-agent errored:",
                error,
              )
            }

            // Prefer the forwarded message's parts; fall back to the sub
            // result's accumulated text (wrapping it as a single text part).
            let parts: Array<Record<string, unknown>> = []
            const forwardedParts =
              forwarded && Array.isArray(forwarded.parts) ? forwarded.parts : []
            if (forwardedParts.length > 0) {
              parts = forwardedParts as unknown as Array<Record<string, unknown>>
            } else {
              let text = ""
              try {
                text = await sub.text
              } catch {
                text = ""
              }
              if (text && text.trim()) {
                console.warn(
                  "[omnibot-chat] forwardSubAgent gave no parts; recovered " +
                    "the reply via the sub-agent's own text",
                )
                parts = [{ type: "text", text }]
              }
            }

            if (parts.length === 0) {
              const detail =
                forwardError instanceof Error
                  ? forwardError.message
                  : typeof forwardError === "string"
                    ? forwardError
                    : ""
              console.error(
                "[omnibot-chat] handoff sub-agent produced no reply",
                detail,
              )
              return {
                ok: false,
                error:
                  `The teammate could not produce an answer just now${
                    detail ? ` (${detail})` : ""
                  }. Answer the user yourself, or ask to try again.`,
              }
            }

            return {
              ok: true,
              targetBotId: target.botId,
              targetName: target.name,
              parts,
            }
          },
          toModelOutput: ({ output }) => {
            // The tool OUTPUT is a plain record — either the rejection
            // ({ ok: false, error }) or the target bot's reply
            // ({ ok: true, parts }). Hand the model the last text part of the
            // reply (not the tool parts or image bytes), so later turns
            // re-read the handoff as a clean answer, not a JSON blob.
            const record = output as
              | { ok: false; error: string }
              | {
                  ok: true
                  targetBotId: string
                  targetName: string
                  parts: Array<{ type: string; text?: string }>
                }
            // Narrow on the `ok` discriminator so `.parts` is only read on the
            // success branch (the rejection has no `parts`).
            if (record.ok !== true) {
              const errorText =
                record.ok === false && typeof record.error === "string"
                  ? record.error
                  : "The handoff to a teammate could not be completed."
              // `error-text` carries a plain string, not an object.
              return { type: "error-text", value: errorText }
            }
            const lastText = (record.parts ?? [])
              .filter((part) => part.type === "text" && typeof part.text === "string")
              .map((part) => part.text as string)
              .slice(-1)
              .join("\n")
            return { type: "text", value: lastText || "The turn was handed off to a teammate." }
          },
        }),
      }
    }

    return streamText({
      model: makeModel(),
      system,
      messages,
      tools: toolsForTurn,
      // The AI SDK caps the tool loop at ONE step by default — one model
      // call, its tools run, and over. Desktop work needs many
      // act-observe-act round trips, so the limit is lifted explicitly. 50
      // model calls (each running its own tool batch) is the runway for a
      // turn; the model simply stops calling tools when the job is done.
      //
      // In a group chat a resolved handoff ends the turn too — the
      // teammate's answer already landed inside this message, so there is
      // nothing left for the answering bot to say (see
      // stopAfterResolvedHandoff). In a direct chat there is no handoff
      // tool, so the cap alone governs.
      stopWhen: isGroup
        ? [isStepCount(50), stopAfterResolvedHandoff]
        : isStepCount(50),
      abortSignal: signal,
      timeout: turnTimeout,
      // A few attempts over a transient "high demand" 503 before we give up.
      // Each 503 is fast; the timeout above caps how long the set can run.
      maxRetries: 3,
      // Provider-specific body fields. The `openaiCompatible` key is read
      // only by the one provider in the registry that uses
      // `@ai-sdk/openai-compatible` (Ollama) — Google/OpenAI/Anthropic/xAI
      // each go through their own SDKs and never see this — so scoping a
      // local-only knob here is safe, and it flows into the /v1 body as a
      // top-level field (non-schema providerOptions values pass through;
      // verified in the SDK's transformRequestBody).
      //
      // `keep_alive`: Ollama evicts an idle model after ~5 min by default;
      // re-seating a 17 GB Q4_K_M into the GPU before the first token reads
      // as a hang between turns. Every completion slides this window, so the
      // model stays warm while a conversation is active and frees VRAM long
      // after it goes quiet. (Verified against this Ollama build: a
      // completion with "keep_alive":"3h" extended `ollama ps` to 3h.)
      providerOptions: {
        openaiCompatible: { keep_alive: "1h" },
      },
    })
  },
})
