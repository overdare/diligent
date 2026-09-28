// @summary Studio product host starts its shared collector and awaits shutdown on every exit path
import { getStudioChangeCollector, stopStudioChangeCollector } from "./tools/studiorpc/tools/studio-change-collector";

export async function startStudioChangeHost<T extends { stop(): void }>(
  cwd: string,
  studioDisabled: boolean,
  startHost: () => Promise<T>,
): Promise<{ host: T; stop(): Promise<void> }> {
  if (!studioDisabled) getStudioChangeCollector(cwd).start();
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
