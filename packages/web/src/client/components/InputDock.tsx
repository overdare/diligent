// @summary Input dock with auto-resize textarea, slash command autocomplete, model/effort controls, and usage tray

import type { Mode, ModelInfo, ThinkingEffort, ThreadStatus } from "@diligent/protocol";
import type { ClipboardEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SlashCommand } from "../lib/slash-commands";
import { BUILTIN_COMMANDS, filterCommands, isSlashPrefix } from "../lib/slash-commands";
import type { UsageState } from "../lib/thread-store";
import { Select, type SelectOption } from "./Select";
import { SlashMenu } from "./SlashMenu";
import { TextArea } from "./TextArea";

interface InputDockProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onSteer: () => void;
  onInterrupt: () => void;
  onCompactionClick: () => void;
  canSend: boolean;
  canSteer: boolean;
  threadStatus: ThreadStatus;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  effort: ThinkingEffort;
  onEffortChange: (effort: ThinkingEffort) => void;
  currentModel: string;
  availableModels: ModelInfo[];
  onModelChange: (modelId: string) => void;
  usage: UsageState;
  currentContextTokens: number;
  contextWindow: number;
  hasProvider: boolean;
  onOpenProviders: () => void;
  supportsVision: boolean;
  pendingImages: Array<{ path: string; url: string; fileName?: string }>;
  isUploadingImages: boolean;
  onAddImages: (files: FileList | File[]) => void;
  onRemoveImage: (path: string) => void;
  /** Handler for slash command execution */
  onSlashCommand?: (name: string, arg?: string) => void;
  /** Full list of available slash commands (builtins + skills). Falls back to builtins only. */
  slashCommands?: SlashCommand[];
}

type ComposerMenuKey = "mode" | "compaction";

const SUPPORTED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function extractPastedImageFiles(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) return [];

  const filesFromItems = Array.from(clipboardData.items ?? [])
    .filter((item) => item.kind === "file" && SUPPORTED_IMAGE_MIME_TYPES.has(item.type))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file instanceof File);

  if (filesFromItems.length > 0) {
    return filesFromItems;
  }

  return Array.from(clipboardData.files ?? []).filter((file) => SUPPORTED_IMAGE_MIME_TYPES.has(file.type));
}

const MODE_LABELS: Record<Mode, string> = {
  default: "default",
  plan: "plan",
  execute: "execute",
};

const EFFORT_LABELS: Record<ThinkingEffort, string> = {
  low: "low",
  medium: "medium",
  high: "high",
  max: "max",
};

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatUsageTooltip(usage: UsageState): string {
  return [
    `Input: ${usage.inputTokens.toLocaleString()}`,
    `Output: ${usage.outputTokens.toLocaleString()}`,
    `Cache read: ${usage.cacheReadTokens.toLocaleString()}`,
    `Cache write: ${usage.cacheWriteTokens.toLocaleString()}`,
    `Cost: $${usage.totalCost.toFixed(4)}`,
  ].join("\n");
}

function modelOptions(models: ModelInfo[]): SelectOption[] {
  return models.map((model) => ({
    value: model.id,
    label: model.id,
    group: model.provider,
  }));
}

function modeOptions(): SelectOption[] {
  return (Object.keys(MODE_LABELS) as Mode[]).map((m) => ({
    value: m,
    label: MODE_LABELS[m],
  }));
}

function effortOptions(): SelectOption[] {
  return (Object.keys(EFFORT_LABELS) as ThinkingEffort[]).map((e) => ({
    value: e,
    label: EFFORT_LABELS[e],
  }));
}

