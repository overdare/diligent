// @summary Reads authored GUI trees and reports estimated mobile layout collisions without changing Studio state.
import { getReservedUiZones, type HiddenCoreGui, REFERENCE_VIEWPORT } from "../reserved-ui";

const GUI_OBJECT_CLASSES = new Set([
  "Frame",
  "ImageButton",
  "ImageLabel",
  "ProgressBar",
  "ScrollingFrame",
  "TextButton",
  "TextLabel",
]);
const BUTTON_CLASSES = new Set(["ImageButton", "TextButton"]);
const SCREEN_GUI_CLASSES = new Set(["ScreenGui", "StarterGui"]);
const LAYOUT_CLASSES = new Set(["UIGridLayout", "UIListLayout"]);
const MAX_NODES = 2_000;
const MAX_SKIPPED_ELEMENTS = 200;
const DEFAULT_MAX_FINDINGS = 50;
const MAX_FINDINGS = 200;

export interface UiLayoutScreen {
  path: string;
  root: Record<string, unknown>;
}

export interface UiLayoutRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface UiLayoutElement {
  guid: string | null;
  path: string;
  class: string;
  rect: UiLayoutRect;
}

export interface UiLayoutSkippedElement {
  path: string;
  reason: string;
}

export type UiLayoutFinding =
  | {
      kind: "reserved_overlap";
      element: UiLayoutElement;
      zone: { id: string; label: string; rect: UiLayoutRect };
      intersection: UiLayoutRect;
    }
  | {
      kind: "button_overlap";
      elements: [UiLayoutElement, UiLayoutElement];
      intersection: UiLayoutRect;
    }
  | {
      kind: "outside_viewport";
      element: UiLayoutElement;
      intersection: UiLayoutRect | null;
    };

export interface UiLayoutReport {
  geometry: "authored-estimate";
  viewport: { width: number; height: number };
  checkedElements: number;
  skippedElements: UiLayoutSkippedElement[];
  findings: UiLayoutFinding[];
  truncated: boolean;
}

export interface InspectUiLayoutOptions {
  hiddenCoreGui?: readonly HiddenCoreGui[];
  viewport?: { width: number; height: number };
  maxFindings?: number;
}

interface PixelRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ButtonEntry {
  id: string;
  ancestors: readonly string[];
  element: UiLayoutElement;
  pixelRect: PixelRect;
}

interface WorkItem {
  node: Record<string, unknown>;
  path: string;
  id: string;
  ancestors: readonly string[];
  parentRect: PixelRect;
  insideScreenGui: boolean;
  intentionalOverlay: boolean;
  unsupportedReason?: string;
}

const normalizedViewport: UiLayoutRect = { left: 0, top: 0, right: 1, bottom: 1 };

/**
 * Inspects authored UDim2 geometry only. Runtime layout constraints, rotation, and script-driven
 * changes are deliberately reported as incomplete rather than guessed.
 */
