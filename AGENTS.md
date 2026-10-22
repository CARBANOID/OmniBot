<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

Here is the extracted text from the image:

## Git

* Never create branches, worktrees, or commits automatically. Only do so when the user explicitly asks for that specific action in the current request.

* Leave changes uncommitted in the working tree on the current branch and let the user decide when and how to commit.

## Database

* Only apply schema changes with `drizzle-kit push` (npm run db:push — uses DATABASE_URL_UNPOOLED). Never generate or run migrations: no `drizzle-kit generate`, no `drizzle-kit migrate`, no migration files or artifacts in the repo.

* This is a development project. There is no backward compatibility and the data is worthless. Prefer data loss: never backfill, migrate, or preserve rows, and never spend effort keeping old data working. Every schema change means a clean slate.

## Forms

Every form is the same pipeline: a schema derived from the DB table → a server action → a react-hook-form component. Follow this shape (see `lib/validations/bot.ts` + `actions/bot.ts` + `components/bot-dialog.tsx` as the reference implementation):

* Schemas live in `lib/validations/<entity>.ts`, derived from the drizzle table with drizzle-zod's `createInsertSchema`. Never hand-write a zod schema duplicating column names, nullability, or lengths — it must stay in lockstep with `lib/db/schema.ts`. Use per-column refinements (`createInsertSchema(bots, { name: z.string().min(1).max(50) })`) for UI-facing limits and messages. drizzle-zod 0.8.x requires zod v4.
* The client-facing input schema omits every server-owned column with `.omit(...)`: `id` and `createdAt` (they have defaults), and `userId` (stamped in the server action from the Clerk session via `auth()` — it must never travel with the form).
* Server actions live in `actions/<entity>.ts` with `"use server"`: auth check → `schema.parse(input)` → `db.insert(...)` → `revalidatePath`. Check auth with `auth()` even when the page is `auth.protect()`-guarded — the action is callable directly. Return a typed result (`{ ok: true } | { ok: false; error: string }`); never throw. On unexpected failures, `console.error` the real error and return a safe generic message ("Could not create your bot. Please try again.").
* Form components live in `components/<name>.tsx` with `"use client"`, built only from `@/components/ui/*` primitives (Field, FieldGroup, FieldLabel, FieldError, Input, Textarea, Dialog…) — no third-party form UIs. Use react-hook-form with `zodResolver(sameSchema)` so client and server validate with one schema.
* Pin `@hookform/resolvers` to v5 (5.9.x) — v6 declares `effect@^4.0.0` as a peer dependency and ERESOLVEs against this project's `effect@3`.
* In dialogs with a footer, the submit button renders outside the `<form>`: give the form a stable `id` and point the button at it with `type="submit" form="<id>"`.
* Template/preset buttons fill fields with `setValue(field, value, { shouldValidate: true })` and clear any inline server error.
* Success fires a Base UI toast: `toast.add({ type: "success", title, description })` using the module-level `toast` manager from `@/components/ui/toast` (the Toaster is already mounted in `app/layout.tsx` — don't add another). Errors returned by the action show inline in the dialog, not as toasts.
* Keep UI limits and schema limits identical (e.g. `max(100)` on the job field in both) — the schema is the single source of truth.

## Client code

* Don't assume DOM events carry every property the API promises. Some environments (IME composition, mobile keyboards, certain browsers/extensions) dispatch `keydown` with `event.key === undefined` — the theme hotkey in `components/theme-provider.tsx` crashed on this. Guard before reading: `if (!event.key || ... ) return`.
* Global event listeners (theme hotkeys, keyboard shortcuts) must be inert while the user is typing (check INPUT/TEXTAREA/SELECT/contentEditable on `event.target`) and must never let a missing property take down the page.

## DiceBear

Use DiceBear 10. Documentation: https://www.dicebear.com/llms.txt

There are seven native cores with identical output, not one library with
wrappers. Use the one matching this project's language. Do not reach for the
JavaScript core when the project is written in something else:

    JavaScript  @dicebear/core + @dicebear/styles
    PHP         dicebear/core + dicebear/styles
    Python      dicebear-core + dicebear-styles
    Rust        dicebear-core + dicebear-styles
    Go          github.com/dicebear/dicebear-go/v10 + github.com/dicebear/styles/v10
    Dart        dicebear_core + dicebear_styles
    C#          DiceBear.Core + DiceBear.Styles

Every style page carries a loading snippet for all seven, for example
https://www.dicebear.com/styles/lorelei/index.md

HTTP API: https://api.dicebear.com/10.x/<style>/svg?seed=<seed> The seed is a
query parameter, not a path segment. Options are query parameters too; array
values are separated by commas.

Options named after a component end in Variant: eyesVariant, not eyes. This
holds in all seven cores and in the HTTP API. Look up the options of a style at
https://api.dicebear.com/10.x/<style>/options.json

Write these forms, not the ones on the left. The left column is pre-10 and the
API does not reject it, so an outdated call runs and silently does the wrong
thing:

    avatars.dicebear.com/api/<style>/<seed>.svg  ->  api.dicebear.com/10.x/<style>/svg?seed=<seed>
    api.dicebear.com/9.x/<style>/svg             ->  api.dicebear.com/10.x/<style>/svg
    npm install @dicebear/collection             ->  npm install @dicebear/styles
    npm install @dicebear/lorelei                ->  npm install @dicebear/styles
    createAvatar(lorelei, { seed })              ->  new Avatar(new Style(definition), { seed })
    { eyes: ['variant01'] }                      ->  { eyesVariant: ['variant01'] }
    ?radius=50                                   ->  ?borderRadius=50

Only JavaScript and the HTTP API have a pre-10 form. The other six cores were
released in 2026 and never had one, so any older-looking PHP, Python, Rust, Go,
Dart or C# API attributed to DiceBear is invented rather than outdated.