// @summary Registry for all runtime eval tasks and the capability-tagged tasks of the model matrix

import { MODEL_CAPABILITIES } from "../../capabilities";
import type { AnyRuntimeEvalTask } from "../../runtime-task";
import { autoCompactionResumeTask } from "./auto-compaction-resume";
import { autonomousExploreDelegationTask } from "./autonomous-explore-delegation";
import { basicResponseTask } from "./basic-response";
import { bundledToolRoutingTask } from "./bundled-tool-routing";
import { clarifyThenExecuteTask } from "./clarify-then-execute";
import { collaborationParallelSynthesisTask } from "./collaboration-parallel-synthesis";
import { collaborationResumeReferenceTask } from "./collaboration-resume-reference";
import { crossFileContractFixTask } from "./cross-file-contract-fix";
import { customAgentRoutingTask } from "./custom-agent-routing";
import { fileRoundtripTask } from "./file-roundtrip";
import { freshPromptAfterCompactionTask } from "./fresh-prompt-after-compaction";
import { hookContextFollowTask } from "./hook-context-follow";
import { imageGenerationOutputTask } from "./image-generation-output";
import { imageResumeRecallTask } from "./image-resume-recall";
import { inputCancelResumeTask } from "./input-cancel-resume";
import { instructionHierarchyTask } from "./instruction-hierarchy";
import { largeOutputRecoveryTask } from "./large-output-recovery";
import { loopContextAdaptationTask } from "./loop-context-adaptation";
import { manualCompactionResumeTask } from "./manual-compaction-resume";
import { mcpLazyToolTask } from "./mcp-lazy-tool";
import { mcpNeedsAuthAbstainTask } from "./mcp-needs-auth-abstain";
import { mcpPromptGroundingTask } from "./mcp-prompt-grounding";
import { mcpResourceGroundingTask } from "./mcp-resource-grounding";
import { memoryForgetTask } from "./memory-forget";
import { memoryIntentSplitTask } from "./memory-intent-split";
import { memoryRecallTask } from "./memory-recall";
import { planConvergeTask } from "./plan-converge";
import { planProgressTask } from "./plan-progress";
import { planReadonlyTask } from "./plan-readonly";
import { planToExecuteTask } from "./plan-to-execute";
import { projectFixTask } from "./project-fix";
import { readImagePairTask } from "./read-image-pair";
import { sessionResumeTask } from "./session-resume";
import { skillAbstainTask } from "./skill-abstain";
import { skillAutoSelectTask } from "./skill-auto-select";
import { steerDuringFixTask } from "./steer-during-fix";
import { webSearchGroundingTask } from "./web-search-grounding";

