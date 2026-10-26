import { cn } from "@/lib/utils"
import type { ProviderConfig } from "@/providers/types"

/**
 * Renders a provider's brand logo (public/logos/*.svg — the path lives in
 * providers/*.ts) as a fixed-size inline image.
 *
 * Per-provider class overrides for logos whose artwork needs adjusting for
 * the theme: the ChatGPT mark is solid white, so on a light UI it is
 * invisible — invert it to black there and keep it untouched in dark mode
 * (the theme is the class-based `dark` variant, see app/globals.css).
 */
const logoClassByProvider: Record<string, string> = {
  openai: "invert dark:invert-0",
}

export function ProviderIcon({
  provider,
  className,
}: {
  provider: ProviderConfig
  className?: string
}) {
  return (
    <img
      src={provider.icon}
      alt=""
      aria-hidden
      draggable={false}
      className={cn(
        "size-4 shrink-0 select-none",
        logoClassByProvider[provider.id],
        className
      )}
    />
  )
}
