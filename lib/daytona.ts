import { Daytona, DaytonaNotFoundError, type Sandbox } from "@daytona/sdk"
import { asc, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { bots, chatMembers } from "@/lib/db/schema"

// Thin, server-only wrapper around the Daytona SDK that covers what a bot's
// lifecycle needs: bring a sandbox into being when a bot is created, take it
// down when the bot is deleted, and hand a running sandbox to the chat agent
// when a bot has real work to do.
//
// The client reads DAYTONA_API_KEY / DAYTONA_API_URL from process.env (Next.js
// loads .env.local into server code). A fresh client is built per call so a
// key rotated in the environment is always picked up, and each instance's
// connection is torn down when the call ends (it never keeps the process
// alive on its own).
function daytona(): Daytona {
  // Pin the region explicitly so placement is deterministic no matter what the
  // org's default happens to be. Defaults to the US shared region ("us");
  // override with DAYTONA_REGION (e.g. "eu").
  //
  // NOTE: this org currently has no default region set, which Daytona requires
  // before it will create any sandbox (it 400s with "This organization does not
  // have a default region."). That is a one-time admin step in the Daytona
  // Dashboard (Settings → Regions → set a default) that a sandbox-scoped `dtn_`
  // API key cannot perform — once it's done, the create()/delete() below work.
  //
  // The endpoint MUST be passed as `apiUrl`, not left to the SDK to resolve:
  // when the endpoint is in both the process environment and a .env.local in
  // the working directory (true here in Next.js *and* in the Trigger dev
  // worker), an unset `apiUrl` makes the SDK throw DaytonaInvalidArgumentError
  // ("the endpoint is ambiguous"). Name it explicitly and the check is skipped.
  const apiUrl =
    process.env.DAYTONA_API_URL ?? process.env.DAYTONA_SERVER_URL ?? undefined
  const target = process.env.DAYTONA_REGION ?? "us"
  return new Daytona({ apiUrl, target })
}

/**
 * Create a fresh sandbox for a bot and return its id. That id is what the
 * caller stores on the bot row (bots.sandboxId) to keep the two linked. We
 * create with defaults — no specific image, name, or resources — because
 * nothing about the bot's runtime is decided yet.
 */
export async function createSandbox(): Promise<string> {
  const sandbox = await daytona().create()
  return sandbox.id
}

/**
 * Permanently destroy a bot's sandbox by id. Idempotent: if the sandbox is
 * already gone (a retried delete, or Daytona reclaimed it) that is treated as
 * success and the function resolves. Any other failure is re-thrown so the
 * caller can decide how hard a failed cleanup should land.
 */
export async function deleteSandbox(sandboxId: string): Promise<void> {
  const d = daytona()
  try {
    const sandbox = await d.get(sandboxId)
    await sandbox.delete()
  } catch (error) {
    if (error instanceof DaytonaNotFoundError) return
    throw error
  }
}

/**
 * The one bot a direct chat maps to (chatMembers), or null for a bot-less
 * chat. Callers that merely need "are there tools here?" (the agent's tool
 * set) use this; `resolveChatSandbox` builds on it.
 */
export async function chatBotId(chatId: string): Promise<string | null> {
  // A group chat has several members — the chat's default voice is its
  // earliest-joined bot, so the tie is by join order, not database luck.
  const [membership] = await db
    .select({ botId: chatMembers.botId })
    .from(chatMembers)
    .where(eq(chatMembers.chatId, chatId))
    .orderBy(asc(chatMembers.joinedAt))
    .limit(1)
  return membership?.botId ?? null
}

/**
 * Resolve a bot's sandbox as a live, started handle. The bot's `sandboxId`
 * is the link. When the bot row has no sandbox (its create failed at
 * bot-creation time) one is created now and the id persisted — creation
 * failures at bot-creation are tolerated there, so this stays the recovery
 * path.
 *
 * A stored id that the platform no longer knows (destroyed or reclaimed) is
 * cleared from the row and replaced by a fresh sandbox instead of letting the
 * stale reference keep failing the chat. Other errors propagate — they are
 * user-visible in the tool result, and hiding them would mask real outages.
 */
export async function resolveBotSandbox(botId: string): Promise<Sandbox> {
  const [bot] = await db
    .select({ sandboxId: bots.sandboxId })
    .from(bots)
    .where(eq(bots.id, botId))
  if (!bot) {
    throw new Error("This bot no longer exists.")
  }

  const d = daytona()
  if (bot.sandboxId) {
    try {
      return await started(await d.get(bot.sandboxId))
    } catch (error) {
      if (!(error instanceof DaytonaNotFoundError)) throw error
      // Gone from the platform: drop the stale link so this call — and the
      // next ones — re-create it. The chat keeps working, no manual fix-up.
      await db.update(bots).set({ sandboxId: null }).where(eq(bots.id, botId))
    }
  }

  const sandbox = await started(await d.create())
  await db.update(bots).set({ sandboxId: sandbox.id }).where(eq(bots.id, botId))
  return sandbox
}

/**
 * Resolve the chat's default bot's sandbox (its earliest-joined member).
 * A direct chat is one bot; a group chat's default voice is the first.
 * A group turn answered by a *chosen* member calls `resolveBotSandbox` with
 * that bot directly instead.
 */
export async function resolveChatSandbox(chatId: string): Promise<Sandbox> {
  const botId = await chatBotId(chatId)
  if (!botId) {
    throw new Error("This chat has no bot, so there is no sandbox to run in.")
  }
  return resolveBotSandbox(botId)
}

// Sandbox states that mean "not usable" (the SDK's lifecycle vocabulary). A
// sandbox in one of these is not startable — the bot needs a fresh one.
const TERMINAL_STATES = new Set([
  "build_failed",
  "building_snapshot",
  "destroyed",
  "destroying",
  "error",
])

/** Bring a fetched sandbox to a state where calls can be made against it. */
async function started(sandbox: Sandbox): Promise<Sandbox> {
  const state = sandbox.state ?? ""
  if (TERMINAL_STATES.has(state)) {
    throw new Error(
      `The bot's sandbox is in a "${state}" state and can't be restarted. ` +
        "Delete the bot and create a fresh one."
    )
  }
  if (state === "stopped" || state === "paused") {
    await sandbox.start()
  } else if (state !== "started") {
    // Still coming up (creating, starting, restoring, …) — wait for it.
    await sandbox.waitUntilStarted(120)
  }
  return sandbox
}

/**
 * The desktop stack (Xvfb, xfce4, x11vnc, noVNC) has to be running before any
 * mouse, keyboard, or screenshot call works. Start it only when it isn't —
 * a redundant start is wasted work, and the goal is one idempotent gate for
 * every desktop tool.
 */
export async function ensureComputerUse(sandbox: Sandbox): Promise<void> {
  try {
    const { status } = await sandbox.computerUse.getStatus()
    if (status && /running/i.test(status)) return
  } catch {
    // Status probe unavailable — fall through and let start() say the word.
  }
  await sandbox.computerUse.start()
}

/**
 * Mint a signed preview URL for the chat's bot desktop — the noVNC web
 * console served by the sandbox on port 6080. Bring the sandbox up, make
 * sure the desktop stack is running, then sign a URL that works from any
 * browser without credentials (no API key header needed — that's the whole
 * point of it).
 *
 * One hour: long enough for a session, short enough to force a fresh mint
 * (actions/desktop.ts mints again on every refresh) whenever the sandbox
 * has since been resumed.
 */
export async function desktopPreviewUrl(chatId: string): Promise<string> {
  const sandbox = await resolveChatSandbox(chatId)
  await ensureComputerUse(sandbox)
  return (await sandbox.getSignedPreviewUrl(6080, 3600)).url
}
