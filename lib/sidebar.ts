// Shared sidebar constants. This is a plain (server + client) module.
//
// Important: these values must NOT be imported from components/ui/sidebar.tsx
// (a "use client" module) inside a Server Component — there they arrive as
// opaque client references, and `cookies().get()` silently returns undefined.
// Import them from here instead.
export const SIDEBAR_COOKIE_NAME = "sidebar_state"
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
