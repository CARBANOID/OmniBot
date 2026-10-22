import { cookies } from "next/headers"

import { SIDEBAR_COOKIE_NAME } from "@/lib/sidebar"
import { SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { getUserChats } from "@/queries/bots"

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Server-rendered once per request; the client sidebar just paints it.
  const chats = await getUserChats()

  // Paint the sidebar in its saved state from the first byte of HTML. Reading
  // the cookie client-side (SidebarProvider does this too) is too late: the
  // browser paints the server-rendered "expanded" state first, and the
  // client-side correction is what causes the open-then-collapse flash.
  const cookieStore = await cookies()
  const saved = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value

  return (
    <SidebarProvider defaultOpen={saved !== "false"}>
      <AppSidebar chats={chats} />
      {children}
    </SidebarProvider>
  )
}
