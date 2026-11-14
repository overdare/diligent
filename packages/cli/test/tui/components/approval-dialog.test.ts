// @summary Tests for ApprovalDialog — render, keyboard shortcuts, button navigation
import { describe, expect, it } from "bun:test";
import type { ApprovalResponse } from "@diligent/runtime";
import { ApprovalDialog } from "../../../src/tui/components/approval-dialog";

function makeDialog(onResult: (r: ApprovalResponse) => void) {
  return new ApprovalDialog(
    { toolName: "bash", permission: "execute", description: "execute a command", details: "ls src/" },
    onResult,
  );
}

describe("ApprovalDialog.render", () => {
  it("renders 2 lines containing tool name and details", () => {
    const dialog = makeDialog(() => {});
    const lines = dialog.render(80);
    expect(lines.length).toBe(2);
    const joined = lines.join("\n");
    expect(joined).toContain("bash");
    expect(joined).toContain("ls src/");
    expect(joined).toContain("once");
    expect(joined).toContain("always");
    expect(joined).toContain("reject");
  });
});

describe("ApprovalDialog.handleInput", () => {
  it("o key returns 'once'", () => {
    let result: ApprovalResponse | undefined;
    const dialog = makeDialog((r) => {
      result = r;
    });
    dialog.handleInput("o");
    expect(result).toBe("once");
  });

  it("a key returns 'always'", () => {
    let result: ApprovalResponse | undefined;
    const dialog = makeDialog((r) => {
      result = r;
    });
    dialog.handleInput("a");
    expect(result).toBe("always");
  });

  it("r key returns 'reject'", () => {
    let result: ApprovalResponse | undefined;
    const dialog = makeDialog((r) => {
      result = r;
    });
    dialog.handleInput("r");
    expect(result).toBe("reject");
  });

  it("Escape returns 'reject'", () => {
    let result: ApprovalResponse | undefined;
    const dialog = makeDialog((r) => {
      result = r;
    });
    dialog.handleInput("\x1b"); // ESC
    expect(result).toBe("reject");
  });

  it("Enter confirms selected button (default = Once)", () => {
    let result: ApprovalResponse | undefined;
    const dialog = makeDialog((r) => {
      result = r;
    });
    dialog.handleInput("\r"); // Enter
    expect(result).toBe("once");
  });

  it("→ then Enter selects Always", () => {
    let result: ApprovalResponse | undefined;
    const dialog = makeDialog((r) => {
      result = r;
    });
    dialog.handleInput("\x1b[C"); // right arrow
    dialog.handleInput("\r");
    expect(result).toBe("always");
  });

  it("→ → then Enter selects Reject", () => {
    let result: ApprovalResponse | undefined;
    const dialog = makeDialog((r) => {
      result = r;
    });
    dialog.handleInput("\x1b[C");
    dialog.handleInput("\x1b[C");
    dialog.handleInput("\r");
    expect(result).toBe("reject");
  });

  it("← wraps around from Once to Reject", () => {
    let result: ApprovalResponse | undefined;
    const dialog = makeDialog((r) => {
      result = r;
    });
    dialog.handleInput("\x1b[D"); // left arrow — wraps to Reject
    dialog.handleInput("\r");
    expect(result).toBe("reject");
  });
});
