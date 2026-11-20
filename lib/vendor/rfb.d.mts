// Type declarations for the vendored noVNC RFB core bundle (./rfb.mjs), built by
// scripts/vendor-novnc.mjs. @novnc/novnc ships only untyped CJS, so this
// declares by hand the minimal surface the desktop pane actually uses. Keep the
// two in sync.
//
// The default export is the RFB *constructor*; instantiating it yields an `RFB`
// (the session instance). The instance mixes in EventTarget — the pane listens
// for `connect` / `disconnect` on it.

export interface RFBOptions {
  /**
   * Keep the session alive after this client disconnects (default true). We
   * always refresh with a fresh instance, so the default is what we want.
   */
  shared?: boolean
  /** Credentials sent if the server requests them (we expect none — NoAuth). */
  credentials?: Record<string, string>
  /** Subprotocol(s) for the WebSocket upgrade. */
  wsProtocols?: string[]
  /** Repeater identifier (unused here). */
  repeaterID?: string
}

export interface RFBDisconnectDetail {
  /** True when the disconnect was clean (we asked for it or it closed orderly). */
  clean: boolean
  /** Provider detail, when present. */
  reason?: string
}

/** A live RFB session — one noVNC core instance bound to a container element. */
export interface RFB extends EventTarget {
  /** CSS background painted by the `.screen` wrapper (letterbox fill). */
  background: string
  /** Fit the remote framebuffer inside the container (letterboxed). */
  scaleViewport: boolean
  /** Clip the framebuffer to the container edges. */
  clipViewport: boolean
  /** Ask the server to resize its session to the container. */
  resizeSession: boolean
  /** View-only (no keyboard/mouse sent). */
  viewOnly: boolean
  /** Focus the canvas (and thus grab the keyboard) on a click/tap. */
  focusOnClick: boolean
  focus(options?: FocusOptions): void
  blur(): void
  /** Begin a disconnect. Safe to call more than once. */
  disconnect(): void
}

/** Signature of the RFB constructor (the bundle's default export). */
export interface RFBConstructor {
  new (target: HTMLElement, url: string, options?: RFBOptions): RFB
}

declare const RFB: RFBConstructor

export default RFB
