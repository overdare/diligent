// @summary Canonical ChatGPT HTTP header names and pinned client version shared by streaming and compaction requests

export const CHATGPT_SESSION_HEADER = "session-id";

// Must be >= the highest minimal_client_version we send: gpt-6-sol and gpt-6-luna require 0.155.0.
export const CHATGPT_CODEX_CLIENT_VERSION = "0.155.0";
