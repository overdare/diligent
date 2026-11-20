// @summary Canonical ChatGPT HTTP header names and pinned client version shared by streaming and compaction requests

export const CHATGPT_SESSION_HEADER = "session-id";

// GPT-6.2 Astra and Sol return model_not_found with 0.165.0 and accept 0.167.0.
export const CHATGPT_CODEX_CLIENT_VERSION = "0.167.0";
