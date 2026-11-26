// @summary Observes product HTTP traffic so a provider rejection the product recovers from still surfaces in evals

import type { ProviderHttpError } from "../runtime-task";

const MAX_ERROR_BODY_BYTES = 65_536;

let installed = false;
let sink: ProviderHttpError[] | undefined;

/**
 * Wraps `globalThis.fetch` once for the process. Install before provider clients are created, because SDK clients can
 * keep the fetch they see at construction. The wrapper only reads error responses through a clone.
 */
export function installProviderHttpObserver(): void {
  if (installed) return;
  installed = true;
  globalThis.fetch = new Proxy(globalThis.fetch, {
    async apply(target, receiver, args: Parameters<typeof fetch>) {
      const response: Response = await Reflect.apply(target, receiver, args);
      if (response.status >= 400 && sink) sink.push(await describeHttpError(args[0], response));
      return response;
    },
  });
}

/** Collects provider HTTP errors until `stop` runs. Evals run sequentially, so one collector is active at a time. */
export function collectProviderHttpErrors(): { errors: ProviderHttpError[]; stop(): void } {
  installProviderHttpObserver();
  const errors: ProviderHttpError[] = [];
  sink = errors;
  return {
    errors,
    stop: () => {
      if (sink === errors) sink = undefined;
    },
  };
}

async function describeHttpError(request: Parameters<typeof fetch>[0], response: Response): Promise<ProviderHttpError> {
  const href = request instanceof Request ? request.url : request.toString();
  const url = URL.canParse(href) ? new URL(href) : undefined;
  const error: ProviderHttpError = {
    status: response.status,
    endpoint: url ? `${url.origin}${url.pathname}` : "unknown",
  };
  const requestId = identifier(response.headers.get("x-request-id") ?? response.headers.get("request-id"));
  if (requestId) error.requestId = requestId;
  const size = Number(response.headers.get("content-length"));
  if (!(size > 0 && size <= MAX_ERROR_BODY_BYTES) || !response.headers.get("content-type")?.includes("json"))
    return error;
  const payload: unknown = await response
    .clone()
    .json()
    .catch(() => undefined);
  const body = payload && typeof payload === "object" && "error" in payload ? payload.error : undefined;
  if (!body || typeof body !== "object") return error;
  const code = identifier("code" in body ? body.code : "type" in body ? body.type : undefined);
  const param = identifier("param" in body ? body.param : undefined);
  if (code) error.code = code;
  if (param) error.param = param;
  return error;
}

/** Keeps only short identifier-like values; error messages and bodies can echo request content. */
function identifier(value: unknown): string | undefined {
  return typeof value === "string" && /^[\w.[\]-]{1,128}$/.test(value) ? value : undefined;
}