export function inspectUiLayout(
  screens: readonly UiLayoutScreen[],
  options: InspectUiLayoutOptions = {},
): UiLayoutReport {
  const viewport = validViewport(options.viewport) ? { ...options.viewport } : { ...REFERENCE_VIEWPORT };
  const maxFindings = boundedMaxFindings(options.maxFindings);
  const screenRect: PixelRect = { left: 0, top: 0, right: viewport.width, bottom: viewport.height };
  const reservedZones = getReservedUiZones(options.hiddenCoreGui).map((zone) => ({
    id: zone.id,
    label: zone.label,
    rect: normalizeRect(zone.rect, REFERENCE_VIEWPORT),
  }));
  const skippedElements: UiLayoutSkippedElement[] = [];
  const findings: UiLayoutFinding[] = [];
  const buttons: ButtonEntry[] = [];
  const stack: WorkItem[] = [];
  let checkedElements = 0;
  let nodeCount = 0;
  let truncated = false;

  const addSkipped = (path: string, reason: string): void => {
    if (skippedElements.length >= MAX_SKIPPED_ELEMENTS) {
      truncated = true;
      return;
    }
    skippedElements.push({ path, reason });
  };
  const addFinding = (finding: UiLayoutFinding): boolean => {
    if (findings.length >= maxFindings) {
      truncated = true;
      return false;
    }
    findings.push(finding);
    return true;
  };

  for (let screenIndex = screens.length - 1; screenIndex >= 0; screenIndex--) {
    const screen = screens[screenIndex];
    if (!screen || !isRecord(screen.root)) continue;
    stack.push({
      node: screen.root,
      path: screen.path || `screen[${screenIndex}]`,
      id: `screen:${screenIndex}`,
      ancestors: [],
      parentRect: screenRect,
      insideScreenGui: false,
      intentionalOverlay: false,
    });
  }

  while (stack.length > 0) {
    if (nodeCount >= MAX_NODES) {
      truncated = true;
      break;
    }
    const current = stack.pop();
    if (!current) break;
    nodeCount++;

    const cls = stringMember(current.node, "InstanceType") ?? stringMember(current.node, "class");
    const isScreenGui = cls !== undefined && SCREEN_GUI_CLASSES.has(cls);
    const isGuiObject = cls !== undefined && (GUI_OBJECT_CLASSES.has(cls) || hasAuthoredUdim2Geometry(current.node));

    // Disabled/hidden GUI has no authored visible footprint. It is not incomplete geometry.
    if (
      (isScreenGui && booleanMember(current.node, "Enabled") === false) ||
      (isGuiObject && booleanMember(current.node, "Visible") === false)
    ) {
      continue;
    }

    let childRect = current.parentRect;
    let childInsideScreenGui = current.insideScreenGui;
    let childUnsupportedReason = current.unsupportedReason;

    if (isScreenGui) {
      childRect = screenRect;
      childInsideScreenGui = true;
    } else if (isGuiObject) {
      if (current.unsupportedReason) {
        addSkipped(current.path, current.unsupportedReason);
      } else if (hasUnsupportedRotation(current.node)) {
        addSkipped(current.path, "unsupported Rotation; authored axis-aligned rect would be inaccurate");
        childUnsupportedReason = "ancestor has unsupported Rotation";
      } else {
        const resolved = resolveRect(current.node, current.parentRect);
        if (resolved.ok === false) {
          addSkipped(current.path, resolved.reason);
          childUnsupportedReason = `ancestor has ${resolved.reason}`;
        } else {
          childRect = resolved.rect;
          if (current.insideScreenGui) {
            checkedElements++;
            const element = toElement(current.node, current.path, cls, resolved.rect, viewport);
            const intentionalOverlay = current.intentionalOverlay || zIndex(current.node) >= 100;
            const transparentContainer = isTransparentInactiveFrame(current.node, cls);
            const transparentPassiveVisual = isTransparentPassiveVisual(current.node, cls);

            if (!transparentContainer && !transparentPassiveVisual) {
              if (!intentionalOverlay) {
                for (const zone of reservedZones) {
                  const intersection = intersect(element.rect, zone.rect);
                  if (intersection) {
                    addFinding({ kind: "reserved_overlap", element, zone, intersection });
                  }
                }
              }
              if (isOutsideViewport(element.rect)) {
                addFinding({
                  kind: "outside_viewport",
                  element,
                  intersection: intersect(element.rect, normalizedViewport),
                });
              }
              if (!intentionalOverlay && BUTTON_CLASSES.has(cls)) {
                buttons.push({ id: current.id, ancestors: current.ancestors, element, pixelRect: resolved.rect });
              }
            }
          }
        }
      }
    } else if (cls && LAYOUT_CLASSES.has(cls)) {
      addSkipped(current.path, `layout-managed ${cls}; final child geometry is determined at runtime`);
    }

    const layoutClass = childLayoutClass(current.node);
    if (!childUnsupportedReason && layoutClass) {
      childUnsupportedReason = `layout-managed by ${layoutClass}`;
    }
    const children = childNodes(current.node);
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index];
      const childClass = stringMember(child, "InstanceType") ?? stringMember(child, "class") ?? "Unknown";
      const childName = stringMember(child, "Name") ?? childClass;
      stack.push({
        node: child,
        path: `${current.path}.${childName}`,
        id: `${current.id}/${index}`,
        ancestors: [...current.ancestors, current.id],
        parentRect: childRect,
        insideScreenGui: childInsideScreenGui,
        intentionalOverlay: current.intentionalOverlay || zIndex(current.node) >= 100,
        ...(childUnsupportedReason ? { unsupportedReason: childUnsupportedReason } : {}),
      });
    }
  }

  // A sweep over left edges avoids quadratic work for normal non-overlapping HUDs. The report
  // cap also bounds the dense-overlap case, where the first collisions are the useful ones.
  const sortedButtons = [...buttons].sort((a, b) => a.pixelRect.left - b.pixelRect.left);
  const active: ButtonEntry[] = [];
  for (const button of sortedButtons) {
    for (let index = active.length - 1; index >= 0; index--) {
      if (active[index].pixelRect.right <= button.pixelRect.left) active.splice(index, 1);
    }
    for (const other of active) {
      if (other.ancestors.includes(button.id) || button.ancestors.includes(other.id)) continue;
      const intersection = intersect(other.element.rect, button.element.rect);
      if (intersection) addFinding({ kind: "button_overlap", elements: [other.element, button.element], intersection });
    }
    active.push(button);
  }

  return {
    geometry: "authored-estimate",
    viewport,
    checkedElements,
    skippedElements,
    findings,
    truncated,
  };
}

function validViewport(viewport: InspectUiLayoutOptions["viewport"]): viewport is { width: number; height: number } {
  return (
    !!viewport &&
    Number.isFinite(viewport.width) &&
    viewport.width > 0 &&
    Number.isFinite(viewport.height) &&
    viewport.height > 0
  );
}

