import { readFileSync } from "node:fs"
import { Style, Avatar } from "@dicebear/core"
import gazeDefinition from "@dicebear/styles/gaze.json" with { type: "json" }

const gaze = new Style(gazeDefinition)

const html = readFileSync(process.argv[2], "utf8")
const uris = [...html.matchAll(/src="data:image\/svg\+xml;([^"]*)"/g)].map((m) =>
  m[1]
)
console.log("found", uris.length, "data uris in page")

uris.forEach((u, i) => {
  const svg = decodeURIComponent(u)
  const hasKeyframes = svg.includes("@keyframes")
  // which animation class is activated?
  const active = svg.match(/<g class="(dbga-[a-z]+)"\/>/)
  console.log(
    `img ${i + 1}: keyframes=${hasKeyframes} activeClass=${active?.[1] ?? "none"} len=${svg.length}`
  )
})

// Reference renderings from Node (same seed/options as the preview page)
for (const opt of [false, true]) {
  const svg = new Avatar(gaze, {
    seed: "shobhit",
    animationVariant: opt ? "medium" : "none",
  }).toString()
  console.log(
    `NODE animated=${opt}: keyframes=${svg.includes("@keyframes")} len=${svg.length}`
  )
}
