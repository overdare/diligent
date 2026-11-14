export interface RenderBlock {
  /** Stable within a component so the renderer can track overflow/persistence across frames */
  key: string;
  /** Rendered ANSI-styled lines for this block */
  lines: string[];
  /** Persistent blocks are flushed to scrollback once; volatile blocks are redrawn in the viewport */
  persistence: "persistent" | "volatile";
}

/** Core component interface — pi-agent's proven pattern */
export interface Component {
  /** Render to ANSI-styled lines for the given terminal width */
  render(width: number): string[];
  /** Render structured blocks so the renderer does not infer global committed/active regions */
  renderBlocks?(width: number): RenderBlock[];
  /** Handle raw input data (optional — not all components are interactive) */
  handleInput?(data: string): void;
  /** Whether this component wants key release events (Kitty protocol) */
  wantsKeyRelease?: boolean;
  /** Clear cached rendering state, forcing full re-render */
  invalidate(): void;
}

/** Components that can receive hardware cursor focus */
export interface Focusable {
  focused: boolean;
}

/** Zero-width cursor marker — components embed this where the hardware cursor should be.
 * Uses APC (Application Program Command) sequence which all terminals ignore visually. */
export const CURSOR_MARKER = "\x1b_diligent:c\x07";
