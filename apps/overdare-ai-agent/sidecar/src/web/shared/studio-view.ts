// @summary Product workspace navigation preference shared by entry routing and its storage endpoint.
export type StudioView = "agent" | "claude" | "terminal";
export const STUDIO_VIEW_ROUTE = "/studio/view";
export function isStudioView(value: unknown): value is StudioView {
  return value === "agent" || value === "claude" || value === "terminal";
}
