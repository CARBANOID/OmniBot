"use client"

import { useState } from "react"

import { PromptInputButton } from "@/components/ai-elements/prompt-input"
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { ProviderConfig } from "@/providers/types"

export interface ModelPickerProps {
  // The provider whose models are offered (the selected credential's).
  provider: ProviderConfig
  modelId: string
  onModelChange: (modelId: string) => void
}

/**
 * Footer button that picks the model for the active provider. Renders only
 * when a credential is selected (the parent conditionally mounts it); the
 * label is the current model name. Opens a popover with the model list —
 * no search box; the list scrolls past ~5 models.
 */
export function ModelPicker({
  provider,
  modelId,
  onModelChange,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false)

  const model = provider.models.find((item) => item.id === modelId)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* `group` so the label can brighten on hover (see the span below). */}
      <PopoverTrigger
        render={
          <PromptInputButton variant="ghost" size="sm" className="group" />
        }
      >
        {/* Slightly dim normally, full-foreground on hover — overrides the
            footer addon's muted-foreground and reads as a subtle brighten. */}
        <span className="max-w-40 truncate text-sm text-foreground/85 group-hover:text-foreground">
          {model?.name ?? "Model"}
        </span>
      </PopoverTrigger>
      {/* Left edge of the box lines up with the left edge of the button
          (the model name), rather than centering over it. */}
      <PopoverContent align="start" className="w-60 p-1">
        <Command>
          {/* No search box: ~5 models fit, more scroll into view. */}
          <CommandList className="max-h-44">
            <CommandGroup>
              {provider.models.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.name}
                  onSelect={() => {
                    onModelChange(item.id)
                    setOpen(false)
                  }}
                >
                  {item.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
