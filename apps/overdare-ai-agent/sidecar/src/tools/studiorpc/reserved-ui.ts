// @summary Shared estimated mobile control regions for UI diagnostics and screenshot annotations.
import { z } from "zod";

export const REFERENCE_VIEWPORT = { width: 1386, height: 640 } as const;
export const hiddenCoreGuiParam = z
  .array(z.enum(["JumpButton", "Joystick"]))
  .max(2)
  .optional()
  .describe(
    "Default controls hidden by the current GUI/input scripts, confirmed with script_grep/script_read. " +
      "Only changes Diligent's layout guidance; does not hide controls or verify runtime state. " +
      "Do not exclude a control because it is absent from a screenshot. Omit uncertain or conditional cases.",
  );
export type HiddenCoreGui = NonNullable<z.infer<typeof hiddenCoreGuiParam>>[number];
export interface UiRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface ReservedUiZone {
  id: HiddenCoreGui | "Toolbar" | "LeftInset" | "RightInset";
  label: string;
  rect: UiRect;
}

const { width, height } = REFERENCE_VIEWPORT;
const zones: ReservedUiZone[] = [
  // Default jump: 180x180, anchored at bottom-right with offsets (-140, -70).
  {
    id: "JumpButton",
    label: "mobile jump button",
    rect: { left: width - 320, top: height - 250, right: width - 140, bottom: height - 70 },
  },
  { id: "Toolbar", label: "mobile HUD", rect: { left: 0, top: 0, right: 210, bottom: 70 } },
  { id: "Joystick", label: "mobile joystick", rect: { left: 0, top: height - 300, right: 300, bottom: height } },
  { id: "LeftInset", label: "left safe area (notch/OS menu)", rect: { left: 0, top: 0, right: 40, bottom: height } },
  {
    id: "RightInset",
    label: "right safe area (notch/OS menu)",
    rect: { left: width - 40, top: 0, right: width, bottom: height },
  },
];

export function getReservedUiZones(hiddenCoreGui: readonly HiddenCoreGui[] = []): ReservedUiZone[] {
  const hidden = new Set<string>(hiddenCoreGui);
  return zones.filter((zone) => !hidden.has(zone.id));
}
