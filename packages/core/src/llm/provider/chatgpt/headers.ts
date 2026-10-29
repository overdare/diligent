// @summary Canonical ChatGPT HTTP header names and pinned client version shared by streaming and compaction requests

export const CHATGPT_SESSION_HEADER = "session-id";

// Codex rejects GPT-6.1 Sol and Terra with `model_not_found` below 0.159.0. Pinned to the latest stable Codex CLI
// release (0.165.0), which live requests accept for every ChatGPT catalog model.
export const CHATGPT_CODEX_CLIENT_VERSION = "0.165.0";
