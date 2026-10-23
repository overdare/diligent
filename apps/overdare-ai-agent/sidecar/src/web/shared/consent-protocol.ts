// @summary Web-owned consent RPC schemas and backend contract for the OVERDARE product surface

import { z } from "zod";

export const WEB_CONSENT_SET_METHOD = "consent/set";
/** Resolves once the backend has synced with its source of truth; `initialize` never waits for it. */
export const WEB_CONSENT_GET_METHOD = "consent/get";

export const ConsentStateSchema = z.object({
  noticeAcknowledged: z.boolean(),
  serviceImprovement: z.boolean(),
  privacyPolicyUrl: z.string(),
});
export type ConsentState = z.infer<typeof ConsentStateSchema>;

export const ConsentSetParamsSchema = z.object({
  noticeAcknowledged: z.boolean().optional(),
  serviceImprovement: z.boolean().optional(),
});
export type ConsentSetParams = z.infer<typeof ConsentSetParamsSchema>;

export interface WebConsentBackend {
  get(): ConsentState;
  refresh?(): Promise<void>;
  /** False until the first `refresh` settles; `get()` is only a placeholder before then. */
  isLoaded?(): boolean;
  set(params: ConsentSetParams): ConsentState | Promise<ConsentState>;
}
