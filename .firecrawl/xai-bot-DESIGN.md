# DESIGN.md: x.ai/bot (Grok Bot)

## Source
- URL: https://x.ai/bot
- Capture date: 2026-10-21
- Evidence: Firecrawl scrape `branding,images` (xai-bot-branding.json), live DOM computed styles via Firecrawl browser session (xai-bot-computed.json), raw HTML + `@font-face` rules.

## Design Summary
Minimal, near-monochrome product site: white background, near-black ink, pill-shaped buttons, one heavy sans typeface (x.ai's in-house "xVf") used at every size. Subtle warm-gray surfaces (#EDECEA / ivory) for secondary buttons and cards. No gradients, no shadows on buttons. Tailwind v4 + shadcn/ui tokens.

## Design Tokens

### Colors (live CSS custom properties)
| Role | Token | Value |
|---|---|---|
| Page background | `--background` | `#FFFFFF` (hsl 0 0% 100%) |
| Text / primary / ink | `--foreground` `--primary` | `#0A0A0A` (hsl 0 0% 4%) |
| Muted text (fog) | `--color-theme-text-muted` | `hsl(216 4% 51%) ≈ #7D8187` |
| Border (dove) | `--border` `--color-theme-border` | `hsl(222 19% 86%) ≈ #D5D9E2` |
| Secondary surface (ivory) | `--secondary` `--card` `--color-ivory` | `hsl(40 18% 97%) = #F9F7F6` |
| Secondary button bg | `--color-theme-card-03-hex` | `#EDECEA` (95% ivory + 5% ink) |
| Accent (brand orange) | `--accent` `--color-sunset` | `hsl(22 100% 51.6%) ≈ #FF6208` |
| Accent hover (dawn) | `--accent-hover` | `hsl(37 100% 76%) ≈ #FFD180` |
| Dark hover (primary buttons) | `--accent-hover` (theme) `--primary-hover` | `hsl(221 12% 14%) ≈ #251F28` |
| Dark fg / theme button bg | `--color-theme-fg` `--color-theme-button-bg` | `#252525` |
| Cards | `--color-theme-card-02/04-hex` | `#EBEBEB` / `#E1E1E1` |
| Success | `--success` | `hsl(142 71% 45%) ≈ #28C840` |
| Warning | `--warning` | `hsl(45 93% 47%) ≈ #E9A80C` |
| Error | `--error` | `hsl(0 84% 60%) ≈ #F4514A` |
| Header hairline | `--color-theme-border-02` | `color-mix(in srgb, #252525 10%, transparent)` |
| Focus ring | `--shadow-outline-theme` | `0 0 0 1px color-mix(#252525 10%)` |

Full brand scale also defined: `--color-brand-*-100…700` for gray, red, orange, yellow, green, cyan, blue, violet, magenta, brown (e.g. gray #fafafa→#101010, blue #7fc3ff→#000814).

### Typography (live computed)
- **UI font: `xVf`** — x.ai in-house variable sans (200–800), file `XVF_Variable-s.woff2` + `local("Arial")` fallback (`xVf Fallback`). Used for body, headings, buttons, everything.
- **Mono: `Geist Mono`** variable (100–900), `GeistMono_Variable.woff2` — code/terminal/labels.
- **`Cursor Gothic`** (400) — loaded for special display; **`CursorIcons16`** — 16px icon glyph font.

Type scale (desktop computed):
| Element | Size | Weight | Line height | Letter spacing |
|---|---|---|---|---|
| H1 hero "Meet Grok Bot" | 60px (36 md / 60 lg; `text-4xl→lg:text-6xl`) | 500 | 1.05 | -0.01em (-0.6px) |
| H2 sections | 36px (30 sm; `text-3xl→sm:text-4xl`) | 500 | ~1.11 (40px) | -0.01em |
| Body | 16px | 400 | 24px (1.5) | normal |
| Hero lead (`p`) | 18px (`sm:text-lg`) | 400 | ~29px (1.6) | normal |
| UI label | 13px (`text-[13px]`) | 500 | relaxed | normal |
| Micro / status | 12px (`text-[12px]`) | 400–500 | 16px | -0.15px sometimes |
| Small UI / buttons | 14px (`text-sm`) | 400–500 | 20px | normal |

## Buttons (live computed styles)
All buttons are **pill-shaped (`border-radius: 9999px`)**, **borderless**, **no shadow**, `inline-flex items-center justify-center`, `cursor: pointer`, transitions on `background-color, color` 150–200ms ease, `focus-visible: ring-2 ring-primary/30 ring-offset-2`.

| Variant | bg | text | Size |
|---|---|---|---|
| **Primary** ("Get Premium", "Get started for free") `bg-theme-accent` | `#0A0A0A` | `#FFFFFF` | h 36px (m) / 44px (md+), px 24px, text 14–16px, gap 6px, font-normal(400). Hover → `hsl(221 12% 14%) ≈ #251F28`, 150ms |
| **Secondary** ("Contact sales") `bg-theme-card-03-hex` | `#EDECEA` | `#0A0A0A` | h 36→44px, px 24px (18px sm), text 14px/16px, hover → `bg-theme-fg-10` (10% ink, ≈ #EDEBEB), 200ms ease-out |
| **Secondary small** ("Explore more bots") | `#F1F0EF` (same token, different mix) | `#0A0A0A` | padding 10px 18px, text 14px medium(500), 150ms |
| **Ghost / hero download** pair cells | transparent → hover `white/10` | `#FFFFFF` (on dark pill) | py 8px, pl 16px, text 14px medium, left cell `rounded-l-full` (split-pill with arrow half) |

## Spacing & Layout
- Base unit 4px; radius scale: `--radius` 8px, `--radius-xs` 4px, `--radius-2xs` 2px; cards 12px (branded) / 8px; buttons 9999px.
- Container: `max-w-7xl` (80rem) at xl, `--site-content-width: 64rem`; px-4 → lg:px-6.
- Header: fixed, h-16 (64px), `bg white 85%` + `backdrop-blur 12px`, bottom hairline `border/50`, 200ms transitions.
- Motion: `--ease-out-spring: cubic-bezier(.25, 1, .5, 1)`; default durations 140–200ms.
- Framework: Tailwind v4 + shadcn/ui (`designSystem.framework: tailwind`, `componentLibrary: shadcn`).

## Content & CTA Style
- H1: "Meet **Grok Bot**" (line break between words). H2s: statement sentences ("Message Bots like teammates", "Work with many Bots at once").
- Primary CTA wording: "Download for Linux", "Get started for free"; secondary: "Contact sales".
- Pricing: Premium $30 / Super $100 / Ultra $200 per month.

## Artifacts
- `.firecrawl/xai-bot-branding.json` (Firecrawl branding+images)
- `.firecrawl/xai-bot-computed.json` (live DOM computed styles, @font-face, CSS vars)
- `.firecrawl/xai-bot-screenshot.png` → actually returned markdown render (page content)
- Brand assets: logo SVG (x-mark) `fill #0A0A0A`; og image `https://x.ai/images/news/introducing-grok-bot-og-2.png`
