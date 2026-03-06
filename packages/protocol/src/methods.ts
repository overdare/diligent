// @summary Method constants for Diligent v1 protocol (shared by TUI and future web)
export const DILIGENT_CLIENT_REQUEST_METHODS = {
  INITIALIZE: "initialize",
  THREAD_START: "thread/start",
  THREAD_RESUME: "thread/resume",
  THREAD_LIST: "thread/list",
  THREAD_READ: "thread/read",
  TURN_START: "turn/start",
  TURN_INTERRUPT: "turn/interrupt",
  TURN_STEER: "turn/steer",
  MODE_SET: "mode/set",
  EFFORT_SET: "effort/set",
  KNOWLEDGE_LIST: "knowledge/list",
  THREAD_DELETE: "thread/delete",
} as const;

export type DiligentClientRequestMethod =
  (typeof DILIGENT_CLIENT_REQUEST_METHODS)[keyof typeof DILIGENT_CLIENT_REQUEST_METHODS];

export const DILIGENT_CLIENT_NOTIFICATION_METHODS = {
  INITIALIZED: "initialized",
} as const;

export type DiligentClientNotificationMethod =
  (typeof DILIGENT_CLIENT_NOTIFICATION_METHODS)[keyof typeof DILIGENT_CLIENT_NOTIFICATION_METHODS];

export const DILIGENT_SERVER_NOTIFICATION_METHODS = {
  THREAD_STARTED: "thread/started",
  THREAD_RESUMED: "thread/resumed",
  THREAD_STATUS_CHANGED: "thread/status/changed",
  TURN_STARTED: "turn/started",
  ITEM_STARTED: "item/started",
  ITEM_DELTA: "item/delta",
  ITEM_COMPLETED: "item/completed",
  TURN_COMPLETED: "turn/completed",
  TURN_INTERRUPTED: "turn/interrupted",
  KNOWLEDGE_SAVED: "knowledge/saved",
  LOOP_DETECTED: "loop/detected",
  ERROR: "error",
  USAGE_UPDATED: "usage/updated",
  ACCOUNT_LOGIN_COMPLETED: "account/login/completed",
  ACCOUNT_UPDATED: "account/updated",
  COLLAB_SPAWN_BEGIN: "collab/spawn/begin",
  COLLAB_SPAWN_END: "collab/spawn/end",
  COLLAB_WAIT_BEGIN: "collab/wait/begin",
  COLLAB_WAIT_END: "collab/wait/end",
  COLLAB_CLOSE_BEGIN: "collab/close/begin",
  COLLAB_CLOSE_END: "collab/close/end",
  COLLAB_INTERACTION_BEGIN: "collab/interaction/begin",
  COLLAB_INTERACTION_END: "collab/interaction/end",
  STEERING_INJECTED: "steering/injected",
} as const;

export type DiligentServerNotificationMethod =
  (typeof DILIGENT_SERVER_NOTIFICATION_METHODS)[keyof typeof DILIGENT_SERVER_NOTIFICATION_METHODS];

export const DILIGENT_SERVER_REQUEST_METHODS = {
  APPROVAL_REQUEST: "approval/request",
  USER_INPUT_REQUEST: "userInput/request",
} as const;

export type DiligentServerRequestMethod =
  (typeof DILIGENT_SERVER_REQUEST_METHODS)[keyof typeof DILIGENT_SERVER_REQUEST_METHODS];

export const DILIGENT_WEB_REQUEST_METHODS = {
  CONFIG_SET: "config/set",
  AUTH_LIST: "auth/list",
  AUTH_SET: "auth/set",
  AUTH_REMOVE: "auth/remove",
  AUTH_OAUTH_START: "auth/oauth/start",
  THREAD_SUBSCRIBE: "thread/subscribe",
  THREAD_UNSUBSCRIBE: "thread/unsubscribe",
} as const;

export type DiligentWebRequestMethod = (typeof DILIGENT_WEB_REQUEST_METHODS)[keyof typeof DILIGENT_WEB_REQUEST_METHODS];
