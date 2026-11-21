"use client"

import { chatAvatarUri } from "@/components/chat-avatar"

// "Rendered" means the chat <header> — the exact component the editor's Save
// changes (its title label and its avatar faces) — has actually re-rendered to
// the saved state and painted it. We gate on that instead of a blind frame
// wait.
//
// The match is EXACT and ORDERED, which is what makes it trustworthy. A
// subset test ("all the new faces are present") fails: removing a member from
// [A, B, C] to [A, B] leaves the new faces already in the old header's srcs,
// so it reads true against the old DOM, before the removed face disappears,
// and the success toast fires ahead of the change. The exact checks below can
// only be satisfied by the DOM carrying the new state — unchanged values are
// already present (no extra wait), changed values must have arrived.

function headers(): HTMLElement[] {
  return Array.from(document.querySelectorAll("header")) as HTMLElement[]
}

// A title span, excluding the avatar's own count tile (which is also a <span>).
function titlePresent(
  header: HTMLElement,
  title: string,
  avatarRoot: Element | null
): boolean {
  return Array.from(header.querySelectorAll("span")).some(
    (el) => !avatarRoot?.contains(el) && el.textContent?.trim() === title
  )
}

// The group avatar renders min(seeds, 3) faces (in join / bot-list order, each
// a non-animated data URI) plus — and only when there are more than three
// members — one count tile showing seeds - 3. Match the face imgs exactly
// (count and order) and, when present, that count tile. The count span lives
// in the avatar root (face img > tile div > root), passed in to scope both
// this check and the title check to the same avatar.
function groupAvatarPresent(
  header: HTMLElement,
  seeds: string[],
  avatarRoot: Element | null
): boolean {
  const faceCount = Math.min(seeds.length, 3)
  const imgs = Array.from(header.querySelectorAll("img"))
  if (imgs.length !== faceCount) return false
  for (let i = 0; i < faceCount; i++) {
    if (imgs[i].getAttribute("src") !== chatAvatarUri(seeds[i])) return false
  }
  if (faceCount === 0) return true
  const countText = avatarRoot?.querySelector("span")?.textContent?.trim()
  if (seeds.length > 3) return countText === String(seeds.length - 3)
  return countText == null
}

// The header has re-rendered to the group's saved name and membership. `seeds`
// is the full membership in join (bot-list) order — the same order the server
// rewrites membership in and the header paints; only the first three (and the
// >3 count) render, so pass the whole list and let the match decide.
export function groupHeaderRendered(name: string, seeds: string[]): boolean {
  for (const header of headers()) {
    const first = header.querySelector("img")
    const avatarRoot = first?.parentElement?.parentElement ?? null
    if (!groupAvatarPresent(header, seeds, avatarRoot)) continue
    if (titlePresent(header, name, avatarRoot)) return true
  }
  return false
}

// The header has re-rendered to the bot's saved name and face: a single
// non-animated face and the bot's title.
export function botHeaderRendered(name: string, seed: string): boolean {
  for (const header of headers()) {
    const img = header.querySelector("img")
    if (!img || img.getAttribute("src") !== chatAvatarUri(seed)) continue
    if (titlePresent(header, name, null)) return true
  }
  return false
}

// The create dialogs add a chat, so their change is the shared sidebar gaining
// a row: the link to it (`a[href^="/chats/"]`) carrying the avatar faces (a
// single face for a bot, the tiled faces for a group) and the name.
function sidebarRowMatches(
  row: HTMLElement,
  name: string,
  seeds: string[]
): boolean {
  const faceCount = Math.min(seeds.length, 3)
  const imgs = Array.from(row.querySelectorAll("img"))
  if (imgs.length !== faceCount) return false
  for (let i = 0; i < faceCount; i++) {
    if (imgs[i].getAttribute("src") !== chatAvatarUri(seeds[i])) return false
  }
  // And the group's count tile, when there is one. Without this, the
  // faces-plus-name match has a subset hole: a pre-existing group with the
  // same name and the same FIRST THREE faces but a larger membership (e.g. an
  // old four-member "X" of [A,B,C,D] against a new three-member "X" of
  // [A,B,C]) already reads true before the new row lands. A bot's face is a
  // bare <img> (no avatar div at all), and a group of three or fewer has no
  // count tile, so the only span in the avatar root — its first div — is the
  // count, which must be exactly right.
  const avatarRoot = row.querySelector("div")
  const countText = avatarRoot?.querySelector("span")?.textContent?.trim()
  if (seeds.length > 3) {
    if (countText !== String(seeds.length - 3)) return false
  } else if (countText != null) {
    return false
  }
  return (
    Array.from(row.querySelectorAll("span")).some(
      (el) => el.textContent?.trim() === name
    ) || false
  )
}

// Satisfied only by the row actually having landed in the DOM — the exact
// faces, in order, and the title. Scoped to the sidebar root (portaled
// dialogs, including the create form's own preview, live outside it).
export function sidebarRowPresent(name: string, seeds: string[]): boolean {
  const sidebar = document.querySelector('[data-sidebar="sidebar"]')
  if (!sidebar) return false
  return Array.from(
    sidebar.querySelectorAll('a[href^="/chats/"]')
  ).some((row) => sidebarRowMatches(row as HTMLElement, name, seeds))
}

// The inverse — used by DELETE, where the change is a row DISAPPEARING.
// Direction-safe: before the fresh state commits, the sidebar still carries
// the deleted row, so this reads FALSE and keeps us holding; only the
// rendered new state (row gone) reads true.
export function sidebarRowGone(name: string, seeds: string[]): boolean {
  return !sidebarRowPresent(name, seeds)
}

// Hold something (a success toast, a dialog close) until `rendered()` is
// true, then straddle a paint so the change is genuinely on screen —
// "rendered" meaning the browser has drawn it, not merely that React
// scheduled it. The check runs frame by frame; a ceiling lets a dropped
// signal degrade to "it committed, report it" instead of holding the UI
// forever.
//
// The ceiling is 10s, not 5s, on purpose: in dev, the re-render this waits
// for can be preceded by an on-demand compile, which routinely exceeds 5s
// right after a server restart or a code change. Closing at 5s is exactly
// the "success before the change" bug this module exists to prevent, so the
// fallback should be rare and loud — when it does fire, a console warning
// names the flow and the wait, which is the first place to look.
export async function awaitRendered(
  rendered: () => boolean,
  label: string,
  ceilingMs = 10000
): Promise<void> {
  if (!rendered()) {
    const started = performance.now()
    let gaveUp = false
    await new Promise<void>((resolve) => {
      const tick = () => {
        if (rendered()) {
          resolve()
          return
        }
        if (performance.now() - started >= ceilingMs) {
          gaveUp = true
          resolve()
          return
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    if (gaveUp) {
      // The change committed on the server but our signal never rendered in
      // time. Report success (it is true) and leave the console evidence so
      // the flow can be chased down instead of looking mysterious.
      console.warn(
        `[render-wait] "${label}" had not rendered within the ` +
          `${ceilingMs}ms ceiling — proceeding as if it had. If the dialog ` +
          `closed before the change appeared, this is why.`
      )
    }
  }
  // The new value is in the DOM (or already was); wait out a frame so it is
  // painted, not just committed.
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}
