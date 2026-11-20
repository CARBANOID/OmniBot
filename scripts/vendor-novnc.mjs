// Bundle the @novnc/novnc RFB core into a single browser ESM file the desktop
// pane self-hosts (lib/vendor/rfb.mjs), so we can style noVNC's DOM ourselves
// (most importantly: kill the `.screen` wrapper's overflow scrollbar) instead
// of iframing Daytona's cross-origin noVNC where CSS can't reach it.
//
// Why this exists at all:
//   - The published @novnc/novnc package ships only a CJS `lib/` build (the
//     `core/` ESM source is not published), so it can't be imported directly
//     as browser ESM.
//   - One file (lib/util/browser.js) carries a top-level `await` that is
//     invalid CJS and breaks esbuild's CJS→ESM bundling. That flag only gates
//     the optional WebCodecs H.264 decoder (unused for x11vnc), so we rewrite
//     it to a sync `false` + deferred async set — behaviourally identical.
//   - A top-level `window`/`document` reference means the module must be
//     loaded only client-side; the pane dynamic-imports it inside an effect,
//     which also code-splits it out of the initial client bundle.
//
// esbuild is already present in node_modules (no new dependency).
// Run with: npm run vendor:novnc
import {
  cpSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
} from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const require = createRequire(import.meta.url)
const pkgDir = path.join(root, "node_modules", "@novnc", "novnc")
if (!existsSync(pkgDir)) {
  console.error("node_modules/@novnc/novnc not found — run `npm install` first.")
  process.exit(1)
}
const esbuild = require("esbuild")

// Work on a throwaway copy so node_modules is never touched.
const tmp = path.join(os.tmpdir(), `novnc-vendor_${process.pid}_${Date.now()}`)
rmSync(tmp, { recursive: true, force: true })
cpSync(pkgDir, tmp, { recursive: true })

// Patch the one top-level `await` (invalid in CJS, breaks bundling). The
// value it guards is only the WebCodecs H.264 decode path — irrelevant for a
// classic RFB/x11vnc session — so default it to `false` and upgrade it
// asynchronously when (and only if) the check resolves `true`.
const browserJs = path.join(tmp, "lib", "util", "browser.js")
const before = readFileSync(browserJs, "utf8")
const TLA_LINE =
  "exports.supportsWebCodecsH264Decode = supportsWebCodecsH264Decode = await _checkWebCodecsH264DecodeSupport();"
const PATCH = [
  "exports.supportsWebCodecsH264Decode = supportsWebCodecsH264Decode = false;",
  "_checkWebCodecsH264DecodeSupport().then(function (v) {",
  "  if (typeof v === 'boolean') { supportsWebCodecsH264Decode = v; }",
  "}).catch(function () {});",
].join("\n")
if (before.includes(TLA_LINE)) {
  writeFileSync(browserJs, before.replace(TLA_LINE, PATCH))
} else if (before.includes("if (typeof v === 'boolean')")) {
  // Already patched (idempotent re-run).
} else {
  throw new Error(
    "Could not find the expected top-level await in lib/util/browser.js; " +
      "the @novnc/novnc version may have changed — update this script.",
  )
}

// An entry that re-exports the RFB class directly so the emitted bundle has a
// clean `export default RFB` (no CJS interop wrapper to unwrap at the call
// site).
const entry = path.join(tmp, "vendor-entry.cjs")
writeFileSync(
  entry,
  [
    'const mod = require("./lib/rfb.js");',
    "const RFB = (mod && (mod.default || mod.RFB)) ||",
    "  (typeof mod === 'function' ? mod : null);",
    "if (!RFB) {",
    '  throw new Error("@novnc/novnc: could not resolve the RFB class");',
    "}",
    "module.exports = RFB;",
    "",
  ].join("\n"),
)

const outFile = path.join(root, "lib", "vendor", "rfb.mjs")
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  minify: false,
  sourcemap: false,
  logLevel: "warning",
  outfile: outFile,
})

rmSync(tmp, { recursive: true, force: true })
const bytes = statSync(outFile).size
console.log(
  `Bundled @novnc/novnc RFB core → lib/vendor/rfb.mjs (${(bytes / 1024).toFixed(0)} KB)`,
)
