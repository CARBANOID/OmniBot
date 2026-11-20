"use client"

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { PanelImperativeHandle } from "react-resizable-panels"

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { DesktopPane } from "@/components/desktop-pane"

interface ChatShellContextValue {
  // Whether the right-hand (desktop) panel is currently expanded.
  panelOpen: boolean
  // Expand or collapse the panel.
  togglePanel: () => void
}

const ChatShellContext = createContext<ChatShellContextValue | null>(null)

// A stable no-op, for the inert panel context a group chat offers (one that
// has no desktop panel at all, so the toggle can be a permanent do-nothing).
const NOOP = () => {}

export function useChatShell(): ChatShellContextValue {
  const ctx = useContext(ChatShellContext)
  if (ctx === null) {
    throw new Error("useChatShell must be used within a <ChatShell>.")
  }
  return ctx
}

// The chat page shell: one horizontal ResizablePanelGroup. The left panel is
// the chat itself (header + conversation, passed as children by the page);
// the right panel hosts the bot's live desktop (DesktopPane).
//
// The right panel is *always mounted*: the desktop lives in an iframe and a
// reconnection would drop the VNC session, so the header's Desktop button
// collapses it to zero width (v4's `collapsible` panel + imperative
// `panelRef` API) instead of unmounting it. The panel therefore never
// conditionally appears — only its width comes and goes.
export function ChatShell({
  chatId,
  botName,
  // False for group chats (several bots, no single one to run a desktop for):
  // the right panel simply doesn't exist, and the panel state is inert — the
  // child header just doesn't offer the button.
  desktop = true,
  children,
}: {
  chatId: string
  // The chat's bot, for the desktop pane's caption ("<name>'s screen").
  // Null when the chat has no bot (and hence no desktop).
  botName?: string | null
  desktop?: boolean
  children: ReactNode
}) {
  const [panelOpen, setPanelOpen] = useState(false)
  const rightPanelRef = useRef<PanelImperativeHandle | null>(null)
  // expand() restores the panel's last expanded size, falling back to
  // minSize. Nudge the very first expand to a comfortable default.
  const firstOpenRef = useRef(true)

  const togglePanel = useCallback(() => {
    const panel = rightPanelRef.current
    if (!panel) return
    if (panel.isCollapsed()) {
      panel.expand()
      if (firstOpenRef.current) {
        firstOpenRef.current = false
        panel.resize(320)
      }
      setPanelOpen(true)
    } else {
      panel.collapse()
      setPanelOpen(false)
    }
  }, [])

  // Group chats render the chat column standalone — no desktop pane, no
  // handle — but the header still reads the panel context, which must
  // therefore exist (inert).
  if (!desktop) {
    return (
      <ChatShellContext.Provider
        value={{ panelOpen: false, togglePanel: NOOP }}
      >
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </ChatShellContext.Provider>
    )
  }

  return (
    <ChatShellContext.Provider value={{ panelOpen, togglePanel }}>
      <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
        <ResizablePanel
          className="flex min-w-0 flex-col overflow-hidden"
          minSize="25%"
        >
          {children}
        </ResizablePanel>
        <ResizableHandle withHandle />
        {/* Kept mounted at all times: it collapses to zero width rather than
            unmounting, so the desktop iframe inside never unloads and its
            VNC session survives panel toggles and full screen alike.
            Pixel sizes so the server-rendered width matches the client's
            (v4 percentages can shift during SSR). */}
        <ResizablePanel
          panelRef={rightPanelRef}
          className="flex min-w-0 flex-col overflow-hidden"
          collapsible
          collapsedSize={0}
          defaultSize={0}
          minSize={240}
        >
          <DesktopPane
            chatId={chatId}
            panelOpen={panelOpen}
            botName={botName ?? null}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </ChatShellContext.Provider>
  )
}
