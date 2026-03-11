// @summary Static render tests for core UI components and accessibility attributes
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { normalizeImageFileName } from "../src/client/App";
import { Button } from "../src/client/components/Button";
import { ContextMessage } from "../src/client/components/ContextMessage";
import { Input } from "../src/client/components/Input";
import { extractPastedImageFiles, InputDock } from "../src/client/components/InputDock";
import { KnowledgeManagerModal } from "../src/client/components/KnowledgeManagerModal";
import { Modal } from "../src/client/components/Modal";
import { SlashMenu } from "../src/client/components/SlashMenu";
import { ToolBlock } from "../src/client/components/ToolBlock";
import { ToolSettingsModal } from "../src/client/components/ToolSettingsModal";
import { UserMessage } from "../src/client/components/UserMessage";

function createClipboardFile(name: string, type: string): File {
  return new File([`${name}:${type}`], name, { type });
}

function createClipboardData(options: {
  items?: Array<{ kind: string; type: string; file?: File | null }>;
  files?: File[];
}): DataTransfer {
  return {
    items: (options.items ?? []).map((item) => ({
      kind: item.kind,
      type: item.type,
      getAsFile: () => item.file ?? null,
    })),
    files: options.files ?? [],
  } as unknown as DataTransfer;
}

test("button renders aria-label and intent class", () => {
  const html = renderToStaticMarkup(
    <Button intent="danger" aria-label="Delete action">
      Delete
    </Button>,
  );

  expect(html).toContain("Delete action");
  expect(html).toContain("bg-danger");
});

test("input renders accessibility label", () => {
  const html = renderToStaticMarkup(<Input aria-label="Message input" placeholder="Type" />);
  expect(html).toContain("Message input");
  expect(html).toContain('placeholder="Type"');
});

test("modal renders dialog role", () => {
  const html = renderToStaticMarkup(
    <Modal title="Approval required" description="test">
      <div>Body</div>
    </Modal>,
  );

  expect(html).toContain('role="dialog"');
  expect(html).toContain("Approval required");
});

test("tool settings modal renders tool and plugin rows", () => {
  const html = renderToStaticMarkup(
    <ToolSettingsModal
      threadId="thread-1"
      initialState={{
        configPath: "/repo/.diligent/config.jsonc",
        appliesOnNextTurn: true,
        trustMode: "full_trust",
        conflictPolicy: "error",
        tools: [
          {
            name: "bash",
            source: "builtin",
            enabled: true,
            immutable: false,
            configurable: true,
            available: true,
            reason: "enabled",
          },
          {
            name: "plan",
            source: "builtin",
            enabled: true,
            immutable: true,
            configurable: false,
            available: true,
            reason: "immutable_forced_on",
          },
          {
            name: "jira_comment",
            source: "plugin",
            pluginPackage: "@acme/diligent-tools",
            enabled: false,
            immutable: false,
            configurable: true,
            available: true,
            reason: "disabled_by_user",
          },
        ],
        plugins: [
          {
            package: "@acme/diligent-tools",
            configured: true,
            enabled: true,
            loaded: true,
            toolCount: 1,
            warnings: [],
          },
        ],
      }}
      onList={async () => {
        throw new Error("unused");
      }}
      onSave={async () => {
        throw new Error("unused");
      }}
      onClose={() => {}}
    />,
  );

  expect(html).toContain("Built-in tools");
  expect(html).toContain("bash");
  expect(html).toContain("Locked");
  expect(html).toContain("@acme/diligent-tools");
  expect(html).toContain("jira_comment");
});

test("knowledge manager modal renders inline overlay controls and filter UI", () => {
  const html = renderToStaticMarkup(
    <KnowledgeManagerModal
      threadId="thread-1"
      className="absolute inset-0 z-40 bg-black/35"
      onList={async () => ({
        data: [
          {
            id: "k1",
            timestamp: "2026-03-11T08:00:00.000Z",
            type: "pattern",
            content: "Use focused tests first",
            confidence: 0.8,
            tags: ["tests"],
            sessionId: "thread-1",
          },
        ],
      })}
      onUpdate={async () => {
        throw new Error("unused");
      }}
      onDelete={async () => ({ deleted: true })}
      onClose={() => {}}
    />,
  );

  expect(html).toContain('aria-label="Knowledge"');
  expect(html).toContain("absolute inset-0 z-40 bg-black/35");
  expect(html).toContain("Search");
  expect(html).toContain("Filter knowledge type");
  expect(html).toContain("Sort knowledge entries");
  expect(html).not.toContain("New entry");
  expect(html).toContain("Loading knowledge entries…");
  expect(html).toContain("Entries (0/0)");
  expect(html).toContain("pattern");
  expect(html).toContain("decision");
});

