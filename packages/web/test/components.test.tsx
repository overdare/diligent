// @summary Static render tests for core UI components and accessibility attributes
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "../src/client/components/Button";
import { Input } from "../src/client/components/Input";
import { InputDock } from "../src/client/components/InputDock";
import { Modal } from "../src/client/components/Modal";
import { ToolBlock } from "../src/client/components/ToolBlock";
import { UserMessage } from "../src/client/components/UserMessage";

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
