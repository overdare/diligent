// @summary Vertical stacking container for composing multiple components
import type { Component, RenderBlock } from "./types";

/** Vertical stacking container — concatenates children's render output */
export class Container implements Component {
  readonly children: Component[] = [];

  addChild(component: Component): void {
    this.children.push(component);
  }

  removeChild(component: Component): void {
    const index = this.children.indexOf(component);
    if (index !== -1) {
      this.children.splice(index, 1);
    }
  }

  insertBefore(component: Component, before: Component): void {
    const index = this.children.indexOf(before);
    if (index !== -1) {
      this.children.splice(index, 0, component);
    } else {
      this.children.push(component);
    }
  }

  render(width: number): string[] {
    return this.renderBlocks(width).flatMap((block) => block.lines);
  }

  renderBlocks(width: number): RenderBlock[] {
    return this.children.flatMap(
      (child) =>
        child.renderBlocks?.(width) ?? [
          {
            key: "default",
            lines: child.render(width),
            persistence: "volatile" as const,
          },
        ],
    );
  }

  handleInput(data: string): void {
    // Delegate to first child that accepts input
    for (const child of this.children) {
      if (child.handleInput) {
        child.handleInput(data);
        return;
      }
    }
  }

  invalidate(): void {
    for (const child of this.children) {
      child.invalidate();
    }
  }
}
