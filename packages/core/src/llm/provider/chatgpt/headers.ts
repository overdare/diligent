// @summary Canonical ChatGPT HTTP header names and pinned client version shared by streaming and compaction requests

export const CHATGPT_SESSION_HEADER = "session-id";

// GPT-6.1 Sol live requests succeed with 0.159.0; the older 0.155.0 header rejects the model.
export const CHATGPT_CODEX_CLIENT_VERSION = "0.159.0";
