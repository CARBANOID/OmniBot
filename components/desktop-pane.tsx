"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { getDesktopPreviewUrl } from "@/actions/desktop"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import type { RFB, RFBDisconnectDetail } from "@/lib/vendor/rfb.mjs"
import { ExpandIcon, RefreshCwIcon, XIcon } from "lucide-react"

// The bot's live desktop: the RFB (VNC) core self-hosted on this page, pointing
// its WebSocket at the Daytona sandbox's websockify (port 6080). Shown in the
// shell's always-mounted right panel.
//
// Why self-host instead of iframing Daytona's noVNC: the iframe is a
// cross-origin document we cannot reach with CSS, so its scrollbars and chrome
// are unstyleable. Hosting the RFB core on our own document (the same version
// Daytona serves — @novnc/novnc) gives us full control: one clean container,
// `overflow: hidden`, the canvas scaled to fit (noVNC's `scaleViewport`), and
// no scrollbar UI at all. The cross-origin WebSocket to Daytona's websockify
// is accepted (no Origin restriction), which is what makes this work.
//
// Layout (per docs/pics/vnc.png): the live preview in a bordered 4:3 box
// pinned to the top — never centered in a full-height area — the bot's name
// beneath it ("<name>'s screen"), and the Refresh / Full screen actions in a
// slim top row. Colors ride the app's light/dark theme via the design tokens
// (background / foreground / muted / border) — nothing is fixed to dark.
//
// The signed URL is minted server-side (actions/desktop.ts) *lazily* — on first
// panel open and on every Refresh — so nothing Daytona-related blocks page
// paint. We use it only for its host: the RFB connects to
// `wss://<host>/websockify`.
//
// The noVNC container node never unmounts: closing the panel only collapses
// its width and full screen only resizes the box it fills — noVNC's Resize
//Observer re-fits the canvas, so the session survives both. No reconnection, no
// flash. Only a manual Refresh establishes a new RFB (on the same container),
// which is the one intentional reconnect. Panel and full screen states share
// one markup path: only classes change.
//
// The RFB bundle is dynamic-imported inside an effect (client-only — it
// references window/document at top level — and it's a large chunk we don't
// want in the initial load). The pane renders before the bundle resolves; the
// overlay hides the (empty) container until the session connects.
//
// Full screen pins *this pane* above the dialog's backdrop via `position:
// fixed`; the (hidden) Base UI Dialog supplies the dismissal lock. `modal={false}`
// is deliberate: the default modal dialog marks everything outside it
// aria-hidden, which would hide the very pane holding the VNC (a flaggable a11y
// violation) and trap its focus. Non-modal lets the pane keep full mouse +
// keyboard (noVNC grabs the keyboard on a click of the canvas — its standard
// "click to type"). The lock then comes from `disablePointerDismissal` plus
// cancelling `escape-key` / `outside-press` / `focus-out` in onOpenChange —
// every one of those close paths routes through the store's setOpen, which
// aborts when the event is cancelled. The only way out is the pane's X button.

// The session's visible state. Drives which overlay (if any) sits over the
// desktop container, and nothing else.
type Phase = "connecting" | "live" | "lost"

