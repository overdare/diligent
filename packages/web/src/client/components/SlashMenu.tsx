// @summary Slash command autocomplete dropdown rendered above the chat input

import { useEffect, useRef } from "react";
import type { SlashCommand } from "../lib/slash-commands";

interface SlashMenuProps {
  /** Filtered commands to display */
  commands: SlashCommand[];
  /** Currently highlighted index */
  selectedIndex: number;
  /** Called when user clicks a command */
  onSelect: (command: SlashCommand) => void;
}

export function SlashMenu({ commands, selectedIndex, onSelect }: SlashMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // Scroll selected item into view
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedIndex drives scroll-into-view
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (commands.length === 0) return null;

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Slash commands"
      className="absolute bottom-full left-0 z-30 mb-2 w-[280px] overflow-hidden rounded-xl border border-text/10 bg-bg/95 shadow-panel backdrop-blur"
    >
      <div className="max-h-[240px] overflow-y-auto py-1">
        {commands.map((cmd, i) => {
          const isSelected = i === selectedIndex;

          return (
            <button
              key={cmd.name}
              ref={isSelected ? selectedRef : undefined}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => onSelect(cmd)}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left text-xs transition ${
                isSelected ? "bg-accent/15 text-text" : "text-muted hover:bg-surface/80 hover:text-text"
              }`}
            >
              <span className="shrink-0 font-mono font-medium text-text">/{cmd.name}</span>
              <span className="min-w-0 truncate text-muted">{cmd.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
