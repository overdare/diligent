// @summary Registry mapping each model capability to its runtime probe task

import type { ModelCapability } from "../../capabilities";
import type { AnyRuntimeEvalTask } from "../../runtime-task";
import { basicResponseCapabilityTask } from "./basic-response";
import { compactionCapabilityTask } from "./compaction";
import { imageGenerationCapabilityTask } from "./image-generation";
import { imageReadCapabilityTask } from "./image-read";
import { webSearchCapabilityTask } from "./web-search";

export const CAPABILITY_TASKS: Readonly<Record<ModelCapability, AnyRuntimeEvalTask>> = {
  basic_response: basicResponseCapabilityTask,
  web_search: webSearchCapabilityTask,
  image_read: imageReadCapabilityTask,
  image_generation: imageGenerationCapabilityTask,
  compaction: compactionCapabilityTask,
};
