import { nanoid } from "nanoid"

import { ChatAvatar } from "@/components/chat-avatar"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import Link from "next/link"

export default function NotFound() {
  // Same trick as the dashboard home: a freshly seeded bot face per render,
  // so the 404 stays on-brand (bots get faces) instead of using Next's
  // unthemed default page.
  const seed = nanoid()

  return (
    <Empty className="min-h-svh rounded-none border-none">
      <EmptyHeader>
        <EmptyMedia variant="default">
          <ChatAvatar seed={seed} animated className="size-10" />
        </EmptyMedia>
        <EmptyTitle>404 — this page could not be found</EmptyTitle>
        <EmptyDescription>
          The chat you were looking for doesn&apos;t exist — or hasn&apos;t been
          built yet.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          // Renders an <a>, not a <button> — tell Base UI that's intentional
          // (its nativeButton assertion otherwise console-errors on the 404).
          nativeButton={false}
          render={<Link href="/" />}
        >
          Back to home
        </Button>
      </EmptyContent>
    </Empty>
  )
}
