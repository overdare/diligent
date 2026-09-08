// @summary Keeps singleton protection shared with the compatibility class catalog.
import { serviceClassEnum } from "./instance.params";

const protectedInstanceClasses = new Set<string>(serviceClassEnum.options);

export function isProtectedInstanceClass(className: string): boolean {
  return protectedInstanceClasses.has(className);
}
