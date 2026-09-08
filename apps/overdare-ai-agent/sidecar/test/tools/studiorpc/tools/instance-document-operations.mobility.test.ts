// @summary Verifies inherited Mobility normalization retained for hierarchy moves.
import { describe, expect, test } from "bun:test";
import { normalizeWorkspaceMobility } from "../../../../src/tools/studiorpc/tools/instance-document-operations";
import { findNodeByActorGuid, type OvdrjmNode } from "../../../../src/tools/studiorpc/tools/ovdrjm-utils";

function requireDocumentRoot(document: Record<string, unknown>) {
  return document.Root as OvdrjmNode;
}
function makeDocument(): {
  document: Record<string, unknown>;
  topGuid: string;
  childGuid: string;
  workspaceGuid: string;
} {
  const workspaceGuid = "WORKSPACE";
  const topGuid = "TOP";
  const childGuid = "CHILD";
  const document = {
    Root: {
      InstanceType: "Workspace",
      ActorGuid: workspaceGuid,
      Name: "Workspace",
      LuaChildren: [
        {
          InstanceType: "Folder",
          ActorGuid: topGuid,
          Name: "hello",
          LuaChildren: [
            {
              InstanceType: "Model",
              ActorGuid: childGuid,
              Name: "hey",
              LuaChildren: [{ InstanceType: "Part", ActorGuid: "GRANDCHILD", Name: "k" }],
            },
          ],
        },
      ],
    },
  };
  return { document, topGuid, childGuid, workspaceGuid };
}

function node(document: Record<string, unknown>, guid: string): OvdrjmNode {
  const found = findNodeByActorGuid(requireDocumentRoot(document), guid);
  if (!found) throw new Error(`missing ${guid}`);
  return found;
}

describe("Workspace Mobility normalization", () => {
  test("JSON apply normalizes explicit descendant values to the top-level value", () => {
    const { document, topGuid, childGuid } = makeDocument();
    node(document, topGuid).Mobility = "Static";
    node(document, childGuid).Mobility = "Movable";
    node(document, "GRANDCHILD").Mobility = "Movable";
    normalizeWorkspaceMobility(requireDocumentRoot(document));
    expect(node(document, childGuid).Mobility).toBe("Static");
    expect(node(document, "GRANDCHILD").Mobility).toBe("Static");
  });

  test("JSON apply materializes a Static top-level onto keyless descendants (default is Movable)", () => {
    // The engine default is Movable, so a Static top-level must be written onto
    // otherwise-keyless descendants or they would attach as Movable.
    const { document, topGuid, childGuid } = makeDocument();
    node(document, topGuid).Mobility = "Static";
    normalizeWorkspaceMobility(requireDocumentRoot(document));
    expect(node(document, childGuid).Mobility).toBe("Static");
    expect(node(document, "GRANDCHILD").Mobility).toBe("Static");
  });

  test("JSON apply pulls a stale Static descendant back to Movable under a default top-level", () => {
    const { document, childGuid } = makeDocument();
    // Top-level left unset -> effective Movable; a descendant carries a stale Static.
    node(document, childGuid).Mobility = "Static";
    normalizeWorkspaceMobility(requireDocumentRoot(document));
    expect(node(document, childGuid).Mobility).toBe("Movable");
  });

  test("JSON apply leaves keyless descendants keyless under a Movable top-level (no churn)", () => {
    const { document, topGuid, childGuid } = makeDocument();
    node(document, topGuid).Mobility = "Movable";
    normalizeWorkspaceMobility(requireDocumentRoot(document));
    expect("Mobility" in node(document, childGuid)).toBe(false);
    expect("Mobility" in node(document, "GRANDCHILD")).toBe(false);
  });
});
