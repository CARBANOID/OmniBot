"use client"

import * as React from "react"

import { PaletteIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"

// The user's background tint: a tone color blended over the app's
// --background. It is written to the `--bg-tint` / `--bg-tint-alpha`
// custom properties on <html>, which globals.css folds into every
// `--background` resolution (page, desktop pane, VNC letterbox) via
// color-mix — so the tint applies in both themes and updates live as the
// slider moves. The choice is persisted to localStorage; the boot script
// in app/layout.tsx re-applies it before first paint, so a reload never
// flashes an untinted background.

const STORAGE_KEY = "omnibot:bg-tint"

interface BgTint {
  // Hex tone color, e.g. "#3b82f6".
  color: string
  // Fraction of the color blended into the background: 0 (untouched) to 1.
  alpha: number
}

// First-open state: a color is preselected, but the tint stays off until
// the user moves the opacity slider.
const DEFAULT_TINT: BgTint = { color: "#3b82f6", alpha: 0 }

const TONES = [
  { name: "Blue", value: "#3b82f6" },
  { name: "Sky", value: "#0ea5e9" },
  { name: "Violet", value: "#8b5cf6" },
  { name: "Rose", value: "#f43f5e" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Emerald", value: "#10b981" },
  { name: "Slate", value: "#64748b" },
]

function loadTint(): BgTint {
  if (typeof window === "undefined") return DEFAULT_TINT
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_TINT
    const saved = JSON.parse(raw) as Partial<BgTint>
    if (typeof saved.color !== "string" || saved.color.length === 0) {
      return DEFAULT_TINT
    }
    if (typeof saved.alpha !== "number") return DEFAULT_TINT
    return {
      color: saved.color,
      alpha: Math.min(1, Math.max(0, saved.alpha)),
    }
  } catch {
    return DEFAULT_TINT
  }
}

function applyTint(tint: BgTint) {
  const root = document.documentElement
  if (tint.alpha > 0) {
    root.style.setProperty("--bg-tint", tint.color)
    root.style.setProperty("--bg-tint-alpha", String(tint.alpha))
  } else {
    root.style.removeProperty("--bg-tint")
    root.style.removeProperty("--bg-tint-alpha")
  }
}

export function ThemeTintDialog({ className }: { className?: string }) {
  // Load the saved tint lazily on first client render. The dialog content
  // is unmounted while closed, so first paint is identical whether or not
  // a tint is stored — no hydration divergence.
  const [tint, setTint] = React.useState<BgTint>(() => loadTint())

  // The document is the external system the tint writes into: apply the
  // current value on mount and after every change (the layout's boot script
  // already painted it before first render, so the mount pass is a no-op).
  React.useEffect(() => {
    applyTint(tint)
  }, [tint])

  const update = (next: BgTint) => {
    setTint(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Storage unavailable (private mode, quota): the tint still applies
      // for this visit.
    }
  }

  // The rainbow disc is the "custom" swatch — selected when the current
  // color is none of the presets.
  const presetSelected = TONES.some((tone) => tone.value === tint.color)

  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="ghost" size="icon" className={className} />}
      >
        <PaletteIcon />
        <span className="sr-only">Adjust the background tint</span>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Background tint</DialogTitle>
          <DialogDescription>
            Blend a tone color over the app background and choose how
            strongly it shows.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Tone color</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {TONES.map(({ name, value }) => {
                const selected = tint.color === value
                return (
                  <button
                    key={value}
                    type="button"
                    aria-label={name}
                    aria-pressed={selected}
                    title={name}
                    onClick={() => update({ ...tint, color: value })}
                    className={cn(
                      "size-7 rounded-full border border-border transition focus-visible:outline-2 focus-visible:outline-ring",
                      selected &&
                        "ring-2 ring-ring ring-offset-2 ring-offset-popover"
                    )}
                    style={{ backgroundColor: value }}
                  />
                )
              })}
              <label
                className={cn(
                  "relative size-7 cursor-pointer overflow-hidden rounded-full border border-border transition focus-within:outline-2 focus-within:outline-ring",
                  !presetSelected &&
                    "ring-2 ring-ring ring-offset-2 ring-offset-popover"
                )}
                title="Custom tone color"
              >
                <span
                  aria-hidden
                  className="absolute inset-0"
                  style={{
                    background:
                      "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
                  }}
                />
                <input
                  type="color"
                  value={tint.color}
                  onChange={(event) =>
                    update({ ...tint, color: event.target.value })
                  }
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                  aria-label="Pick a custom tone color"
                />
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">
              Opacity{" "}
              <span className="font-normal text-muted-foreground tabular-nums">
                {Math.round(tint.alpha * 100)}%
              </span>
            </span>
            <Slider
              aria-label="Tint opacity"
              value={Math.round(tint.alpha * 100)}
              onValueChange={(value) => {
                const next = Array.isArray(value) ? value[0] : value
                if (typeof next === "number") {
                  update({
                    ...tint,
                    alpha: Math.min(1, Math.max(0, next / 100)),
                  })
                }
              }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Result</span>
            <div className="flex items-center gap-2 rounded-lg border border-border p-2">
              {/* The chip must show the CANVAS (tint) — `--background`
                  stays the neutral white surface color on purpose. */}
              <span className="size-8 shrink-0 rounded-md border border-border bg-canvas" />
              <span className="break-words text-xs text-muted-foreground">
                {tint.alpha > 0
                  ? `${tint.color} blended into the background at ${Math.round(tint.alpha * 100)}%`
                  : "Tint is off — the background is untouched."}
              </span>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={tint.alpha === 0}
              onClick={() => update({ ...tint, alpha: 0 })}
            >
              Remove tint
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
