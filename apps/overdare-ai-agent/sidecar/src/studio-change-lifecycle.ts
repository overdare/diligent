// @summary Studio host awaits trigger-driven collection cleanup on normal or failed shutdown
import { stopStudioChangeCollector } from "./tools/studiorpc/tools/studio-change-collector";

export async function startStudioChangeHost<T extends { stop(): void }>(
  cwd: string,
  studioDisabled: boolean,
  startHost: () => Promise<T>,
): Promise<{ host: T; stop(): Promise<void> }> {
  try {
    const host = await startHost();
    let stopping: Promise<void> | undefined;
    return {
      host,
      stop: () =>
        (stopping ??= (async () => {
          if (!studioDisabled) await stopStudioChangeCollector(cwd);
          host.stop();
        })()),
    };
  } catch (error) {
    if (!studioDisabled) await stopStudioChangeCollector(cwd);
    throw error;
  }
}
