// @summary Desktop-only OS notification helpers for background turn completion and pending prompts

import type { DiligentServerNotification, DiligentServerRequest } from "@diligent/protocol";
import { DILIGENT_SERVER_NOTIFICATION_METHODS, DILIGENT_SERVER_REQUEST_METHODS } from "@diligent/protocol";
import { APP_PROJECT_NAME } from "./app-config";

type NotificationPermission = "default" | "denied" | "granted";

type NotificationApi = {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<NotificationPermission>;
  sendNotification: (options: { title: string; body: string; extra?: Record<string, unknown> }) => Promise<void>;
  onAction: (
    callback: (notification: { extra?: Record<string, unknown> }) => void,
  ) => Promise<{ unregister: () => void }>;
};

type NotificationEnvironment = {
  isDesktop: () => boolean;
  isBackgrounded: () => boolean;
  createApi: () => Promise<NotificationApi | null>;
};

type NotifyPayload = {
  title: string;
  body: string;
  dedupeKey: string;
  extra?: Record<string, unknown>;
};

const REQUEST_DEDUPE_TTL_MS = 30_000;
const NOTIFICATION_THREAD_ID_KEY = "threadId";
export const DESKTOP_NOTIFICATIONS_STORAGE_KEY = "diligent.desktopNotifications.enabled";

function hasDesktopTauri(): boolean {
  return typeof window !== "undefined" && typeof (window as Window & { __TAURI__?: unknown }).__TAURI__ !== "undefined";
}

function isAppBackgrounded(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return document.visibilityState !== "visible" || !document.hasFocus();
}

async function createTauriNotificationApi(): Promise<NotificationApi | null> {
  if (!hasDesktopTauri()) {
    return null;
  }
  const plugin = await import("@tauri-apps/plugin-notification");
  return {
    isPermissionGranted: plugin.isPermissionGranted,
    requestPermission: plugin.requestPermission,
    sendNotification: async ({ title, body, extra }) => {
      await plugin.sendNotification({ title, body, extra });
    },
    onAction: async (callback) => plugin.onAction(callback),
  };
}

function buildTurnCompletedPayload(notification: DiligentServerNotification): NotifyPayload | null {
  if (notification.method !== DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED) {
    return null;
  }
  return {
    title: APP_PROJECT_NAME,
    body: "A background conversation finished.",
    dedupeKey: `turn-completed:${notification.params.threadId}:${notification.params.turnId}`,
    extra: { [NOTIFICATION_THREAD_ID_KEY]: notification.params.threadId },
  };
}

function buildServerRequestPayload(requestId: number, request: DiligentServerRequest): NotifyPayload | null {
  if (request.method === DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST) {
    return {
      title: APP_PROJECT_NAME,
      body: `Approval needed for ${request.params.request.toolName}.`,
      dedupeKey: `server-request:${requestId}:approval`,
      extra: { [NOTIFICATION_THREAD_ID_KEY]: request.params.threadId },
    };
  }
  if (request.method === DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST) {
    const questionCount = request.params.request.questions.length;
    return {
      title: APP_PROJECT_NAME,
      body: questionCount === 1 ? "Input needed for 1 question." : `Input needed for ${questionCount} questions.`,
      dedupeKey: `server-request:${requestId}:user-input`,
      extra: { [NOTIFICATION_THREAD_ID_KEY]: request.params.threadId },
    };
  }
  return null;
}

function readThreadIdFromExtra(extra: Record<string, unknown> | undefined): string | null {
  const threadId = extra?.[NOTIFICATION_THREAD_ID_KEY];
  return typeof threadId === "string" && threadId.length > 0 ? threadId : null;
}

export function readDesktopNotificationsEnabled(): boolean {
  if (typeof localStorage === "undefined") {
    return true;
  }
  return localStorage.getItem(DESKTOP_NOTIFICATIONS_STORAGE_KEY) !== "false";
}

export function writeDesktopNotificationsEnabled(enabled: boolean): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(DESKTOP_NOTIFICATIONS_STORAGE_KEY, enabled ? "true" : "false");
}

export class DesktopNotificationController {
  private readonly recentKeys = new Map<string, number>();
  private permissionRequested = false;
  private enabled = readDesktopNotificationsEnabled();
  private actionListenerRegistered = false;

  constructor(
    private readonly environment: NotificationEnvironment = {
      isDesktop: hasDesktopTauri,
      isBackgrounded: isAppBackgrounded,
      createApi: createTauriNotificationApi,
    },
  ) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    writeDesktopNotificationsEnabled(enabled);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async attachActionHandler(onOpenThread: (threadId: string) => void): Promise<void> {
    if (this.actionListenerRegistered || !this.environment.isDesktop()) {
      return;
    }
    const api = await this.environment.createApi();
    if (!api) {
      return;
    }
    this.actionListenerRegistered = true;
    await api.onAction((notification) => {
      const threadId = readThreadIdFromExtra(notification.extra);
      if (!threadId) {
        return;
      }
      if (typeof window !== "undefined") {
        window.focus();
      }
      onOpenThread(threadId);
    });
  }

  async notifyForNotification(notification: DiligentServerNotification): Promise<void> {
    const payload = buildTurnCompletedPayload(notification);
    await this.notify(payload);
  }

  async notifyForServerRequest(requestId: number, request: DiligentServerRequest): Promise<void> {
    const payload = buildServerRequestPayload(requestId, request);
    await this.notify(payload);
  }

  private async notify(payload: NotifyPayload | null): Promise<void> {
    if (!payload) {
      return;
    }
    if (!this.enabled) {
      return;
    }
    if (!this.environment.isDesktop() || !this.environment.isBackgrounded()) {
      return;
    }
    this.pruneRecentKeys();
    if (this.recentKeys.has(payload.dedupeKey)) {
      return;
    }

    const api = await this.environment.createApi();
    if (!api) {
      return;
    }

    const granted = await this.ensurePermission(api);
    if (!granted) {
      return;
    }

    await api.sendNotification({ title: payload.title, body: payload.body, extra: payload.extra });
    this.recentKeys.set(payload.dedupeKey, Date.now());
  }

  private async ensurePermission(api: NotificationApi): Promise<boolean> {
    if (await api.isPermissionGranted()) {
      return true;
    }
    if (this.permissionRequested) {
      return false;
    }
    this.permissionRequested = true;
    return (await api.requestPermission()) === "granted";
  }

  private pruneRecentKeys(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.recentKeys) {
      if (now - timestamp > REQUEST_DEDUPE_TTL_MS) {
        this.recentKeys.delete(key);
      }
    }
  }
}

export function createDesktopNotificationController(): DesktopNotificationController {
  return new DesktopNotificationController();
}