function boundedMaxFindings(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_FINDINGS;
  return Math.min(MAX_FINDINGS, Math.max(1, Math.floor(value as number)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function member(record: Record<string, unknown>, key: string): unknown {
  if (key in record) return record[key];
  const matches = Object.keys(record).filter((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return matches.length === 1 ? record[matches[0]] : undefined;
}

function stringMember(record: Record<string, unknown>, key: string): string | undefined {
  const value = member(record, key);
  return typeof value === "string" ? value : undefined;
}

function booleanMember(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = member(record, key);
  return typeof value === "boolean" ? value : undefined;
}

function numberMember(record: Record<string, unknown>, key: string): number | undefined {
  const value = member(record, key);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function childNodes(node: Record<string, unknown>): Record<string, unknown>[] {
  const children = member(node, "LuaChildren");
  return Array.isArray(children) ? children.filter(isRecord) : [];
}

function childLayoutClass(node: Record<string, unknown>): string | undefined {
  return childNodes(node)
    .map((child) => stringMember(child, "InstanceType") ?? stringMember(child, "class"))
    .find((cls): cls is string => cls !== undefined && LAYOUT_CLASSES.has(cls));
}

function hasUnsupportedRotation(node: Record<string, unknown>): boolean {
  const rotation = numberMember(node, "Rotation");
  return rotation !== undefined && rotation !== 0;
}

function isTransparentInactiveFrame(node: Record<string, unknown>, cls: string): boolean {
  return (
    cls === "Frame" &&
    (numberMember(node, "BackgroundTransparency") ?? 0) >= 1 &&
    booleanMember(node, "Active") !== true
  );
}

/** Labels with no background or visible foreground do not occupy authored UI space. Buttons remain interactive. */
function isTransparentPassiveVisual(node: Record<string, unknown>, cls: string): boolean {
  if ((numberMember(node, "BackgroundTransparency") ?? 0) < 1) return false;
  if (cls === "TextLabel") {
    const text = stringMember(node, "Text");
    return text === undefined || text.length === 0 || (numberMember(node, "TextTransparency") ?? 0) >= 1;
  }
  if (cls === "ImageLabel") {
    const image = stringMember(node, "Image");
    return image === undefined || image.length === 0 || (numberMember(node, "ImageTransparency") ?? 0) >= 1;
  }
  return false;
}

function zIndex(node: Record<string, unknown>): number {
  return numberMember(node, "ZIndex") ?? 0;
}

function resolveRect(
  node: Record<string, unknown>,
  parent: PixelRect,
): { ok: true; rect: PixelRect } | { ok: false; reason: string } {
  const position = udim2(member(node, "Position"));
  const size = udim2(member(node, "Size"));
  if (!position || !size) return { ok: false, reason: "missing or unsupported Position/Size geometry" };

  const anchor = vector2(member(node, "AnchorPoint")) ?? { x: 0, y: 0 };
  const parentWidth = parent.right - parent.left;
  const parentHeight = parent.bottom - parent.top;
  const width = size.x.scale * parentWidth + size.x.offset;
  const height = size.y.scale * parentHeight + size.y.offset;
  if (width <= 0 || height <= 0) return { ok: false, reason: "non-positive authored Size" };

  const x = parent.left + position.x.scale * parentWidth + position.x.offset - anchor.x * width;
  const y = parent.top + position.y.scale * parentHeight + position.y.offset - anchor.y * height;
  return { ok: true, rect: { left: x, top: y, right: x + width, bottom: y + height } };
}

function hasAuthoredUdim2Geometry(node: Record<string, unknown>): boolean {
  return udim2(member(node, "Position")) !== undefined && udim2(member(node, "Size")) !== undefined;
}

function udim2(value: unknown): { x: UDim; y: UDim } | undefined {
  if (!isRecord(value)) return undefined;
  const x = udim(member(value, "X"));
  const y = udim(member(value, "Y"));
  return x && y ? { x, y } : undefined;
}

interface UDim {
  scale: number;
  offset: number;
}

function udim(value: unknown): UDim | undefined {
  if (!isRecord(value)) return undefined;
  const scale = numberMember(value, "Scale");
  const offset = numberMember(value, "Offset");
  return scale !== undefined && offset !== undefined ? { scale, offset } : undefined;
}

function vector2(value: unknown): { x: number; y: number } | undefined {
  if (!isRecord(value)) return undefined;
  const x = numberMember(value, "X");
  const y = numberMember(value, "Y");
  return x !== undefined && y !== undefined ? { x, y } : undefined;
}

function toElement(
  node: Record<string, unknown>,
  path: string,
  cls: string,
  pixelRect: PixelRect,
  viewport: { width: number; height: number },
): UiLayoutElement {
  return {
    guid: stringMember(node, "ActorGuid") ?? stringMember(node, "guid") ?? null,
    path,
    class: cls,
    rect: normalizeRect(pixelRect, viewport),
  };
}

function normalizeRect(rect: PixelRect, viewport: { width: number; height: number }): UiLayoutRect {
  return {
    left: rect.left / viewport.width,
    top: rect.top / viewport.height,
    right: rect.right / viewport.width,
    bottom: rect.bottom / viewport.height,
  };
}

function intersect(a: UiLayoutRect, b: UiLayoutRect): UiLayoutRect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  return left < right && top < bottom ? { left, top, right, bottom } : null;
}

function isOutsideViewport(rect: UiLayoutRect): boolean {
  return rect.left < 0 || rect.top < 0 || rect.right > 1 || rect.bottom > 1;
}
