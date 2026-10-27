// Shared constants for the chat selection cookies: the active credential's
// id and the picked model's id. This is a plain (server + client) module,
// like lib/sidebar.ts.
//
// Important: these values must NOT be imported from a "use client" module
// inside a Server Component — there they arrive as opaque client references,
// and `cookies().get()` silently returns undefined. Import them from here.
export const CREDENTIAL_COOKIE_NAME = "selected_credential"
export const CREDENTIAL_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
export const MODEL_COOKIE_NAME = "selected_model"
export const MODEL_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