test("user message renders attached images", () => {
  const html = renderToStaticMarkup(
    <UserMessage
      text="See attached"
      images={[{ url: "blob:test-image", fileName: "screen.png", mediaType: "image/png" }]}
    />,
  );

  expect(html).toContain("See attached");
  expect(html).toContain('src="blob:test-image"');
  expect(html).toContain('alt="screen.png"');
});

test("context message renders checkpoint language and expandable summary area", () => {
  const html = renderToStaticMarkup(<ContextMessage summary={"## Goal\nShip transcript-aware compaction UI"} />);

  expect(html).toContain("Context checkpoint");
  expect(html).toContain("Compacted");
  expect(html).toContain("Older conversation was compressed to keep the thread efficient.");
  expect(html).toContain('aria-expanded="false"');
});

test("input dock renders pending image preview and add-images action", () => {
  const html = renderToStaticMarkup(
    <InputDock
      input=""
      onInputChange={() => {}}
      onSend={() => {}}
      onSteer={() => {}}
      onInterrupt={() => {}}
      onCompactionClick={() => {}}
      canSend={true}
      canSteer={false}
      threadStatus="idle"
      mode="default"
      onModeChange={() => {}}
      effort="none"
      onEffortChange={() => {}}
      currentModel="gpt-5.4"
      availableModels={[
        {
          id: "gpt-5.4",
          provider: "openai",
          contextWindow: 400000,
          maxOutputTokens: 128000,
          supportsVision: true,
          supportsThinking: true,
          supportedEfforts: ["none", "low", "medium", "high", "max"],
        },
      ]}
      onModelChange={() => {}}
      usage={{ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 }}
      currentContextTokens={0}
      contextWindow={200000}
      hasProvider={true}
      onOpenProviders={() => {}}
      supportsVision={true}
      supportsThinking={true}
      pendingImages={[{ path: "/tmp/shot.png", url: "blob:shot", fileName: "shot.png" }]}
      isUploadingImages={false}
      onAddImages={() => {}}
      onRemoveImage={() => {}}
    />,
  );

  expect(html).toContain('src="blob:shot"');
  expect(html).toContain('accept="image/png,image/jpeg,image/webp,image/gif"');
  expect(html).toContain('placeholder="Ask anything or attach images…"');
  expect(html).toContain("minimal");
  expect(html).toContain("minimal");
});

test("input dock shows uploading state and disables send affordance", () => {
  const html = renderToStaticMarkup(
    <InputDock
      input="Describe this"
      onInputChange={() => {}}
      onSend={() => {}}
      onSteer={() => {}}
      onInterrupt={() => {}}
      onCompactionClick={() => {}}
      canSend={false}
      canSteer={false}
      threadStatus="idle"
      mode="default"
      onModeChange={() => {}}
      effort="high"
      onEffortChange={() => {}}
      currentModel="claude-sonnet-4-6"
      availableModels={[
        {
          id: "claude-sonnet-4-6",
          provider: "anthropic",
          contextWindow: 200000,
          maxOutputTokens: 16384,
          supportsVision: true,
        },
      ]}
      onModelChange={() => {}}
      usage={{ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 }}
      currentContextTokens={0}
      contextWindow={200000}
      hasProvider={true}
      onOpenProviders={() => {}}
      supportsVision={true}
      supportsThinking={true}
      pendingImages={[]}
      isUploadingImages={true}
      onAddImages={() => {}}
      onRemoveImage={() => {}}
    />,
  );

  expect(html).toContain("Uploading images…");
  expect(html).toContain("disabled");
});

test("input dock hides effort selector when model does not support thinking", () => {
  const html = renderToStaticMarkup(
    <InputDock
      input=""
      onInputChange={() => {}}
      onSend={() => {}}
      onSteer={() => {}}
      onInterrupt={() => {}}
      onCompactionClick={() => {}}
      canSend={true}
      canSteer={false}
      threadStatus="idle"
      mode="default"
      onModeChange={() => {}}
      effort="medium"
      onEffortChange={() => {}}
      currentModel="gpt-5.3-chat-latest"
      availableModels={[
        {
          id: "gpt-5.3-chat-latest",
          provider: "openai",
          contextWindow: 400000,
          maxOutputTokens: 16384,
          supportsThinking: false,
        },
      ]}
      onModelChange={() => {}}
      usage={{ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 }}
      currentContextTokens={0}
      contextWindow={400000}
      hasProvider={true}
      onOpenProviders={() => {}}
      supportsVision={false}
      supportsThinking={false}
      pendingImages={[]}
      isUploadingImages={false}
      onAddImages={() => {}}
      onRemoveImage={() => {}}
    />,
  );

  expect(html).not.toContain("Effort selector");
});

