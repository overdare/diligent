// @summary Routes DiligentClientRequest method names to server handler operations via a context interface

import { DILIGENT_CLIENT_REQUEST_METHODS, type DiligentClientRequest } from "../protocol/index";

/**
 * All operations the dispatch function needs from the app server.
 * Each method corresponds to one or more protocol request cases.
 * Implementations live in DiligentAppServer.buildDispatchContext().
 */
export interface ClientRequestDispatchContext {
  // ── Server identity ──────────────────────────────────────────────────────
  serverName: string;
  serverVersion: string;
  getInitializeExtra(): Promise<Record<string, unknown>>;

  // ── Thread lifecycle ─────────────────────────────────────────────────────
  startThread(params: Record<string, unknown>, connectionId: string): Promise<{ threadId: string }>;
  resumeThread(
    params: Record<string, unknown>,
    connectionId: string,
  ): Promise<{ found: boolean; threadId?: string; context?: unknown[] }>;
  listThreads(limit?: number, includeChildren?: boolean): Promise<unknown>;
  readThread(threadId?: string): Promise<unknown>;
  compactThread(threadId?: string): Promise<unknown>;
  deleteThread(threadId: string): Promise<{ deleted: boolean }>;

  // ── Turn operations ──────────────────────────────────────────────────────
  startTurn(params: Record<string, unknown>, connectionId: string): Promise<{ accepted: true }>;
  interruptTurn(threadId?: string): Promise<{ interrupted: boolean }>;
  steerTurn(
    threadId: string | undefined,
    content: string,
    attachments: unknown,
    followUp: boolean,
  ): Promise<{ queued: true }>;

  // ── Mode / effort / knowledge / tools ────────────────────────────────────
  setMode(threadId: string | undefined, mode: string): Promise<{ mode: string }>;
  setEffort(threadId: string | undefined, effort: string): Promise<{ effort: string }>;
  listKnowledge(threadId: string | undefined, limit?: number): Promise<{ data: unknown[] }>;
  updateKnowledge(threadId: string | undefined, params: Record<string, unknown>): Promise<unknown>;
  listTools(threadId?: string): Promise<unknown>;
  setTools(threadId: string | undefined, params: Record<string, unknown>): Promise<unknown>;

  // ── Subscriptions ────────────────────────────────────────────────────────
  subscribeToThread(connectionId: string, threadId: string): string;
  unsubscribeFromThread(subscriptionId: string): boolean;

  // ── Config / auth / upload ───────────────────────────────────────────────
  setConfig(params: Record<string, unknown>, connectionId: string): Promise<unknown>;
  listAuth(): Promise<unknown>;
  setAuth(params: Record<string, unknown>): Promise<unknown>;
  removeAuth(params: Record<string, unknown>): Promise<unknown>;
  startAuthOAuth(params: Record<string, unknown>): Promise<unknown>;
  uploadImage(params: Record<string, unknown>, connectionId: string): Promise<unknown>;
}

/**
 * Maps a validated DiligentClientRequest to the appropriate server operation.
 * All routing logic lives here; all implementation logic lives in the context.
 */
export async function dispatchClientRequest(
  ctx: ClientRequestDispatchContext,
  connectionId: string,
  request: DiligentClientRequest,
): Promise<unknown> {
  const p = request.params as Record<string, unknown>;

  switch (request.method) {
    case DILIGENT_CLIENT_REQUEST_METHODS.INITIALIZE: {
      if (request.params.protocolVersion !== 1) {
        throw Object.assign(
          new Error(
            `Unsupported protocolVersion: ${request.params.protocolVersion}. Only version 1 is supported.`,
          ),
          { code: -32602 },
        );
      }
      const extra = await ctx.getInitializeExtra();
      return {
        serverName: ctx.serverName,
        serverVersion: ctx.serverVersion,
        protocolVersion: 1,
        capabilities: { supportsFollowUp: true, supportsApprovals: true, supportsUserInput: true },
        ...extra,
      };
    }

    case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_START:
      return ctx.startThread(p, connectionId);

    case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_RESUME:
      return ctx.resumeThread(p, connectionId);

    case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_LIST:
      return ctx.listThreads(p.limit as number | undefined, p.includeChildren as boolean | undefined);

    case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ:
      return ctx.readThread(p.threadId as string | undefined);

    case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_COMPACT_START:
      return ctx.compactThread(p.threadId as string | undefined);

    case DILIGENT_CLIENT_REQUEST_METHODS.TURN_START:
      return ctx.startTurn(p, connectionId);

    case DILIGENT_CLIENT_REQUEST_METHODS.TURN_INTERRUPT:
      return ctx.interruptTurn(p.threadId as string | undefined);

    case DILIGENT_CLIENT_REQUEST_METHODS.TURN_STEER:
      return ctx.steerTurn(
        p.threadId as string | undefined,
        p.content as string,
        p.attachments,
        p.followUp as boolean,
      );

    case DILIGENT_CLIENT_REQUEST_METHODS.MODE_SET:
      return ctx.setMode(p.threadId as string | undefined, p.mode as string);

    case DILIGENT_CLIENT_REQUEST_METHODS.EFFORT_SET:
      return ctx.setEffort(p.threadId as string | undefined, p.effort as string);

    case DILIGENT_CLIENT_REQUEST_METHODS.KNOWLEDGE_LIST:
      return ctx.listKnowledge(p.threadId as string | undefined, p.limit as number | undefined);

    case DILIGENT_CLIENT_REQUEST_METHODS.KNOWLEDGE_UPDATE:
      return ctx.updateKnowledge(p.threadId as string | undefined, p);

    case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_DELETE:
      return ctx.deleteThread(p.threadId as string);

    case DILIGENT_CLIENT_REQUEST_METHODS.TOOLS_LIST:
      return ctx.listTools(p.threadId as string | undefined);

    case DILIGENT_CLIENT_REQUEST_METHODS.TOOLS_SET:
      return ctx.setTools(p.threadId as string | undefined, p);

    case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_SUBSCRIBE: {
      const subscriptionId = ctx.subscribeToThread(connectionId, p.threadId as string);
      return { subscriptionId };
    }

    case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_UNSUBSCRIBE: {
      const ok = ctx.unsubscribeFromThread(p.subscriptionId as string);
      return { ok };
    }

    case DILIGENT_CLIENT_REQUEST_METHODS.CONFIG_SET:
      return ctx.setConfig(p, connectionId);

    case DILIGENT_CLIENT_REQUEST_METHODS.AUTH_LIST:
      return ctx.listAuth();

    case DILIGENT_CLIENT_REQUEST_METHODS.AUTH_SET:
      return ctx.setAuth(p);

    case DILIGENT_CLIENT_REQUEST_METHODS.AUTH_REMOVE:
      return ctx.removeAuth(p);

    case DILIGENT_CLIENT_REQUEST_METHODS.AUTH_OAUTH_START:
      return ctx.startAuthOAuth(p);

    case DILIGENT_CLIENT_REQUEST_METHODS.IMAGE_UPLOAD:
      return ctx.uploadImage(p, connectionId);
  }
}
