/**
 * Horizontal center (px from the viewport's left edge) of the content
 * column that sits right of the sidebar.
 *
 * Dialog content is portaled to <body> and centered against the VIEWPORT by
 * class (`left-1/2 -translate-x-1/2`), but the page content — and the empty-
 * state hero (avatar, name, role) centered in it — only occupies the column
 * right of the sidebar. Returning that column's true center lets a dialog
 * override its `left` so it lines up vertically with the content behind it.
 *
 * Returns null on mobile, where the sidebar is `hidden` (zero-width rect)
 * and the viewport center already IS the content center — the dialog's
 * default centering then simply applies.
 */
export function contentColumnCenter(): number | null {
  const sidebar = document.querySelector<HTMLElement>("[data-slot='sidebar']")
  const rect = sidebar?.getBoundingClientRect()
  if (!rect || rect.width === 0) return null
  return (rect.right + window.innerWidth) / 2
}
