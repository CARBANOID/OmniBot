// The computer-use toolset behind a bot's chat: the shell, the files, and
// control of the desktop in its Daytona sandbox — mouse, keyboard, screen.
//
// `buildComputerUseTools(chatId, botId)` closes the set around where the
// work happens: the answering bot's sandbox when `botId` names one (a group
// chat's per-turn pick), else the chat's default bot (first-joined member).
// Tools resolve that sandbox lazily on first use (inside `execute`) — never
// at declaration time. The SDK's history-conversion pass
// only reads `inputSchema` and `toModelOutput`, so declaring tools must stay
// I/O-free; doing a sandbox lookup there would hit the network on every turn.
//
// Two screen tools share one capture:
//   • view_screen — the model looks, the user doesn't; the image goes to the
//     model via `toModelOutput`, and nothing renders in the chat.
//   • show_screen — the user sees; the raw image lives on the executed result
//     (it is what the UI renders), while `toModelOutput` hands the model a
//     one-liner so later turns don't re-feed megabytes into its context.

import { type Sandbox } from "@daytona/sdk"
import { tool, type ToolSet } from "ai"
import { z } from "zod"

import {
  ensureComputerUse,
  resolveBotSandbox,
  resolveChatSandbox,
} from "@/lib/daytona"

// ---------------------------------------------------------------------------
// Sandbox resolution: memoized per chat, one automatic retry on a dead handle
// ---------------------------------------------------------------------------

// The sandbox lives per BOT (bots.sandboxId): a bot that answers in two
// chats shares one sandbox, so the cache is keyed by the bot id when the
// turn names one, and by the chat id when it doesn't (the chat's default bot
// then resolves lazily behind it). The worker process outlives any single
// chat, and a bot's sandbox is the only long-lived object we cache — cap the
// map and evict the least recently resolved entry first.
const sandboxByKey = new Map<string, Promise<Sandbox>>()
const MAX_CACHED_SANDBOXES = 32

function rememberSandbox(
  key: string,
  sandbox: Promise<Sandbox>
): Promise<Sandbox> {
  sandboxByKey.delete(key)
  sandboxByKey.set(key, sandbox)
  while (sandboxByKey.size > MAX_CACHED_SANDBOXES) {
    const oldest = sandboxByKey.keys().next().value
    if (oldest === undefined) break
    sandboxByKey.delete(oldest)
  }
  return sandbox
}

function getSandbox(
  key: string,
  resolve: () => Promise<Sandbox>
): Promise<Sandbox> {
  return sandboxByKey.get(key) ?? rememberSandbox(key, resolve())
}

/**
 * Every tool body runs through this: it resolves the named sandbox and
 * performs `operation` on it. If the call fails and a cached handle was in
 * play, the cache entry is dropped and the operation is retried once against
 * a freshly resolved sandbox — a sandbox destroyed or reclaimed by Daytona
 * mid-session would otherwise stay pinned for the worker's life.
 */
async function withSandbox<T>(
  key: string,
  resolve: () => Promise<Sandbox>,
  operation: (sandbox: Sandbox) => Promise<T>
): Promise<T> {
  try {
    return await operation(await getSandbox(key, resolve))
  } catch (error) {
    if (!sandboxByKey.delete(key)) throw error
    return operation(await getSandbox(key, resolve))
  }
}

// ---------------------------------------------------------------------------
// Tool result shape + shared helpers
// ---------------------------------------------------------------------------

type ToolFailure = { ok: false; error: string }

/**
 * An `execute` should not throw into the model: a thrown tool lands on the
 * transcript as a raw `output-error` with internals we don't control. Catch
 * instead and return a readable failure — the model sees `{ ok: false, … }`
 * and the chat renders it like any other result.
 */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === "string" ? error : String(error)
}

function fail(error: unknown, context: string): ToolFailure {
  console.error(`[omnibot-chat] ${context}:`, error)
  return {
    ok: false,
    error: messageOf(error) || "The sandbox call failed.",
  }
}

/** Keep only the (most useful) tail of a long command output. */
function keepTail(value: string, limit: number): string {
  if (value.length <= limit) return value
  return (
    `… [dropped ${value.length - limit} leading characters]\n` +
    value.slice(value.length - limit)
  )
}