test("slash menu renders a flat command list without submenu affordances", () => {
  const html = renderToStaticMarkup(
    <SlashMenu
      commands={[
        { name: "help", description: "Show available commands" },
        { name: "resume", description: "Resume thread", usage: "/resume <thread-id>", requiresArgs: true },
      ]}
      selectedIndex={1}
      onSelect={() => {}}
    />,
  );

  expect(html).toContain('role="listbox"');
  expect(html).toContain("/help");
  expect(html).toContain("/resume");
  expect(html).toContain("Resume thread");
  expect(html).not.toContain("›");
  expect(html).not.toContain("Default");
  expect(html).not.toContain("Execute");
});

test("tool block renders completed duration in header", () => {
  const html = renderToStaticMarkup(
    <ToolBlock
      item={{
        id: "tool-1",
        kind: "tool",
        toolName: "bash",
        inputText: '{"command":"echo hi"}',
        outputText: "hi",
        isError: false,
        status: "done",
        timestamp: 200,
        toolCallId: "call-1",
        startedAt: 100,
        durationMs: 123,
      }}
    />,
  );

  expect(html).toContain("123ms");
  expect(html).toContain("Shell");
});

test("tool block hides duration while tool is still running", () => {
  const html = renderToStaticMarkup(
    <ToolBlock
      item={{
        id: "tool-2",
        kind: "tool",
        toolName: "bash",
        inputText: '{"command":"sleep 1"}',
        outputText: "",
        isError: false,
        status: "streaming",
        timestamp: 100,
        toolCallId: "call-2",
        startedAt: 100,
      }}
    />,
  );

  expect(html).not.toContain("123ms");
  expect(html).toContain("running");
});

test("extractPastedImageFiles returns empty array for null clipboard", () => {
  expect(extractPastedImageFiles(null)).toEqual([]);
});

test("extractPastedImageFiles ignores text-only clipboard items", () => {
  const clipboardData = createClipboardData({
    items: [{ kind: "string", type: "text/plain" }],
  });

  expect(extractPastedImageFiles(clipboardData)).toEqual([]);
});

test("extractPastedImageFiles returns supported image files from clipboard items", () => {
  const png = createClipboardFile("shot.png", "image/png");
  const jpeg = createClipboardFile("photo.jpg", "image/jpeg");
  const clipboardData = createClipboardData({
    items: [
      { kind: "file", type: "image/png", file: png },
      { kind: "file", type: "image/svg+xml", file: createClipboardFile("vector.svg", "image/svg+xml") },
      { kind: "file", type: "image/jpeg", file: jpeg },
    ],
  });

  expect(extractPastedImageFiles(clipboardData)).toEqual([png, jpeg]);
});

test("extractPastedImageFiles falls back to clipboard files when items are unavailable", () => {
  const gif = createClipboardFile("anim.gif", "image/gif");
  const txt = createClipboardFile("notes.txt", "text/plain");
  const clipboardData = createClipboardData({
    items: [],
    files: [gif, txt],
  });

  expect(extractPastedImageFiles(clipboardData)).toEqual([gif]);
});

test("normalizeImageFileName keeps existing file names", () => {
  const file = createClipboardFile("existing-name.webp", "image/webp");
  expect(normalizeImageFileName(file, 0, 12345)).toBe("existing-name.webp");
});

test("normalizeImageFileName generates PNG fallback names for empty clipboard file names", () => {
  const file = createClipboardFile("", "image/png");
  expect(normalizeImageFileName(file, 2, 12345)).toBe("pasted-image-12345-2.png");
});

test("normalizeImageFileName generates JPEG fallback names for blank clipboard file names", () => {
  const file = createClipboardFile("   ", "image/jpeg");
  expect(normalizeImageFileName(file, 1, 222)).toBe("pasted-image-222-1.jpg");
});

test("slash menu renders command list with listbox role", () => {
  const commands = [
    { name: "help", description: "Show available commands" },
    { name: "new", description: "Start a new conversation" },
    { name: "model", description: "Switch model" },
  ];

  const html = renderToStaticMarkup(<SlashMenu commands={commands} selectedIndex={0} onSelect={() => {}} />);

  expect(html).toContain('role="listbox"');
  expect(html).toContain("/help");
  expect(html).toContain("/new");
  expect(html).toContain("/model");
  expect(html).toContain("Show available commands");
});

test("slash menu highlights selected command with accent class", () => {
  const commands = [
    { name: "help", description: "Show available commands" },
    { name: "new", description: "Start a new conversation" },
  ];

  const html = renderToStaticMarkup(<SlashMenu commands={commands} selectedIndex={1} onSelect={() => {}} />);

  // The second item (index 1) should have accent highlight and aria-selected
  expect(html).toContain('aria-selected="true"');
  // Both items have role="option"
  const optionCount = (html.match(/role="option"/g) ?? []).length;
  expect(optionCount).toBe(2);
});

test("slash menu returns null for empty commands", () => {
  const html = renderToStaticMarkup(<SlashMenu commands={[]} selectedIndex={0} onSelect={() => {}} />);

  expect(html).toBe("");
});
