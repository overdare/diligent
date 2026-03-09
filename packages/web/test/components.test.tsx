// @summary Static render tests for core UI components and accessibility attributes
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { normalizeImageFileName } from "../src/client/App";
import { Button } from "../src/client/components/Button";
import { Input } from "../src/client/components/Input";
import { extractPastedImageFiles, InputDock } from "../src/client/components/InputDock";
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

test("tool settings modal renders trust warning and tool/plugin rows", () => {
  const html = renderToStaticMarkup(
    <ToolSettingsModal
      threadId="thread-1"
      initialState={{
        configPath: "/repo/.diligent/diligent.jsonc",
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

  expect(html).toContain("Plugin packages run with full trust");
  expect(html).toContain("Built-in tools");
  expect(html).toContain("bash");
  expect(html).toContain("Locked");
  expect(html).toContain("@acme/diligent-tools");
  expect(html).toContain("jira_comment");
  expect(html).toContain("Changes apply on the next turn");
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
      pendingImages={[{ path: "/tmp/shot.png", url: "blob:shot", fileName: "shot.png" }]}
      isUploadingImages={false}
      onAddImages={() => {}}
      onRemoveImage={() => {}}
    />,
  );

  expect(html).toContain('src="blob:shot"');
  expect(html).toContain('accept="image/png,image/jpeg,image/webp,image/gif"');
  expect(html).toContain('placeholder="Ask anything or attach images…"');
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
      pendingImages={[]}
      isUploadingImages={true}
      onAddImages={() => {}}
      onRemoveImage={() => {}}
    />,
  );

  expect(html).toContain("Uploading images…");
  expect(html).toContain("disabled");
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
    { name: "mode", description: "Set collaboration mode", options: [{ label: "Plan", value: "plan" }] },
  ];

  const html = renderToStaticMarkup(
    <SlashMenu
      commands={commands}
      selectedIndex={0}
      expandedCommand={null}
      subSelectedIndex={0}
      onSelect={() => {}}
      onSelectOption={() => {}}
    />,
  );

  expect(html).toContain('role="listbox"');
  expect(html).toContain("/help");
  expect(html).toContain("/new");
  expect(html).toContain("/mode");
  expect(html).toContain("Show available commands");
});

test("slash menu highlights selected command with accent class", () => {
  const commands = [
    { name: "help", description: "Show available commands" },
    { name: "new", description: "Start a new conversation" },
  ];

  const html = renderToStaticMarkup(
    <SlashMenu
      commands={commands}
      selectedIndex={1}
      expandedCommand={null}
      subSelectedIndex={0}
      onSelect={() => {}}
      onSelectOption={() => {}}
    />,
  );

  // The second item (index 1) should have accent highlight and aria-selected
  expect(html).toContain('aria-selected="true"');
  // Both items have role="option"
  const optionCount = (html.match(/role="option"/g) ?? []).length;
  expect(optionCount).toBe(2);
});

test("slash menu renders expanded sub-options", () => {
  const modeCmd = {
    name: "mode",
    description: "Set collaboration mode",
    options: [
      { label: "Default", value: "default", description: "Normal conversation" },
      { label: "Plan", value: "plan", description: "Plan before acting" },
    ],
  };

  const html = renderToStaticMarkup(
    <SlashMenu
      commands={[modeCmd]}
      selectedIndex={0}
      expandedCommand={modeCmd}
      subSelectedIndex={0}
      onSelect={() => {}}
      onSelectOption={() => {}}
    />,
  );

  expect(html).toContain("Default");
  expect(html).toContain("Normal conversation");
  expect(html).toContain("Plan");
  expect(html).toContain("Plan before acting");
});

test("slash menu returns null for empty commands", () => {
  const html = renderToStaticMarkup(
    <SlashMenu
      commands={[]}
      selectedIndex={0}
      expandedCommand={null}
      subSelectedIndex={0}
      onSelect={() => {}}
      onSelectOption={() => {}}
    />,
  );

  expect(html).toBe("");
});