/** Keep only the head of a long file chunk. */
function keepHead(value: string, limit: number): string {
  if (value.length <= limit) return value
  return (
    value.slice(0, limit) +
    `\n… [dropped ${value.length - limit} trailing characters]`
  )
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

/**
 * Daytona's screenshot contract is a bare base64 string, but tolerate a
 * `data:`-URL form too and surface the claimed media type either way so the
 * image can be addressed by its real type in the chat and in the model.
 */
function normalizeImage(raw: string): { data: string; mediaType: string } {
  const match = /^data:([a-z0-9.+-]+)\/([a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(
    raw
  )
  if (match) return { mediaType: `${match[1]}/${match[2]}`, data: match[3] }
  return { mediaType: "image/png", data: raw }
}

/** One capture: cursor visible, media type normalized. */
async function takeScreenshot(
  sandbox: Sandbox
): Promise<{ data: string; mediaType: string; bytes?: number }> {
  await ensureComputerUse(sandbox)
  const response = await sandbox.computerUse.screenshot.takeFullScreen(true)
  if (!response.screenshot) {
    throw new Error("The sandbox did not return screenshot data.")
  }
  const image = normalizeImage(response.screenshot)
  return { ...image, bytes: response.sizeBytes }
}

/** The primary display's size, when the sandbox reports it. Best effort. */
async function displaySize(
  sandbox: Sandbox
): Promise<{ width?: number; height?: number }> {
  try {
    const info = await sandbox.computerUse.display.getInfo()
    // The SDK docs reference `info.primary_display`; the generated model
    // only promises `displays[]`. Take the first real entry either way.
    const record = info as unknown as {
      primary_display?: { width?: number; height?: number }
      displays?: Array<{ width?: number; height?: number }>
    }
    const display =
      record.primary_display ??
      record.displays?.find((d) => d.width && d.height) ??
      record.displays?.[0]
    return { width: display?.width, height: display?.height }
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// The toolset
// ---------------------------------------------------------------------------

const BASH_OUTPUT_LIMIT = 8_000 // characters kept from a command's output
const READ_FILE_LIMIT = 30_000 // characters of file content
const MAX_LIST_ENTRIES = 500 // rows returned by list_files

/**
 * The full computer-use toolset for one chat, closed over where its work
 * happens. Declaration is pure (see the note at the top) — every call
 * defers to the sandbox on demand, so this is what the agent's per-turn
 * `tools` resolves to.
 *
 * `botId` names the answering bot's sandbox (a group chat's per-turn pick,
 * validated against the chat's membership before it gets here). Without it
 * the set falls back to the chat's default bot (first-joined member).
 *
 * `userHandoff` (default true) switches the `wait` tool in and out. It is
 * out for group sub-agents: a group chat has no user-facing desktop, so a
 * pending handover there could never be answered — the tool is withheld
 * from the model rather than letting it call into a dead end.
 */
export function buildComputerUseTools(
  chatId: string,
  botId: string | null = null,
  options: { userHandoff?: boolean } = {}
): ToolSet {
  // The sandbox is a bot thing: cache it where it actually lives (the bot
  // row), or lazily resolve the chat's default bot behind the chat id.
  const key = botId ?? chatId
  const resolve = botId
    ? () => resolveBotSandbox(botId)
    : () => resolveChatSandbox(chatId)

  function withSandboxFor<T>(
    operation: (sandbox: Sandbox) => Promise<T>
  ): Promise<T> {
    return withSandbox(key, resolve, operation)
  }

  return {
    // ----- Terminal -------------------------------------------------------
    run_bash: tool({
      description:
        "Run a shell command in the bot's Daytona sandbox (a full Linux machine with a desktop). " +
        "Install software, run programs and scripts, use git, inspect the system, or start long-running " +
        "servers (for those: redirect output and append `&` so the call returns). " +
        "Returns the combined command output and the exit code.",
      inputSchema: z.object({
        command: z
          .string()
          .min(1)
          .describe(
            "The shell command to run (bash syntax), e.g. `ls -la` or `pip install requests`"
          ),
        cwd: z
          .string()
          .optional()
          .describe(
            "Working directory inside the sandbox (absolute path). Omit for the home directory."
          ),
        timeout: z
          .number()
          .int()
          .min(5)
          .max(600)
          .optional()
          .describe("Give up after this many seconds (default 60)."),
      }),
      execute: async ({ command, cwd, timeout }) => {
        try {
          return await withSandboxFor(async (sandbox) => {
            const response = await sandbox.process.executeCommand(
              command,
              cwd,
              undefined,
              timeout ?? 60
            )
            return {
              exitCode: response.exitCode,
              output: keepTail(
                response.artifacts?.stdout ?? response.result ?? "",
                BASH_OUTPUT_LIMIT
              ),
            }
          })
        } catch (error) {
          return fail(error, `run_bash ${command}`)
        }
      },
    }),

    // ----- Files ----------------------------------------------------------
    read_file: tool({
      description:
        "Read a text file from the bot's sandbox: at most `limit` lines starting at 1-based `offset`. " +
        "Binary files are detected and reported instead of dumped — for those, prefer run_bash " +
        "(e.g. `file`, `hexdump`, `xxd`).",
      inputSchema: z.object({
        path: z
          .string()
          .min(1)
          .describe(
            "File to read (absolute, or relative to the sandbox home directory)"
          ),
        offset: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Line to start at, 1-based (default 1)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(2000)
          .optional()
          .describe("Max lines to return (default 300)"),
      }),
      execute: async ({ path, offset, limit }) => {
        try {
          return await withSandboxFor(async (sandbox) => {
            const buffer = await sandbox.fs.downloadFile(path)
            // A null byte anywhere early marks the file as binary.
            if (buffer.subarray(0, 8192).includes(0)) {
              return {
                binary: true,
                bytes: buffer.length,
                note: "Binary file — inspect it with run_bash instead (e.g. `file`, `hexdump`).",
              }
            }
            const startLine = offset ?? 1
            const maxLines = limit ?? 300
            const lines = buffer.toString("utf8").split("\n")
            // A trailing newline splits into one empty piece, not a line.
            const totalLines =
              lines.length > 0 && lines[lines.length - 1] === ""
                ? lines.length - 1
                : lines.length
            const slice = lines.slice(startLine - 1, startLine - 1 + maxLines)
            return {
              content: keepHead(slice.join("\n"), READ_FILE_LIMIT),
              startLine,
              endLine: startLine - 1 + slice.length,
              totalLines,
              truncated: startLine - 1 + maxLines < totalLines,
            }
          })
        } catch (error) {
          return fail(error, `read_file ${path}`)
        }
      },
    }),

    write_file: tool({
      description:
        "Create or fully overwrite a text file in the bot's sandbox (parent directories are created " +
        "automatically). For appending, editing, or renaming, prefer run_bash (`cat >>`, `sed -i`, `mv`).",
      inputSchema: z.object({
        path: z
          .string()
          .min(1)
          .describe(
            "Destination file (absolute, or relative to the sandbox home directory)"
          ),
        content: z.string().describe("The complete new content of the file"),
      }),
      execute: async ({ path, content }) => {
        try {
          return await withSandboxFor(async (sandbox) => {
            const slash = path.lastIndexOf("/")
            if (slash > 0) {
              await sandbox.process.executeCommand(
                `mkdir -p -- ${shellQuote(path.slice(0, slash))}`
              )
            }
            await sandbox.fs.uploadFile(Buffer.from(content, "utf8"), path)
            return { written: true, bytes: Buffer.byteLength(content, "utf8") }
          })
        } catch (error) {
          return fail(error, `write_file ${path}`)
        }
      },
    }),

    list_files: tool({
      description:
        "List files and directories in the bot's sandbox. `depth 1` covers the direct entries of `path`; " +
        "each extra depth reaches one level further down.",
      inputSchema: z.object({
        path: z
          .string()
          .optional()
          .describe("Directory to list (default: the sandbox home directory)"),
        depth: z
          .number()
          .int()
          .min(1)
          .max(4)
          .optional()
          .describe("Levels to include below `path` (default 1)."),
      }),
      execute: async ({ path, depth }) => {
        try {
          return await withSandboxFor(async (sandbox) => {
            const target = path ?? "."
            const files = await sandbox.fs.listFiles(target, {
              depth: depth ?? 1,
            })
            return {
              path: target,
              count: files.length,
              truncated: files.length > MAX_LIST_ENTRIES,
              entries: files.slice(0, MAX_LIST_ENTRIES).map((file) => ({
                name: file.name,
                path: file.path ?? file.name,
                dir: file.isDir,
                bytes: file.size,
              })),
            }
          })
        } catch (error) {
          return fail(error, `list_files ${path ?? "."}`)
        }
      },
    }),

    // ----- Mouse ----------------------------------------------------------
    mouse_click: tool({
      description:
        "Click the mouse at screen coordinates (top-left origin, pixels) in the bot's desktop. " +
        "Supports left/right/middle button and double or repeated clicks.",
      inputSchema: z.object({
        x: z
          .number()
          .int()
          .min(0)
          .describe("X coordinate in pixels (left edge = 0)"),
        y: z
          .number()
          .int()
          .min(0)
          .describe("Y coordinate in pixels (top edge = 0)"),
        button: z
          .enum(["left", "right", "middle"])
          .optional()
          .describe("Button to click (default left)"),
        double: z.boolean().optional().describe("Double-click (default false)"),
        clicks: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe("Number of clicks (e.g. 3 for a triple-click; default 1)"),
      }),
      execute: async ({ x, y, button, double, clicks }) => {
        try {
          return await withSandboxFor(async (sandbox) => {
            await ensureComputerUse(sandbox)
            const res = await sandbox.computerUse.mouse.click(
              x,
              y,
              button,
              double,
              clicks
            )
            return { clicked: true, x: res.x ?? x, y: res.y ?? y }
          })
        } catch (error) {
          return fail(error, `mouse_click ${x},${y}`)
        }
      },
    }),

    mouse_move: tool({
      description:
        "Move the mouse cursor to screen coordinates (top-left origin, pixels).",
      inputSchema: z.object({
        x: z
          .number()
          .int()
          .min(0)
          .describe("X coordinate in pixels (left edge = 0)"),
        y: z
          .number()
          .int()
          .min(0)
          .describe("Y coordinate in pixels (top edge = 0)"),
      }),
      execute: async ({ x, y }) => {
        try {
          return await withSandboxFor(async (sandbox) => {
            await ensureComputerUse(sandbox)
            const res = await sandbox.computerUse.mouse.move(x, y)
            return { moved: true, x: res.x ?? x, y: res.y ?? y }
          })
        } catch (error) {
          return fail(error, `mouse_move ${x},${y}`)
        }
      },
    }),

    mouse_scroll: tool({
      description:
        "Scroll the mouse wheel at screen coordinates (top-left origin, pixels) in a direction.",
      inputSchema: z.object({
        x: z
          .number()
          .int()
          .min(0)
          .describe("X coordinate to scroll at (pixels, left edge = 0)"),
        y: z
          .number()
          .int()
          .min(0)
          .describe("Y coordinate to scroll at (pixels, top edge = 0)"),
        direction: z
          .enum(["up", "down", "left", "right"])
          .describe("Wheel direction"),
        amount: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Wheel ticks (default 1)"),
      }),
      execute: async ({ x, y, direction, amount }) => {
        try {
          return await withSandboxFor(async (sandbox) => {
            await ensureComputerUse(sandbox)
            const scrolled = await sandbox.computerUse.mouse.scroll(
              x,
              y,
              direction,
              amount ?? 1
            )
            return { scrolled: !!scrolled }
          })
        } catch (error) {
          return fail(error, `mouse_scroll ${direction} at ${x},${y}`)
        }
      },
    }),

    // ----- Keyboard -------------------------------------------------------
    keyboard_type: tool({
      description:
        "Type text at wherever the keyboard focus currently is in the bot's desktop.",
      inputSchema: z.object({
        text: z.string().min(1).describe("Text to type"),
        delay: z
          .number()
          .int()
          .min(0)
          .max(500)
          .optional()
          .describe("Milliseconds between characters (default 0)"),
      }),
      execute: async ({ text, delay }) => {
        try {
          return await withSandboxFor(async (sandbox) => {
            await ensureComputerUse(sandbox)
            await sandbox.computerUse.keyboard.type(text, delay)
            return { typed: true, chars: text.length }
          })
        } catch (error) {
          return fail(error, "keyboard_type")
        }
      },
    }),

    keyboard_press: tool({
      description:
        "Press a key (or key combination) in the bot's desktop: letters, digits, 'enter', 'escape', 'tab', " +
        "'space', 'backspace', 'delete', 'insert', 'home', 'end', 'pageup', 'pagedown', 'up'/'down'/'left'/'right' " +
        "arrows, function keys ('f1'–'f12'), unshifted punctuation, with optional 'ctrl'/'alt'/'shift'/'cmd' modifiers.",
      inputSchema: z.object({
        key: z
          .string()
          .min(1)
          .describe("The key to press, e.g. `enter`, `a`, `f5`, `backspace`"),
        modifiers: z
          .array(z.enum(["ctrl", "alt", "shift", "cmd"]))
          .max(4)
          .optional()
          .describe("Modifiers held while pressing, e.g. ['ctrl', 'shift']"),
      }),
      execute: async ({ key, modifiers }) => {
        try {
          return await withSandboxFor(async (sandbox) => {
            await ensureComputerUse(sandbox)
            await sandbox.computerUse.keyboard.press(key, modifiers)
            return { pressed: true, key, modifiers: modifiers ?? [] }
          })
        } catch (error) {
          return fail(error, `keyboard_press ${key}`)
        }
      },
    }),

    // ----- Screen ---------------------------------------------------------
    view_screen: tool({
      description:
        "Look at the bot's desktop screen (the image is shown to you, not the user). Use it to see the " +
        "current app and UI before and after actions — locate windows, buttons, and fields; verify what " +
        "happened. Mouse and keyboard coordinates are measured in this image (top-left origin).",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return await withSandboxFor(async (sandbox) => {
            return { ...(await takeScreenshot(sandbox)) }
          })
        } catch (error) {
          return fail(error, "view_screen")
        }
      },
      // Raw base64 is not a useful model input as a JSON field — hand the
      // model a real image part instead.
      toModelOutput: ({ output }) => {
        if (
          typeof output === "object" &&
          output !== null &&
          "mediaType" in output
        ) {
          const screen = output as {
            data: string
            mediaType: string
            bytes?: number
          }
          return {
            type: "content",
            value: [
              {
                type: "text",
                text: "The bot's current screen, with the cursor. Measure any mouse/keyboard coordinates in this image (top-left origin).",
              },
              {
                type: "file",
                mediaType: screen.mediaType,
                data: { type: "data", data: screen.data },
              },
            ],
          }
        }
        return {
          type: "text",
          value:
            (output as { error?: string }).error ??
            "The screen could not be captured.",
        }
      },
    }),

    show_screen: tool({
      description:
        "Share the bot's desktop with the user: capture the screen and show it as an image in this chat. " +
        "Use it to show progress or results — a finished page, a filled form, a program's UI. " +
        "For your own reasoning use view_screen instead.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return await withSandboxFor(async (sandbox) => {
            const [image, size] = await Promise.all([
              takeScreenshot(sandbox),
              displaySize(sandbox),
            ])
            return { shared: true, ...image, ...size }
          })
        } catch (error) {
          return fail(error, "show_screen")
        }
      },
      // The image belongs on the chat side; the model only needs to know it
      // was shared — do not re-feed the base64 into its context on later turns.
      toModelOutput: ({ output }) => {
        if (
          typeof output === "object" &&
          output !== null &&
          "mediaType" in output
        ) {
          const screen = output as {
            width?: number
            height?: number
            bytes?: number
          }
          const dims =
            screen.width && screen.height
              ? ` (${screen.width}×${screen.height})`
              : ""
          return {
            type: "text",
            value:
              `Shared a screenshot${dims} of the desktop with the user — they can see it in the chat. ` +
              "The image is already in the conversation; do not resend or re-describe it. Continue with the task.",
          }
        }
        return {
          type: "text",
          value:
            (output as { error?: string }).error ??
            "Sharing the screen failed.",
        }
      },
    }),

    // ----- Handing the desktop to the user ---------------------------------
    // A tool without `execute` on purpose: when the model calls it, the turn
    // ends with the call still pending and the ONE who supplies the result is
    // the user — the chat card asks them (Done, or the issue they hit), the
    // answer is supplied client-side (addToolOutput) and resumes the agent as
    // the next turn. Declaring it on the agent (as here, in the set the
    // agent's `tools` returns) is what also gets toModelOutput applied when
    // the SDK re-converts saved history on later turns.
    ...(options.userHandoff === false
      ? {}
      : {
          wait: tool({
            description:
              "Pause and hand the desktop over to the user. " +
              "Call this the moment the task stops at something only the user can do — " +
              "a bot check or CAPTCHA, a login, a payment, or any input you do not have and must not guess. " +
              "Do not loop on a blocked action; call wait once and stop. " +
              "The turn ends at the call: the user works on the desktop themselves, and it resumes with their answer (done, or the issue they hit).",
            inputSchema: z.object({
              reason: z
                .string()
                .min(1)
                .describe(
                  "One clear line telling the user what to do, e.g. 'A bot check appeared — please complete it in the desktop on the right.'"
                ),
            }),
            outputSchema: z.object({
              done: z
                .boolean()
                .describe(
                  "true when the user completed the step; false when they hit an issue"
                ),
              issue: z
                .string()
                .optional()
                .describe(
                  "What the user says is still wrong (present when done is false)"
                ),
            }),
            // Present the raw answer to the model as an instruction — the
            // shape small models follow reliably.
            toModelOutput: ({ output }) => {
              const answer = output as { done?: boolean; issue?: string }
              if (answer?.done) {
                return {
                  type: "text",
                  value:
                    "The user confirms they completed it. Re-check the screen (view_screen) and continue the task from where it left off.",
                }
              }
              return {
                type: "text",
                value:
                  `The user says they could NOT complete it. Their note: ${
                    answer?.issue ?? "(no details given)"
                  }. ` +
                  "Read that carefully and act on it — work around it if you can, otherwise call wait again with the remaining blocker stated plainly.",
              }
            },
          }),
        }),
  }
}
