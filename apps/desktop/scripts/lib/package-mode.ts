// @summary Helpers for packaging mode selection between full and runtime-only builds.

export function shouldBuildDesktopBinary(runtimeOnly: boolean): boolean {
  return runtimeOnly === false;
}
