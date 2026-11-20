import Image from "next/image"
import { cn } from "cn"

import { chatAvatarUri } from "@/components/chat-avatar"

export interface GroupChatAvatarProps {
  /** The member bots' face seeds, in join order (the first bot is the chat's default voice). */
  seeds: string[]
  /** Extra classes, e.g. sizing (`h-10 w-10`); 32px is the default. */
  className?: string
}

// The group avatar is a square the exact size of a single chat avatar, tiled
// one of the member bots' faces (up to three) plus — when there are more
// than three — one tile counting the rest. Laid out by member count:
//
//   1                -> one full tile
//   2                -> two equal faces side by side, lightly overlapping
//   3                -> a triangle: two on top, one centered below
//   4 (and more)     -> a 2x2 grid of three faces + one count tile
//
// Positions and sizes are percentages of the square, so any rendered size
// (size-6 in a row, size-14 in the empty state) keeps the same proportions.
// No gaps or seams between tiles: whatever the avatar's surface is behind
// them never shows through.
interface Tile {
  top: number
  left: number
  width: number
  height: number
  // Present on the count tile: how many members are hidden behind it.
  count?: number
}

// Neighbouring tiles touch edge-to-edge: no gutter, so no line of the
// surface behind ever runs between two faces. Right and bottom tiles bleed
// a half percent into their neighbour (clipped by the root's
// overflow-hidden) so a subpixel rounding gap can never show a hairline
// through the face boundary.
const GRID_TILES: Tile[] = [
  { top: 0, left: 0, width: 50, height: 50 },
  { top: 0, left: 50, width: 50.5, height: 50 },
  { top: 50, left: 0, width: 50, height: 50.5 },
  { top: 50, left: 50, width: 50.5, height: 50.5 },
]

// Two complete faces of the SAME size, side by side: the back one (drawn
// first) at the left, the front one over its right edge. The overlap is
// small — about a third of an edge — so both keep a clearly equal shape
// (each bot's center, where its eyes sit, stays visible) and neither face
// is ever covered enough to read as "the smaller one". No seam ring: the
// faces' own solid backgrounds (the style fills its canvas) mark the edge
// of the front over the back.
const STACK_TILES: Tile[] = [
  { top: 22, left: 0, width: 56, height: 56 },
  { top: 22, left: 44, width: 56, height: 56 },
]

const SINGLE_TILE: Tile[] = [{ top: 0, left: 0, width: 100, height: 100 }]

function layout(seeds: string[]): Tile[] {
  const count = seeds.length
  if (count <= 1) return SINGLE_TILE
  if (count === 2) return STACK_TILES
  if (count === 3) {
    // A triangle: the two top tiles of the grid + one below, centered —
    // bottom-bleeding like its grid neighbours.
    return [
      GRID_TILES[0],
      GRID_TILES[1],
      { top: 50, left: 25, width: 50, height: 50.5 },
    ]
  }
  // Four and more: three faces in the 2x2 grid, the fourth tile counting
  // the rest (count - 3), as "show up to 3, the rest as a number".
  return [
    GRID_TILES[0],
    GRID_TILES[1],
    GRID_TILES[2],
    { ...GRID_TILES[3], count: count - 3 },
  ]
}

export function GroupChatAvatar({ seeds, className }: GroupChatAvatarProps) {
  const tiles = layout(seeds)

  return (
    <div
      aria-hidden
      className={cn(
        "[container-type:size] relative shrink-0 overflow-hidden",
        className
      )}
    >
      {tiles.map((tile, i) => {
        // The count tile: a muted square with the hidden members' number.
        // Its text is sized in cqw (1% of the container) so it scales with
        // the avatar at any rendered size.
        if (tile.count != null) {
          return (
            <div
              key={`count-${tile.count}`}
              className="absolute grid place-items-center rounded-[15%] bg-muted"
              style={{
                left: `${tile.left}%`,
                top: `${tile.top}%`,
                width: `${tile.width}%`,
                height: `${tile.height}%`,
              }}
            >
              <span
                className="font-semibold leading-none text-foreground"
                style={{ fontSize: "28cqw" }}
              >
                {tile.count}
              </span>
            </div>
          )
        }

        // A face tile: the square face fits a square tile 1:1; a two-member
        // stack shows each bot complete.
        return (
          <div
            key={`face-${i}`}
            className="absolute"
            style={{
              left: `${tile.left}%`,
              top: `${tile.top}%`,
              width: `${tile.width}%`,
              height: `${tile.height}%`,
            }}
          >
            <Image
              src={chatAvatarUri(seeds[i])}
              alt=""
              width={32}
              height={32}
              // The data URI is an animated SVG; skip the optimizer so it
              // renders as-is (same treatment as ChatAvatar).
              unoptimized
              className="size-full object-cover"
            />
          </div>
        )
      })}
    </div>
  )
}