export function InputDock({
  input,
  onInputChange,
  onSend,
  onSteer,
  onInterrupt,
  onCompactionClick,
  canSend,
  canSteer,
  threadStatus,
  mode,
  onModeChange,
  effort,
  onEffortChange,
  currentModel,
  availableModels,
  onModelChange,
  usage,
  currentContextTokens,
  contextWindow,
  hasProvider,
  onOpenProviders,
  supportsVision,
  pendingImages,
  isUploadingImages,
  onAddImages,
  onRemoveImage,
  onSlashCommand,
  slashCommands,
}: InputDockProps) {
  const composingRef = useRef(false);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<ComposerMenuKey | null>(null);

  // Slash command autocomplete state
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashFiltered, setSlashFiltered] = useState<SlashCommand[]>([]);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);

  const isBusy = threadStatus === "busy";
  const totalTokens = usage.inputTokens + usage.outputTokens;
  const hasUsage = totalTokens > 0;
  const hasContext = currentContextTokens > 0;
  const contextPct = contextWindow > 0 ? Math.round((currentContextTokens / contextWindow) * 100) : 0;
  const usageLabel = hasContext
    ? `${formatTokenCount(currentContextTokens)} / ${formatTokenCount(contextWindow)} (${contextPct}%) · $${usage.totalCost.toFixed(2)}`
    : hasUsage
      ? `${formatTokenCount(totalTokens)} tokens · $${usage.totalCost.toFixed(2)}`
      : null;

  // Update slash menu when input changes
  const updateSlashMenu = useCallback(
    (value: string) => {
      if (isSlashPrefix(value)) {
        const partial = value.slice(1);
        const filtered = filterCommands(slashCommands ?? BUILTIN_COMMANDS, partial);
        setSlashFiltered(filtered);
        setSlashMenuOpen(filtered.length > 0);
        setSlashSelectedIndex(0);
      } else {
        setSlashMenuOpen(false);
        setSlashFiltered([]);
      }
    },
    [slashCommands],
  );

  const closeSlashMenu = useCallback(() => {
    setSlashMenuOpen(false);
    setSlashFiltered([]);
  }, []);

  const handleSlashSelect = useCallback(
    (cmd: SlashCommand) => {
      closeSlashMenu();
      onInputChange("");
      onSlashCommand?.(cmd.name);
    },
    [onSlashCommand, onInputChange, closeSlashMenu],
  );

  const handleInputChange = useCallback(
    (value: string) => {
      onInputChange(value);
      updateSlashMenu(value);
    },
    [onInputChange, updateSlashMenu],
  );

  const modeMenuOptions = modeOptions();

  useEffect(() => {
    if (!isPlusMenuOpen) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (!plusMenuRef.current) return;
      if (!plusMenuRef.current.contains(event.target as Node)) {
        setIsPlusMenuOpen(false);
        setActiveSubmenu(null);
      }
    };

    window.addEventListener("mousedown", handleMouseDown);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
    };
  }, [isPlusMenuOpen]);

  // Close slash menu on outside click
  useEffect(() => {
    if (!slashMenuOpen) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (slashMenuRef.current?.contains(event.target as Node)) return;
      closeSlashMenu();
    };

    window.addEventListener("mousedown", handleMouseDown);
    return () => window.removeEventListener("mousedown", handleMouseDown);
  }, [slashMenuOpen, closeSlashMenu]);

  const openPlusMenu = () => {
    setIsPlusMenuOpen(true);
    setActiveSubmenu(null);
  };

  const togglePlusMenu = () => {
    if (isPlusMenuOpen) {
      setIsPlusMenuOpen(false);
      setActiveSubmenu(null);
      return;
    }
    openPlusMenu();
  };

  const topLevelMenuItemClass = (menuKey: ComposerMenuKey): string =>
    `flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition ${
      activeSubmenu === menuKey ? "bg-surface text-text shadow-sm" : "text-muted hover:bg-surface/80 hover:text-text"
    }`;

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedImages = extractPastedImageFiles(event.clipboardData);
    if (pastedImages.length === 0) return;

    event.preventDefault();
    if (isUploadingImages) return;
    onAddImages(pastedImages);
  };

  // Handle keyboard events — slash menu navigation takes priority when open
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (composingRef.current || e.nativeEvent.isComposing) return;

    if (slashMenuOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSelectedIndex((prev) => Math.min(prev + 1, slashFiltered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const cmd = slashFiltered[slashSelectedIndex];
        if (cmd) handleSlashSelect(cmd);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const cmd = slashFiltered[slashSelectedIndex];
        if (cmd) {
          onInputChange(`/${cmd.name} `);
          closeSlashMenu();
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeSlashMenu();
        return;
      }
    }

    // Normal key handling
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isBusy) onSteer();
      else if (!isUploadingImages) onSend();
    }
  };

  return (
    <div className="border-t border-text/10 bg-surface/40 px-6 pb-3 pt-3">
      <div
        className={`rounded-3xl border px-3 py-2.5 shadow-panel ${hasProvider ? "border-text/15 bg-bg/60" : "border-danger/20 bg-bg/60"}`}
      >
        {!hasProvider ? (
          <button
            type="button"
            onClick={onOpenProviders}
            className="flex w-full items-center justify-center gap-2 py-2 text-sm text-muted transition hover:text-text"
          >
            <span className="text-danger/70">No provider connected.</span>
            <span className="text-accent underline underline-offset-2">Connect one in the sidebar →</span>
          </button>
        ) : (
          <>
            {pendingImages.length > 0 ? (
              <div className="mb-3 flex flex-wrap gap-2">
                {pendingImages.map((image) => (
                  <div
                    key={image.path}
                    className="group relative overflow-hidden rounded-xl border border-text/10 bg-surface/70"
                  >
                    <img src={image.url} alt={image.fileName ?? "Attached image"} className="h-20 w-20 object-cover" />
                    <button
                      type="button"
                      aria-label={`Remove ${image.fileName ?? "image"}`}
                      onClick={() => onRemoveImage(image.path)}
                      disabled={isUploadingImages}
                      className="absolute right-1 top-1 rounded-full bg-bg/80 px-1.5 py-0.5 text-[10px] text-text opacity-90 transition hover:bg-bg disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {isUploadingImages ? (
                  <div className="flex h-20 min-w-[120px] items-center justify-center rounded-xl border border-dashed border-text/10 bg-surface/40 px-3 text-xs text-muted">
                    Uploading images…
                  </div>
                ) : null}
              </div>
            ) : isUploadingImages ? (
              <div className="mb-3 flex h-20 items-center justify-center rounded-xl border border-dashed border-text/10 bg-surface/40 px-3 text-xs text-muted">
                Uploading images…
              </div>
            ) : null}

            {/* Slash command autocomplete — positioned relative to the textarea area */}
            <div className="relative">
              {slashMenuOpen ? (
                <div ref={slashMenuRef}>
                  <SlashMenu commands={slashFiltered} selectedIndex={slashSelectedIndex} onSelect={handleSlashSelect} />
                </div>
              ) : null}

              <TextArea
                className="min-h-[52px] border-0 bg-transparent px-0 py-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-transparent"
                aria-label={isBusy ? "Steering input" : "Message input"}
                placeholder={
                  isBusy ? "Steer the agent…" : supportsVision ? "Ask anything or attach images…" : "Ask anything…"
                }
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onCompositionStart={() => {
                  composingRef.current = true;
                }}
                onCompositionEnd={() => {
                  composingRef.current = false;
                }}
                onPaste={handlePaste}
                onKeyDown={handleKeyDown}
              />
            </div>
          </>
        )}

        <div className="mt-2.5 flex items-center justify-between gap-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <div ref={plusMenuRef} className="relative shrink-0">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                disabled={isUploadingImages}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    onAddImages(e.target.files);
                    e.target.value = "";
                  }
                }}
              />

              <button
                type="button"
                aria-label="Open composer options"
                aria-haspopup="menu"
                aria-expanded={isPlusMenuOpen}
                onClick={togglePlusMenu}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text/10 ${
                  isPlusMenuOpen
                    ? "border-text/10 bg-surface text-text shadow-sm"
                    : "border-transparent bg-transparent text-muted/80 hover:border-text/10 hover:bg-surface/80 hover:text-text"
                }`}
              >
                +
              </button>

              {isPlusMenuOpen ? (
                <div
                  role="menu"
                  className="absolute bottom-full left-0 z-30 mb-2 min-w-[150px] rounded-xl border border-text/10 bg-bg/95 p-1 shadow-panel backdrop-blur"
                >
                  <div className="relative">
                    <div className="relative">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          fileInputRef.current?.click();
                          setIsPlusMenuOpen(false);
                          setActiveSubmenu(null);
                        }}
                        disabled={!supportsVision || isUploadingImages}
                        className={`block w-full rounded-lg px-2.5 py-2 text-left text-xs transition ${
                          supportsVision && !isUploadingImages
                            ? "text-muted hover:bg-surface/80 hover:text-text"
                            : "cursor-not-allowed text-muted/40"
                        }`}
                      >
                        {isUploadingImages ? "Uploading images…" : "Add images"}
                      </button>

                      <button
                        type="button"
                        role="menuitem"
                        aria-haspopup="menu"
                        aria-expanded={activeSubmenu === "mode"}
                        onMouseEnter={() => setActiveSubmenu("mode")}
                        onFocus={() => setActiveSubmenu("mode")}
                        onClick={() => setActiveSubmenu("mode")}
                        className={topLevelMenuItemClass("mode")}
                      >
                        <span>Mode</span>
                        <span className="text-[10px] opacity-60">›</span>
                      </button>

                      {activeSubmenu === "mode" ? (
                        <div className="absolute left-full top-0 ml-1 min-w-[132px] rounded-xl border border-text/10 bg-bg/95 p-1 shadow-panel backdrop-blur">
                          {modeMenuOptions.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              role="menuitemradio"
                              aria-checked={option.value === mode}
                              onClick={() => {
                                onModeChange(option.value as Mode);
                                setIsPlusMenuOpen(false);
                                setActiveSubmenu(null);
                              }}
                              className={`block w-full rounded-lg px-2.5 py-2 text-left text-xs transition ${
                                option.value === mode
                                  ? "bg-accent/15 text-text shadow-sm"
                                  : "text-muted hover:bg-surface/80 hover:text-text"
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="relative">
                      <button
                        type="button"
                        role="menuitem"
                        aria-haspopup="menu"
                        aria-expanded={activeSubmenu === "compaction"}
                        onMouseEnter={() => setActiveSubmenu("compaction")}
                        onFocus={() => setActiveSubmenu("compaction")}
                        onClick={() => setActiveSubmenu("compaction")}
                        className={topLevelMenuItemClass("compaction")}
                      >
                        <span>Compaction</span>
                        <span className="text-[10px] opacity-60">›</span>
                      </button>

                      {activeSubmenu === "compaction" ? (
                        <div className="absolute left-full top-0 ml-1 min-w-[156px] rounded-xl border border-text/10 bg-bg/95 p-1 shadow-panel backdrop-blur">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              onCompactionClick();
                              setIsPlusMenuOpen(false);
                              setActiveSubmenu(null);
                            }}
                            className="block w-full rounded-lg px-2.5 py-2 text-left text-xs text-muted transition hover:bg-surface/80 hover:text-text"
                          >
                            Compact now
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {availableModels.length > 0 ? (
              <Select
                ariaLabel="Model selector"
                value={currentModel}
                options={modelOptions(availableModels)}
                onChange={onModelChange}
                openDirection="up"
                className="w-[180px]"
              />
            ) : null}

            <Select
              ariaLabel="Effort selector"
              value={effort}
              options={effortOptions()}
              onChange={(value) => onEffortChange(value as ThinkingEffort)}
              openDirection="up"
              className="w-[90px]"
            />
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            {usageLabel ? (
              <span className="shrink-0 cursor-default text-xs text-muted/70" title={formatUsageTooltip(usage)}>
                {usageLabel}
              </span>
            ) : null}

            {isBusy ? (
              <>
                <button
                  type="button"
                  aria-label="Steer agent"
                  onClick={() => {
                    if (!composingRef.current) onSteer();
                  }}
                  disabled={!canSteer}
                  className="rounded-full bg-accent/80 px-3 py-1.5 text-xs font-semibold text-bg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  Steer
                </button>
                <button
                  type="button"
                  aria-label="Interrupt turn"
                  onClick={onInterrupt}
                  className="rounded-md border border-danger/30 bg-danger/10 px-3 py-1 text-xs text-danger transition hover:bg-danger/20"
                >
                  Stop
                </button>
              </>
            ) : (
              <button
                type="button"
                aria-label="Send message"
                onClick={() => {
                  if (!composingRef.current) onSend();
                }}
                disabled={!canSend}
                className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-bg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
              >
                Send
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
