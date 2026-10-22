import { ChatAvatar } from "@/components/chat-avatar"

export default function ChatAvatarPreview() {
  return (
    <main className="flex min-h-svh flex-col items-start gap-8 bg-white p-8 text-sm text-black">
      <h1 className="text-xl font-semibold">ChatAvatar preview (temp)</h1>
      <div className="flex items-center gap-4">
        <span className="w-40">default (32px)</span>
        <ChatAvatar seed="shobhit" />
      </div>
      <div className="flex items-center gap-4">
        <span className="w-40">56px via className</span>
        <ChatAvatar seed="shobhit" className="h-14 w-14" />
      </div>
      <div className="flex items-center gap-4">
        <span className="w-40">56px animated</span>
        <ChatAvatar seed="shobhit" animated className="h-14 w-14" />
      </div>
      <div className="flex items-center gap-4">
        <span className="w-40">different seed</span>
        <ChatAvatar seed="alice" className="h-14 w-14" />
      </div>
    </main>
  )
}
