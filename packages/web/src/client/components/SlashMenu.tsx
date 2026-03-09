// @summary Slash command autocomplete dropdown rendered above the chat input

import { useEffect, useRef } from "react";
import type { SlashCommand, SlashCommandOption } from "../lib/slash-commands";

interface SlashMenuProps {
  /** Filtered commands to display */
  commands: SlashCommand[];
  /** Currently highlighted index */
  selectedIndex: number;
  /** The command whose sub-options are expanded, if any */
  expandedCommand: SlashCommand | null;
  /** Highlighted index within sub-options */
  subSelectedIndex: number;
  /** Called when user clicks a command */
  onSelect: (command: SlashCommand) => void;
  /** Called when user clicks a sub-option */
  onSelectOption: (command: SlashCommand, option: SlashCommandOption) => void;
}

export function SlashMenu({
  commands,
  selectedIndex,
  expandedCommand,
  subSelectedIndex,
  onSelect,
  onSelectOption,
}: SlashMenuProps) {
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
          const isExpanded = expandedCommand?.name === cmd.name;

          return (
            <div key={cmd.name}>
              <button
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
                {cmd.options ? <span className="ml-auto shrink-0 text-[10px] opacity-60">›</span> : null}
              </button>

              {/* Sub-options inline expansion */}
              {isExpanded && cmd.options ? (
                <div className="border-t border-text/5 bg-surface/30 py-1 pl-6">
                  {cmd.options.map((opt, j) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={j === subSelectedIndex}
                      onClick={() => onSelectOption(cmd, opt)}
                      className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs transition ${
                        j === subSelectedIndex
                          ? "bg-accent/15 text-text"
                          : "text-muted hover:bg-surface/80 hover:text-text"
                      }`}
                    >
                      <span className="font-medium">{opt.label}</span>
                      {opt.description ? <span className="text-muted/70">{opt.description}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
