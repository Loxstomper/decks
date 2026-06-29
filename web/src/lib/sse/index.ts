/**
 * web/src/lib/sse/index.ts — SSE client for the /events endpoint.
 *
 * WHY THIS EXISTS (spec 11, spec 01):
 * =====================================
 * The Go backend uses fsnotify to watch deck folders and broadcasts
 * `{"deck":"<name>","type":"changed"}` events over Server-Sent Events when an
 * external write occurs (e.g. Claude Code edits a deck.html). The Svelte editor
 * must re-parse the deck after such an external change — but only when it is not
 * mid-gesture or dirty (turn-taking, spec 11 §4).
 *
 * This module provides:
 *   • A plain-TS SSE client that opens an EventSource on /events.
 *   • A reactive connection-state store (connecting | open | closed) — so the
 *     status indicator (spec 11 §5) can show "synced / external change / unsaved".
 *   • A reactive lastEvent store — holds the most recent DeckChangedEvent.
 *   • onDeckChanged(deckName, handler) — targeted subscription for a single deck
 *     (pass null to receive all deck change events).
 *   • close() — clean teardown: closes EventSource, drains all subscriptions.
 *
 * EventSource auto-reconnects on network error; the state store surfaces
 * 'connecting' during reconnection so the UI can show a reconnecting badge.
 *
 * The store API follows the Svelte readable-store contract (subscribe returns
 * an unsubscribe function, called synchronously with the current value) so it
 * can be used directly in `$store` template syntax or with `derived`.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

/** Connection lifecycle state of the EventSource. */
export type ConnectionState = 'connecting' | 'open' | 'closed';

/**
 * A filesystem-level change event emitted by the Go backend (watch.Event).
 * The backend always sends type="changed"; future types may be added.
 */
export interface DeckChangedEvent {
  deck: string;
  type: string;
}

/** Svelte-compatible readable store: subscribe fires immediately with current value. */
export interface Readable<T> {
  subscribe(run: (value: T) => void): () => void;
}

/** The public interface returned by createSseClient. */
export interface SseClient {
  /**
   * Reactive store of the current SSE connection state.
   * 'connecting' — initial state or auto-reconnecting after an error.
   * 'open'       — connection established, events flowing.
   * 'closed'     — close() has been called; no further events will fire.
   */
  state: Readable<ConnectionState>;

  /**
   * Reactive store of the most recent DeckChangedEvent received, or null
   * before the first event arrives.  Components can $-subscribe to this to
   * react to any external deck write.
   */
  lastEvent: Readable<DeckChangedEvent | null>;

  /**
   * Register a handler for external changes to a specific deck.
   *
   * @param deckName  The deck name to filter on, or null to receive all decks.
   * @param handler   Called whenever a matching "changed" event arrives.
   * @returns         An unsubscribe function — call it to remove the handler.
   *
   * WHY filter by deck name: the app may have one deck open; it should only
   * trigger a re-parse for *that* deck, not for unrelated deck writes.
   */
  onDeckChanged(
    deckName: string | null,
    handler: (event: DeckChangedEvent) => void,
  ): () => void;

  /**
   * Close the EventSource and remove all subscriptions.
   * After close(), state transitions to 'closed' and no further events fire.
   * Idempotent: safe to call multiple times.
   */
  close(): void;
}

// ──────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Minimal reactive store — satisfies the Svelte readable contract without
 * importing from Svelte itself (keeps this module usable in plain TS / tests).
 *
 * Invariant: every subscriber is called synchronously with the current value
 * on subscribe(), and again on every set() call.
 */
function makeStore<T>(initial: T): { store: Readable<T>; set(v: T): void } {
  let current = initial;
  // Use a Map (insertion-ordered) so unsubscription is O(1).
  const subs = new Map<symbol, (v: T) => void>();

  const set = (v: T): void => {
    current = v;
    for (const fn of subs.values()) fn(v);
  };

  const store: Readable<T> = {
    subscribe(run) {
      const key = Symbol();
      subs.set(key, run);
      // Fire immediately with the current value (Svelte store contract).
      run(current);
      return () => {
        subs.delete(key);
      };
    },
  };

  return { store, set };
}

// ──────────────────────────────────────────────────────────────────────────────
// createSseClient
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Create and connect an SSE client to the given URL (default: '/events').
 *
 * Call the returned client's close() when the component/app unmounts.
 *
 * @param url  SSE endpoint — defaults to '/events' (Go backend route).
 */
export function createSseClient(url = '/events'): SseClient {
  const { store: stateStore, set: setState } = makeStore<ConnectionState>('connecting');
  const { store: lastEventStore, set: setLastEvent } = makeStore<DeckChangedEvent | null>(null);

  // deck-name → Set of handlers.  null key = "all decks".
  const deckHandlers = new Map<string | null, Set<(ev: DeckChangedEvent) => void>>();

  let es: EventSource | null = new EventSource(url);
  let closed = false;

  // ── dispatch helpers ──────────────────────────────────────────────────────

  function dispatch(event: DeckChangedEvent): void {
    // Update the reactive last-event store first so $-bindings see it before
    // named handlers run (consistent ordering for all consumers).
    setLastEvent(event);

    // Fire handlers registered for this exact deck name.
    const named = deckHandlers.get(event.deck);
    if (named) {
      for (const fn of named) fn(event);
    }

    // Fire wildcard handlers (registered with deckName=null).
    const wildcards = deckHandlers.get(null);
    if (wildcards) {
      for (const fn of wildcards) fn(event);
    }
  }

  // ── EventSource wiring ────────────────────────────────────────────────────

  function attach(source: EventSource): void {
    source.onopen = () => {
      if (!closed) setState('open');
    };

    source.onmessage = (msgEvent: MessageEvent) => {
      if (closed) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(msgEvent.data as string);
      } catch {
        // Malformed JSON from the server — ignore and keep the connection.
        // The Go backend only sends valid JSON; this guards against partial
        // frames or future protocol errors.
        return;
      }

      // Type-guard: the event must have at minimum {deck: string, type: string}.
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as Record<string, unknown>).deck === 'string' &&
        typeof (parsed as Record<string, unknown>).type === 'string'
      ) {
        dispatch(parsed as DeckChangedEvent);
      }
    };

    // onerror fires both for recoverable errors (auto-reconnect pending) and
    // for permanent closes.  We surface 'connecting' during reconnection so
    // the UI badge can show "reconnecting…" rather than a confusing open/closed
    // flicker.  The 'closed' state is only set by our own close() call.
    source.onerror = () => {
      if (!closed) setState('connecting');
    };
  }

  attach(es);

  // ── Public API ────────────────────────────────────────────────────────────

  function onDeckChanged(
    deckName: string | null,
    handler: (ev: DeckChangedEvent) => void,
  ): () => void {
    let handlers = deckHandlers.get(deckName);
    if (!handlers) {
      handlers = new Set();
      deckHandlers.set(deckName, handlers);
    }
    handlers.add(handler);

    return () => {
      handlers!.delete(handler);
      if (handlers!.size === 0) {
        deckHandlers.delete(deckName);
      }
    };
  }

  function close(): void {
    if (closed) return; // idempotent
    closed = true;
    if (es) {
      es.close();
      es = null;
    }
    deckHandlers.clear();
    setState('closed');
  }

  return {
    state: stateStore,
    lastEvent: lastEventStore,
    onDeckChanged,
    close,
  };
}
