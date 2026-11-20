import { Spinner } from "@/components/ui/spinner"

// The instant fallback for the whole chat segment: when a new conversation
// is streaming in — switching bots in the sidebar above all — this replaces
// the old bot's UI immediately (prefetched by Next, so it shows without
// waiting for the new page), mirroring the page's own shell so the layout
// slot keeps its size. The conversation then streams in behind the Suspense
// spinner in page.tsx and swaps both.
export default function Loading() {
  return (
    <div className="flex h-svh min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-5" />
      </div>
    </div>
  )
}
