// @summary Helpers for packaging mode selection between full and skip-desktop-binary builds.

export function shouldBuildDesktopBinary(skipDesktopBinary: boolean): boolean {
  return skipDesktopBinary === false;
}
