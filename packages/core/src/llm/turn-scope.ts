// @summary Caller-owned resource scopes for provider stream state: per turn and per conversation

export interface StreamTurnResource<T> {
  value: T;
  dispose: () => void | Promise<void>;
}

export interface StreamResourceScope {
  getOrCreate<T>(key: symbol, create: () => StreamTurnResource<T>): T;
  dispose(): Promise<void>;
}

/** Provider resources that live as long as one logical conversation, across user turns. */
export type StreamSessionScope = StreamResourceScope;

export interface StreamTurnScope extends StreamResourceScope {
  readonly turnStateRef: { value: string | undefined };
  /** Conversation-lifetime scope owned by the session host; disposing the turn leaves it intact. */
  readonly session?: StreamSessionScope;
}

function createResourceScope(label: string): StreamResourceScope {
  const resources = new Map<symbol, StreamTurnResource<unknown>>();
  let disposePromise: Promise<void> | undefined;

  return {
    getOrCreate<T>(key: symbol, create: () => StreamTurnResource<T>): T {
      if (disposePromise) throw new Error(`${label} has been disposed`);
      const existing = resources.get(key);
      if (existing) return existing.value as T;
      const resource = create();
      resources.set(key, resource as StreamTurnResource<unknown>);
      return resource.value;
    },
    dispose(): Promise<void> {
      if (disposePromise) return disposePromise;
      disposePromise = (async () => {
        const errors: unknown[] = [];
        for (const resource of [...resources.values()].reverse()) {
          try {
            await resource.dispose();
          } catch (error) {
            errors.push(error);
          }
        }
        resources.clear();
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, `Failed to dispose ${label} resources`);
      })();
      return disposePromise;
    },
  };
}

export function createStreamSessionScope(): StreamSessionScope {
  return createResourceScope("Stream session scope");
}

export function createStreamTurnScope(options: { session?: StreamSessionScope } = {}): StreamTurnScope {
  const scope = createResourceScope("Stream turn scope");
  return {
    turnStateRef: { value: undefined },
    session: options.session,
    getOrCreate: scope.getOrCreate,
    dispose: scope.dispose,
  };
}
