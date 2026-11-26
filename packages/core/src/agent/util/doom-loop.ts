// @summary Doom-loop detection helpers for repeated tool-call patterns

export interface DoomLoopDetection {
  detected: boolean;
  patternLength?: number;
  toolName?: string;
}

export interface DoomLoopTracker {
  signatures: string[];
  window: number;
}

export class DoomLoopDetector {
  private tracker: DoomLoopTracker;

  constructor(window = 24) {
    this.tracker = { signatures: [], window };
  }

  record(toolName: string, input: Record<string, unknown>): void {
    recordDoomLoopToolCall(this.tracker, toolName, input);
  }

  check(): DoomLoopDetection {
    const tracker = this.tracker;
    for (let patternLength = 1; patternLength <= Math.floor(tracker.window / 3); patternLength++) {
      const repeats = 3;
      const needed = patternLength * repeats;
      if (tracker.signatures.length < needed) continue;
      const tail = tracker.signatures.slice(-needed);
      const pattern = tail.slice(0, patternLength);
      const detected = tail.every((signature, index) => signature === pattern[index % patternLength]);
      if (detected) {
        const toolName = pattern[0].split("\0")[0];
        return { detected: true, patternLength, toolName };
      }
    }
    return { detected: false };
  }
}

function recordDoomLoopToolCall(tracker: DoomLoopTracker, toolName: string, input: Record<string, unknown>): void {
  tracker.signatures.push(`${toolName}\0${JSON.stringify(input)}`);
  if (tracker.signatures.length > tracker.window) tracker.signatures.shift();
}
