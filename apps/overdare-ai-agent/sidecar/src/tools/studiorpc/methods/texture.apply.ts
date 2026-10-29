// @summary Publishes and atomically binds a prepared native albedo with retry identity.
import { z } from "zod";
import { suppliedImage } from "./texture-plan";

export const method = "texture.apply";
export const timeoutMs = 300_000;
export const description =
  "Compose, publish and apply a prepared albedo. Supply missing imageKey files readable by Studio " +
  "or published image asset ids; pure painting needs no images. Studio owns source persistence, publishing to " +
  "ovdrassetid://, conflict checks, Undo and saving. Keep the same requestId and arguments after timeout to recover " +
  "the operation instead of publishing twice. Inspect status; applied_save_failed means the binding exists and " +
  "the same request retries saving. No model or prompt configuration belongs in this call.";
export const params = z
  .object({
    targetGuid: z.string().min(1),
    prepareId: z.string().min(1),
    targetRevision: z.string().min(1),
    images: z.record(z.string().min(1), suppliedImage).optional(),
    requestId: z.string().min(1).max(128),
  })
  .strict();