export function DesktopPane({
  chatId,
  panelOpen,
  botName,
}: {
  chatId: string
  panelOpen: boolean
  // The bot behind the chat — captioned beneath the preview as in the design.
  // Null for a bot-less chat (there is no desktop anyway; the caption
  // falls back to a generic label).
  botName: string | null
}) {
  // The signed preview URL (port 6080), or the message the last mint failed with.
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // True while a manual Refresh mint is in flight (drives the button spinner).
  const [minting, setMinting] = useState(false)
  // Bumped on every Refresh so the connect effect re-runs (re-establishes the
  // RFB) even if two signed URLs ever resolved to the same host.
  const [session, setSession] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  // Where the live session stands; "connecting" is also the initial state.
  const [phase, setPhase] = useState<Phase>("connecting")

  // The element noVNC appends its `.screen` canvas wrapper into. Kept mounted
  // across panel toggles and full screen (only its size changes) so the RFB
  // session is never torn down by a layout change.
  const containerRef = useRef<HTMLDivElement | null>(null)
  // The live RFB instance, for teardown on unmount / refresh.
  const rfbRef = useRef<RFB | null>(null)
  // Guards the lazy first mint so a quick close/reopen while the first mint is
  // in flight doesn't fire a second one.
  const mintInFlightRef = useRef(false)
  // The pending "refreshing" toast of the manual Refresh it belongs to: its
  // id, tagged with the session generation it was promised for. The Refresh's
  // visible change — the NEW session's stream, live — doesn't exist until
  // that session's RFB `connect` event lands (lifting the "Starting…"
  // overlay), so the toast stays a loading sign until then and flips to
  // success only after that lands on screen. The same session's drop, a
  // credentials demand, or its teardown (unmount / a newer Refresh) clears
  // it instead — whichever actually happens. The tag is what lets a newer
  // Refresh's toast survive the older session's teardown events, while a
  // stale toast can never outlive its session.
  const refreshToastRef = useRef<{ id: string; session: number } | null>(null)

  // Flip the pending toast to success — for that session only. The connect
  // event that called this has lifted the "Starting…" overlay; straddle a
  // paint so the desktop is genuinely on screen before the success shows.
  const completeRefreshToast = useCallback((sessionNumber: number) => {
    const pending = refreshToastRef.current
    if (!pending || pending.session !== sessionNumber) return
    refreshToastRef.current = null
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        toast.update(pending.id, {
          type: "success",
          title: "Desktop refreshed",
          description: "Reconnected to a fresh sandbox session.",
          timeout: 4000,
        })
      })
    )
  }, [])

  // A session failed or was torn down: its pending toast can never complete,
  // so close it (the inline "lost" state / error toast already carries the
  // real news). Again, for that session only.
  const clearRefreshToast = useCallback((sessionNumber: number) => {
    const pending = refreshToastRef.current
    if (!pending || pending.session !== sessionNumber) return
    refreshToastRef.current = null
    toast.close(pending.id)
  }, [])

  // The RFB WebSocket target, from the minted base URL: same host (which
  // carries the signed token), the noVNC websockify path, over TLS.
  const wsUrl = useMemo(() => {
    if (!url) return null
    try {
      return `wss://${new URL(url).host}/websockify`
    } catch {
      return null
    }
  }, [url])

  // Mint lazily on first panel open (never on page paint). A failed first
  // load shows inline with a retry; re-opening while `error` is set doesn't
  // re-fire the mint. State updates land in the promise callback, not the
  // effect body — the "subscribe to an external system, update from its
  // result" shape the lint rule expects.
  useEffect(() => {
    if (!panelOpen || url || error || mintInFlightRef.current) return
    mintInFlightRef.current = true
    let cancelled = false
    getDesktopPreviewUrl(chatId)
      .then((result) => {
        mintInFlightRef.current = false
        if (cancelled) return
        if (result.ok) {
          setPhase("connecting")
          setUrl(result.url)
        } else {
          setError(result.error)
        }
      })
      .catch(() => {
        mintInFlightRef.current = false
        if (cancelled) return
        setError("Could not open the desktop. Please try again.")
      })
    return () => {
      cancelled = true
    }
  }, [panelOpen, url, error, chatId])

  // Manual Refresh: re-mint a signed host and re-establish the RFB against it.
  const refresh = useCallback(async () => {
    if (minting || mintInFlightRef.current) return
    setMinting(true)
    setError(null)
    const result = await getDesktopPreviewUrl(chatId)
    setMinting(false)
    if (!result.ok) {
      // First load: show it inline (there is nothing else on screen). Refresh:
      // the current desktop is still live behind the error, so surface it as a
      // toast instead of covering the VNC.
      if (url) {
        toast.add({
          type: "error",
          title: "Couldn't refresh the desktop",
          description: result.error,
        })
      } else {
        setError(result.error)
      }
      return
    }
    const firstLoad = url === null
    setPhase("connecting")
    setUrl(result.url)
    const nextSession = session + 1
    setSession(nextSession)
    if (!firstLoad) {
      // A pending "refreshing" toast can still be out there for the session
      // we are about to tear down — settle it here rather than letting its
      // teardown clear a toast we're about to replace.
      if (refreshToastRef.current) {
        toast.close(refreshToastRef.current.id)
        refreshToastRef.current = null
      }
      // Then promise the new one: its session's own connect event is what
      // will flip it (completeRefreshToast), so no success claim outlives
      // the moment the desktop is actually live again.
      const pending = toast.add({
        type: "loading",
        title: "Refreshing the desktop",
        description: "Reconnecting to a fresh sandbox session…",
        timeout: 0,
      })
      refreshToastRef.current = { id: pending, session: nextSession }
    }
  }, [chatId, minting, session, url])

  // (Re)establish the self-hosted RFB session against `wsUrl`, reusing the
  // persistent container. Runs client-side only (the bundle is dynamic-imported
  // here, so its top-level window/document references never touch the server).
  // Re-runs when the host changes (Refresh) or on unmount, where the previous
  // session is torn down.
  useEffect(() => {
    if (!wsUrl) return

    let tornDown = false
    let instance: RFB | null = null

    // Establish in a task so the (dynamic) bundle load never blocks paint.
    const run = async () => {
      const { default: RFB } = await import("@/lib/vendor/rfb.mjs")
      if (tornDown) return
      const container = containerRef.current
      if (!container) return

      // Clear any previous session's `.screen` wrapper: noVNC leaves it in
      // place on disconnect, so a stale one would otherwise stack.
      container.replaceChildren()

      const rfb = new RFB(container, wsUrl, { shared: true })
      instance = rfb
      rfbRef.current = rfb
      // The core constructor only reads `shared`; background/scale/clip are
      // properties, and setting them is what engages fit-to-container scaling.
      // `background` is noVNC's `.screen` wrapper's inline style — the
      // letterbox around a scaled canvas (the fullscreen strips) — and noVNC
      // assigns the string verbatim (`this._screen.style.background = cssValue`).
      // Pass the token as a CSS variable, not a resolved color: variables are
      // re-resolved on every paint, so a theme flip (the `.dark` class the
      // provider puts on <html>) updates the letterbox live with no listener.
      // A getComputedStyle snapshot of the connect-time value would stay stale.
      // The [data-vnc-root] rule in globals.css enforces the same value via
      // !important, so even a session whose inline write predates the CSS
      // (or noVNC's rgb(40,40,40) default) still follows the current theme.
      rfb.background = "var(--background)"
      rfb.scaleViewport = true
      rfb.clipViewport = false

      // noVNC builds its `.screen` wrapper (the container's single child div)
      // with an inline `overflow: auto`. Force off so the box can never show a
      // scrollbar — not transiently, during a resize, ever.
      const screen = container.querySelector(":scope > div")
      if (screen) (screen as HTMLElement).style.overflow = "hidden"

      rfb.addEventListener("connect", () => {
        if (tornDown) return
        setPhase("live")
        completeRefreshToast(session)
      })
      rfb.addEventListener("disconnect", (e) => {
        if (tornDown) return
        // We tore it down (refresh/unmount) vs. it dropped. Either way it's
        // gone from the user's view, so fall back to the "lost" state.
        const detail = (e as CustomEvent<RFBDisconnectDetail>).detail
        void detail
        clearRefreshToast(session)
        setPhase("lost")
      })
      rfb.addEventListener("credentialsrequired", () => {
        if (tornDown) return
        // Daytona's VNC is NoAuth behind the signed proxy; if it ever asks for
        // a password we can't have, fail loudly instead of hanging.
        clearRefreshToast(session)
        setPhase("lost")
        toast.add({
          type: "error",
          title: "The desktop needs a password we don't have",
          description: "Refresh the desktop to reconnect.",
        })
      })
    }
    void run()

    return () => {
      tornDown = true
      // Teardown (a refresh or unmount): this session's pending toast, if
      // one is still ours, can never complete — settle it here.
      clearRefreshToast(session)
      if (instance) {
        instance.disconnect()
        if (rfbRef.current === instance) rfbRef.current = null
      }
    }
  }, [wsUrl, session, clearRefreshToast, completeRefreshToast])

  // The caption under the preview, verbatim of the design ("Quill's screen").
  const screenLabel = botName ? `${botName}'s screen` : "Bot screen"

  // An overlay over the (empty or dropped) desktop while we have a host to
  // connect to but the session isn't live. No overlay — and therefore full
  // mouse + keyboard on the canvas — once `live`.
  const showOverlay = !error && !!url && phase !== "live"

  return (
    <>
      <section
        aria-label={screenLabel}
        className={cn(
          "flex h-full min-w-0 flex-col overflow-hidden bg-background",
          // Full screen: pin above the dialog's backdrop, cover the viewport.
          fullscreen && "fixed inset-0 z-[60]"
        )}
      >
        {/* Actions: Refresh sits rightmost, as in the design. Full screen
            shows X in place of the expand control. Ghost buttons pick up the
            app theme — no fixed light-on-dark overrides. */}
        <div className="flex shrink-0 items-center justify-end gap-1 p-2">
          {fullscreen ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Exit full screen"
              title="Exit full screen"
              disabled={!url}
              onClick={() => setFullscreen(false)}
            >
              <XIcon className="size-4" />
              <span className="sr-only">Exit full screen</span>
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Open the desktop in full screen"
              title="Open the desktop in full screen"
              disabled={!url}
              onClick={() => setFullscreen(true)}
            >
              <ExpandIcon className="size-4" />
              <span className="sr-only">Open the desktop in full screen</span>
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh the desktop"
            title="Refresh the desktop"
            disabled={minting}
            onClick={() => void refresh()}
          >
            <RefreshCwIcon
              className={cn("size-4", minting && "animate-spin")}
            />
            <span className="sr-only">Refresh the desktop</span>
          </Button>
        </div>

        {/* The preview lives in one box in both modes — only its sizing
            changes (pinned 4:3 box in the panel, flex-1 in full screen) — so
            the container and its RFB session are never remounted by a layout
            change. */}
        {/* In panel mode the box fills whatever vertical space the panel offers:
            it keeps its 4:3 height while the panel is narrow, then flex clamps
            the height to the panel's available room instead of a viewport-size
            cap, so dragging the panel resizes the preview in both dimensions.
            (In a column flex, the aspect-derived height is a preferred size the
            item is free to shrink.) */}
        <div
          className={cn(
            "flex min-h-0 flex-col",
            fullscreen ? "flex-1" : "min-h-0 flex-1 px-3"
          )}
        >
          <div
            className={cn(
              "relative w-full overflow-hidden rounded-md border border-border bg-muted",
              // noVNC's `scaleViewport` fits the sandbox screen inside this box;
              // a 4:3 box matches the sandbox's native aspect, so the screen
              // lands edge-to-edge (top-aligned, not letterboxed mid-panel).
              // `min-h-0` lets it shrink inside the clamping wrapper above.
              fullscreen ? "min-h-0 flex-1" : "aspect-[4/3] min-h-0"
            )}
          >
            {error ? (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="max-w-xs text-sm text-muted-foreground">
                  {error}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void refresh()}
                >
                  Try again
                </Button>
              </div>
            ) : (
              <>
                {/* The RFB mounts into this. `absolute inset-0` fills the box;
                    noVNC's `.screen` (width/height 100%) fills this, and its
                    canvas is scaled to fit by `scaleViewport`.
                    `data-vnc-root` scopes the globals.css rule that themes the
                    `.screen` letterbox live — see it there. */}
                <div
                  ref={containerRef}
                  data-vnc-root
                  aria-hidden={phase !== "live"}
                  className="absolute inset-0"
                />
                {showOverlay && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background p-6 text-center">
                    {phase === "lost" ? (
                      <>
                        <p className="max-w-xs text-sm text-muted-foreground">
                          The desktop connection was lost.
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void refresh()}
                        >
                          Reconnect
                        </Button>
                      </>
                    ) : (
                      <>
                        <Spinner className="size-5" />
                        <p className="text-sm text-muted-foreground">
                          Starting the desktop…
                        </p>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          {/* The design's caption under the preview. Panel mode only — full
              screen is the whole desktop, with nothing to label. */}
          {!fullscreen && (
            <p className="shrink-0 py-2.5 text-center text-xs text-muted-foreground">
              {screenLabel}
            </p>
          )}
        </div>
      </section>

      {/* The full-screen lock. Its content is hidden — the pane above is the
          actual view; the dialog only supplies the dismissal lock and the
          backdrop (Escape/outside-press listeners live on the document, so a
          hidden popup doesn't disarm them). `modal={false}` keeps the pane out
          of the dialog's aria-hidden set and frees it from the focus trap, so
          the VNC keeps mouse + keyboard. Escape, outside press, and focus-out
          are all cancelled — the only way out is the pane's X button, which
          flips `fullscreen` directly. */}
      <Dialog
        open={fullscreen}
        modal={false}
        disablePointerDismissal
        onOpenChange={(open, eventDetails) => {
          if (open) return
          const reason = eventDetails.reason
          if (
            reason === "escape-key" ||
            reason === "outside-press" ||
            reason === "focus-out"
          ) {
            eventDetails.cancel()
            return
          }
          setFullscreen(false)
        }}
      >
        <DialogContent
          showCloseButton={false}
          initialFocus={false}
          className="hidden"
        >
          <DialogTitle>Bot desktop</DialogTitle>
          <DialogDescription>
            Full screen view of the bot desktop.
          </DialogDescription>
        </DialogContent>
      </Dialog>
    </>
  )
}
