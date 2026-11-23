import { ClerkProvider } from "@clerk/nextjs"
import { shadcn } from "@clerk/ui/themes"
import { Geist, Geist_Mono } from "next/font/google"
import type { Metadata } from "next"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/toast"
import { cn } from "@/lib/utils"

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  // Declare supported schemes in <head> so the browser themes native UI
  // (form controls, autofill, canvas) and avoids an FOUC of un-themed
  // content. The per-theme value lives in globals.css (color-scheme on
  // :root / .dark), tracking the app's class-based theme override.
  colorScheme: "light dark",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        geist.variable
      )}
    >
      <head>
        {/* Re-apply the user's background tint (components/theme-tint-dialog.tsx)
            before first paint — without it, a reload with a saved tint would
            flash the untouched background until the dialog's effect runs. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=JSON.parse(localStorage.getItem("omnibot:bg-tint"));if(!t)return;var r=document.documentElement;if(typeof t.color==="string"&&typeof t.alpha==="number"&&t.alpha>0){r.style.setProperty("--bg-tint",t.color);r.style.setProperty("--bg-tint-alpha",t.alpha)}else{r.style.removeProperty("--bg-tint");r.style.removeProperty("--bg-tint-alpha")}}catch(_){}})();`,
          }}
        />
      </head>
      <body>
        <ClerkProvider appearance={{ theme: shadcn }}>
          <ThemeProvider>
            <TooltipProvider>
              <Toaster>{children}</Toaster>
            </TooltipProvider>
          </ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  )
}
