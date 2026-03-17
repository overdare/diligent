// @summary Compile-time parity assertion between core and protocol ProviderName types
import type { ProviderName as ProtocolProviderName } from "@diligent/protocol";
import type { ProviderName } from "./types";

type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
      ? true
      : false
    : false;

type Assert<T extends true> = T;

type _ProviderNameParity = Assert<IsEqual<ProviderName, ProtocolProviderName>>;
