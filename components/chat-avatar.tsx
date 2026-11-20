import Image from "next/image"
import { Avatar, Style } from "@dicebear/core"
import gazeDefinition from "@dicebear/styles/gaze.json" with { type: "json" }
import { cn } from "cn"

const gaze = new Style(gazeDefinition)

// A deterministically generated face from the seed, as a data URI. Shared by
// the single (ChatAvatar) and group (GroupChatAvatar) avatars so a bot's face
// looks identical wherever it renders.
export function chatAvatarUri(seed: string, animated = false): string {
  return new Avatar(gaze, {
    seed,
    // The gaze style ships its animation component off by default; the
    // `animation` tag turns it on and lets the seed pick the speed.
    ...(animated ? { tags: ["animation"] } : {}),
  }).toDataUri()
}

export interface ChatAvatarProps {
  /** The seed the avatar is deterministically generated from. */
  seed: string
  /**
   * Plays the gaze style's built-in animation (CSS keyframes that respect
   * prefers-reduced-motion) when true, renders a static face when false or
   * omitted.
   */
  animated?: boolean
  /** Extra classes, e.g. sizing (`h-10 w-10`); 32px is the default. */
  className?: string
}

export function ChatAvatar({ seed, animated, className }: ChatAvatarProps) {
  return (
    <Image
      src={chatAvatarUri(seed, animated)}
      alt={seed}
      width={32}
      height={32}
      // The data URI is a CSS-animated SVG; skip the image optimizer so the
      // browser renders it as-is (animations play, resizing stays lossless).
      unoptimized
      className={cn("shrink-0", className)}
    />
  )
}