export type { AutoCompactionResumeWorld } from "./auto-compaction-resume";
export { autoCompactionResumeTask } from "./auto-compaction-resume";
export type { AutonomousExploreDelegationWorld } from "./autonomous-explore-delegation";
export { autonomousExploreDelegationTask } from "./autonomous-explore-delegation";
export type { BasicResponseWorld } from "./basic-response";
export { basicResponseTask } from "./basic-response";
export type { BundledToolRoutingWorld } from "./bundled-tool-routing";
export { bundledToolRoutingTask } from "./bundled-tool-routing";
export type { ClarifyThenExecuteWorld } from "./clarify-then-execute";
export { clarifyThenExecuteTask } from "./clarify-then-execute";
export type { CollaborationParallelSynthesisWorld } from "./collaboration-parallel-synthesis";
export { collaborationParallelSynthesisTask } from "./collaboration-parallel-synthesis";
export type { CollaborationResumeReferenceWorld } from "./collaboration-resume-reference";
export { collaborationResumeReferenceTask } from "./collaboration-resume-reference";
export type { CrossFileContractFixWorld } from "./cross-file-contract-fix";
export { crossFileContractFixTask } from "./cross-file-contract-fix";
export type { CustomAgentRoutingWorld } from "./custom-agent-routing";
export { customAgentRoutingTask } from "./custom-agent-routing";
export type { FileRoundtripWorld } from "./file-roundtrip";
export { fileRoundtripTask } from "./file-roundtrip";
export type { FreshPromptAfterCompactionWorld } from "./fresh-prompt-after-compaction";
export { freshPromptAfterCompactionTask } from "./fresh-prompt-after-compaction";
export type { HookContextFollowWorld } from "./hook-context-follow";
export { hookContextFollowTask } from "./hook-context-follow";
export type { GeneratedImageRecord, ImageGenerationOutputWorld } from "./image-generation-output";
export { dominantColor, IMAGE_GENERATION_TOOL, imageGenerationOutputTask } from "./image-generation-output";
export type { ImageResumeRecallWorld } from "./image-resume-recall";
export { imageResumeRecallTask } from "./image-resume-recall";
export type { InputCancelResumeWorld } from "./input-cancel-resume";
export { inputCancelResumeTask } from "./input-cancel-resume";
export type { InstructionHierarchyWorld } from "./instruction-hierarchy";
export { instructionHierarchyTask } from "./instruction-hierarchy";
export type { LargeOutputRecoveryWorld } from "./large-output-recovery";
export { largeOutputRecoveryTask } from "./large-output-recovery";
export type { LoopContextAdaptationWorld } from "./loop-context-adaptation";
export { loopContextAdaptationTask } from "./loop-context-adaptation";
export type { ManualCompactionResumeWorld } from "./manual-compaction-resume";
export { manualCompactionResumeTask } from "./manual-compaction-resume";
export type { McpLazyToolWorld } from "./mcp-lazy-tool";
export { mcpLazyToolTask } from "./mcp-lazy-tool";
export type { McpNeedsAuthAbstainWorld } from "./mcp-needs-auth-abstain";
export { mcpNeedsAuthAbstainTask } from "./mcp-needs-auth-abstain";
export type { McpPromptGroundingWorld } from "./mcp-prompt-grounding";
export { mcpPromptGroundingTask } from "./mcp-prompt-grounding";
export type { McpResourceGroundingWorld } from "./mcp-resource-grounding";
export { mcpResourceGroundingTask } from "./mcp-resource-grounding";
export type { MemoryForgetWorld } from "./memory-forget";
export { memoryForgetTask } from "./memory-forget";
export type { MemoryIntentSplitWorld } from "./memory-intent-split";
export { memoryIntentSplitTask } from "./memory-intent-split";
export type { MemoryRecallWorld } from "./memory-recall";
export { memoryRecallTask } from "./memory-recall";
export type { PlanConvergeWorld } from "./plan-converge";
export { planConvergeTask } from "./plan-converge";
export type { PlanProgressWorld } from "./plan-progress";
export { planProgressTask } from "./plan-progress";
export type { PlanToExecuteWorld } from "./plan-to-execute";
export { planToExecuteTask } from "./plan-to-execute";
export type { ReadImagePairWorld } from "./read-image-pair";
export { readImagePairTask } from "./read-image-pair";
export type { SkillAbstainWorld } from "./skill-abstain";
export { skillAbstainTask } from "./skill-abstain";
export type { SkillAutoSelectWorld } from "./skill-auto-select";
export { skillAutoSelectTask } from "./skill-auto-select";
export type { SteerDuringFixWorld } from "./steer-during-fix";
export { steerDuringFixTask } from "./steer-during-fix";
export type { WebSearchEvidence, WebSearchGroundingWorld } from "./web-search-grounding";
export {
  collectWebSearchEvidence,
  extractUrlHosts,
  webResultHosts,
  webSearchGroundingTask,
} from "./web-search-grounding";

export const RUNTIME_EVAL_TASKS: readonly AnyRuntimeEvalTask[] = [
  projectFixTask,
  planReadonlyTask,
  sessionResumeTask,
  planToExecuteTask,
  memoryRecallTask,
  manualCompactionResumeTask,
  clarifyThenExecuteTask,
  readImagePairTask,
  fileRoundtripTask,
  instructionHierarchyTask,
  planConvergeTask,
  crossFileContractFixTask,
  planProgressTask,
  hookContextFollowTask,
  skillAutoSelectTask,
  skillAbstainTask,
  memoryIntentSplitTask,
  memoryForgetTask,
  steerDuringFixTask,
  autoCompactionResumeTask,
  autonomousExploreDelegationTask,
  freshPromptAfterCompactionTask,
  imageResumeRecallTask,
  inputCancelResumeTask,
  loopContextAdaptationTask,
  largeOutputRecoveryTask,
  bundledToolRoutingTask,
  mcpLazyToolTask,
  mcpNeedsAuthAbstainTask,
  mcpResourceGroundingTask,
  mcpPromptGroundingTask,
  customAgentRoutingTask,
  collaborationParallelSynthesisTask,
  collaborationResumeReferenceTask,
];

/** Capability probes that are not part of the default runtime run. */
export const RUNTIME_PROBE_TASKS: readonly AnyRuntimeEvalTask[] = [
  basicResponseTask,
  webSearchGroundingTask,
  imageGenerationOutputTask,
];

/** One capability-tagged task per model capability, in `MODEL_CAPABILITIES` order. */
export const RUNTIME_CAPABILITY_TASKS: readonly AnyRuntimeEvalTask[] = MODEL_CAPABILITIES.map((capability) => {
  const task = [...RUNTIME_EVAL_TASKS, ...RUNTIME_PROBE_TASKS].find((candidate) => candidate.capability === capability);
  if (!task) throw new Error(`No runtime task checks capability ${capability}.`);
  return task;
});
