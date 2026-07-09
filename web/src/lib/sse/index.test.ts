/**
 * index.test.ts — Unit tests for the SSE client (P1-9).
 *
 * WHY THESE TESTS MATTER:
 * The SSE client is the sole path for external-change awareness in the editor
 * (spec claude-code-integration turn-taking).  Bugs here would silently break the Claude Code ↔
 * editor handoff — the editor would never see external file changes.
 *
 * Coverage:
 *  1. EventSource is opened on the correct URL.
 *  2. Connection state progresses: connecting → open → closed.
 *  3. State transitions to 'connecting' on error (reconnection window).
 *  4. A valid data event is parsed and dispatched to lastEvent.
 *  5. onDeckChanged(name) fires for matching deck, not for others.
 *  6. onDeckChanged(null) fires for all decks (wildcard).
 *  7. Unsubscribe prevents further handler calls.
 *  8. Malformed JSON data is silently ignored.
 *  9. Data with missing/wrong-typed fields is silently ignored.
 * 10. close() shuts down the EventSource and emits 'closed' state.
 * 11. close() is idempotent (safe to call twice).
 * 12. close() prevents late dispatch of in-flight events.
 * 13. Multiple simultaneous handlers for the same deck name all fire.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSseClient } from './index.js';
import type { ConnectionState, DeckChangedEvent } from './index.js';

// ──────────────────────────────────────────────────────────────────────────────
// EventSource mock
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Minimal EventSource mock: captures open/message/error handlers so tests can
 * trigger them synchronously, mimicking real browser EventSource callbacks.
 *
 * WHY a manual mock rather than a library: the test environment is 'node',
 * which has no EventSource global.  A thin hand-rolled mock keeps the test
 * suite self-contained and avoids DOM polyfill overhead.
 */
class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  readyState: number = 0; // 0=CONNECTING, 1=OPEN, 2=CLOSED

  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() {
    this.readyState = 2;
  }

  // ── Test helpers ─────────────────────────────────────────────────────────

  /** Simulate a successful connection. */
  simulateOpen() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  /** Simulate a `data:` message with the given JSON payload. */
  simulateMessage(data: unknown) {
    const json = typeof data === 'string' ? data : JSON.stringify(data);
    this.onmessage?.(new MessageEvent('message', { data: json }));
  }

  /** Simulate a network error (EventSource will auto-reconnect in browsers). */
  simulateError() {
    this.onerror?.(new Event('error'));
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ──────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal('EventSource', MockEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Grab the most recently constructed MockEventSource. */
function lastEs(): MockEventSource {
  const es = MockEventSource.instances.at(-1);
  if (!es) throw new Error('No MockEventSource was constructed');
  return es;
}

/** Collect emitted values from a readable store into an array. */
function collect<T>(store: { subscribe(fn: (v: T) => void): () => void }): {
  values: T[];
  stop: () => void;
} {
  const values: T[] = [];
  const stop = store.subscribe((v) => values.push(v));
  return { values, stop };
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. EventSource URL
// ──────────────────────────────────────────────────────────────────────────────

describe('EventSource URL', () => {
  it('opens on /events by default', () => {
    const client = createSseClient();
    expect(lastEs().url).toBe('/events');
    client.close();
  });

  it('accepts a custom URL', () => {
    const client = createSseClient('/custom/events');
    expect(lastEs().url).toBe('/custom/events');
    client.close();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. Connection state progression
// ──────────────────────────────────────────────────────────────────────────────

describe('connection state', () => {
  it('starts as connecting', () => {
    const client = createSseClient();
    const { values, stop } = collect<ConnectionState>(client.state);
    expect(values).toEqual(['connecting']);
    stop();
    client.close();
  });

  it('transitions to open when EventSource fires onopen', () => {
    const client = createSseClient();
    const { values, stop } = collect<ConnectionState>(client.state);

    lastEs().simulateOpen();

    expect(values).toEqual(['connecting', 'open']);
    stop();
    client.close();
  });

  it('transitions to closed when close() is called', () => {
    const client = createSseClient();
    const { values, stop } = collect<ConnectionState>(client.state);

    lastEs().simulateOpen();
    client.close();

    expect(values).toEqual(['connecting', 'open', 'closed']);
    stop();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. Error → reconnecting
// ──────────────────────────────────────────────────────────────────────────────

describe('reconnection state on error', () => {
  it('goes back to connecting on onerror (auto-reconnect window)', () => {
    const client = createSseClient();
    const { values, stop } = collect<ConnectionState>(client.state);

    lastEs().simulateOpen();
    lastEs().simulateError();

    // connecting → open → connecting (reconnecting)
    expect(values).toEqual(['connecting', 'open', 'connecting']);
    stop();
    client.close();
  });

  it('does not change state to connecting after close() has been called', () => {
    const client = createSseClient();
    const { values, stop } = collect<ConnectionState>(client.state);

    lastEs().simulateOpen();
    client.close();
    // Trigger error on the now-closed source — should not emit another state.
    lastEs().simulateError();

    expect(values).toEqual(['connecting', 'open', 'closed']);
    stop();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. lastEvent store
// ──────────────────────────────────────────────────────────────────────────────

describe('lastEvent store', () => {
  it('is null before any event', () => {
    const client = createSseClient();
    const { values, stop } = collect<DeckChangedEvent | null>(client.lastEvent);
    expect(values).toEqual([null]);
    stop();
    client.close();
  });

  it('updates with a valid deck-changed event', () => {
    const client = createSseClient();
    const { values, stop } = collect<DeckChangedEvent | null>(client.lastEvent);

    lastEs().simulateMessage({ deck: 'intro', type: 'changed' });

    expect(values).toEqual([null, { deck: 'intro', type: 'changed' }]);
    stop();
    client.close();
  });

  it('accumulates multiple events in order', () => {
    const client = createSseClient();
    const received: DeckChangedEvent[] = [];
    const unsub = client.lastEvent.subscribe((ev) => {
      if (ev !== null) received.push(ev);
    });

    lastEs().simulateMessage({ deck: 'alpha', type: 'changed' });
    lastEs().simulateMessage({ deck: 'beta', type: 'changed' });

    expect(received).toEqual([
      { deck: 'alpha', type: 'changed' },
      { deck: 'beta', type: 'changed' },
    ]);
    unsub();
    client.close();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 5. onDeckChanged — named deck filter
// ──────────────────────────────────────────────────────────────────────────────

describe('onDeckChanged — named deck', () => {
  it('fires when the matching deck changes', () => {
    const client = createSseClient();
    const calls: DeckChangedEvent[] = [];
    client.onDeckChanged('intro', (ev) => calls.push(ev));

    lastEs().simulateMessage({ deck: 'intro', type: 'changed' });

    expect(calls).toHaveLength(1);
    expect(calls[0].deck).toBe('intro');
    client.close();
  });

  it('does NOT fire for a different deck', () => {
    const client = createSseClient();
    const calls: DeckChangedEvent[] = [];
    client.onDeckChanged('intro', (ev) => calls.push(ev));

    lastEs().simulateMessage({ deck: 'other', type: 'changed' });

    expect(calls).toHaveLength(0);
    client.close();
  });

  it('fires once per event when only one handler is registered', () => {
    const client = createSseClient();
    let count = 0;
    client.onDeckChanged('deck-a', () => count++);

    lastEs().simulateMessage({ deck: 'deck-a', type: 'changed' });
    lastEs().simulateMessage({ deck: 'deck-a', type: 'changed' });

    expect(count).toBe(2);
    client.close();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6. onDeckChanged — wildcard (null)
// ──────────────────────────────────────────────────────────────────────────────

describe('onDeckChanged — wildcard (null)', () => {
  it('fires for any deck when registered with null', () => {
    const client = createSseClient();
    const decks: string[] = [];
    client.onDeckChanged(null, (ev) => decks.push(ev.deck));

    lastEs().simulateMessage({ deck: 'alpha', type: 'changed' });
    lastEs().simulateMessage({ deck: 'beta', type: 'changed' });

    expect(decks).toEqual(['alpha', 'beta']);
    client.close();
  });

  it('wildcard fires alongside a named handler for the same deck', () => {
    const client = createSseClient();
    const named: string[] = [];
    const wild: string[] = [];

    client.onDeckChanged('alpha', (ev) => named.push(ev.deck));
    client.onDeckChanged(null, (ev) => wild.push(ev.deck));

    lastEs().simulateMessage({ deck: 'alpha', type: 'changed' });

    expect(named).toEqual(['alpha']);
    expect(wild).toEqual(['alpha']);
    client.close();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 7. Unsubscribe
// ──────────────────────────────────────────────────────────────────────────────

describe('unsubscribe', () => {
  it('stops the handler from receiving further events', () => {
    const client = createSseClient();
    const calls: DeckChangedEvent[] = [];
    const unsub = client.onDeckChanged('intro', (ev) => calls.push(ev));

    lastEs().simulateMessage({ deck: 'intro', type: 'changed' });
    unsub(); // unsubscribe before the second event
    lastEs().simulateMessage({ deck: 'intro', type: 'changed' });

    // Only the event before unsubscribe should have been received.
    expect(calls).toHaveLength(1);
    client.close();
  });

  it('unsubscribing one handler does not affect others on the same deck', () => {
    const client = createSseClient();
    const a: number[] = [];
    const b: number[] = [];
    let count = 0;

    const unsubA = client.onDeckChanged('deck', () => a.push(++count));
    client.onDeckChanged('deck', () => b.push(++count));

    lastEs().simulateMessage({ deck: 'deck', type: 'changed' });
    unsubA();
    lastEs().simulateMessage({ deck: 'deck', type: 'changed' });

    expect(a).toHaveLength(1); // received 1 event before unsubscribe
    expect(b).toHaveLength(2); // received both events
    client.close();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 8. Malformed / invalid event data
// ──────────────────────────────────────────────────────────────────────────────

describe('malformed data handling', () => {
  it('ignores events with invalid JSON', () => {
    const client = createSseClient();
    const calls: DeckChangedEvent[] = [];
    client.onDeckChanged(null, (ev) => calls.push(ev));

    // Send raw string (not valid JSON) directly through the mock.
    lastEs().onmessage?.(new MessageEvent('message', { data: 'not-json{{' }));

    expect(calls).toHaveLength(0);
    client.close();
  });

  it('ignores events where deck is not a string', () => {
    const client = createSseClient();
    const calls: DeckChangedEvent[] = [];
    client.onDeckChanged(null, (ev) => calls.push(ev));

    lastEs().simulateMessage({ deck: 42, type: 'changed' });

    expect(calls).toHaveLength(0);
    client.close();
  });

  it('ignores events missing the type field', () => {
    const client = createSseClient();
    const calls: DeckChangedEvent[] = [];
    client.onDeckChanged(null, (ev) => calls.push(ev));

    lastEs().simulateMessage({ deck: 'intro' });

    expect(calls).toHaveLength(0);
    client.close();
  });

  it('ignores null JSON payload', () => {
    const client = createSseClient();
    const calls: DeckChangedEvent[] = [];
    client.onDeckChanged(null, (ev) => calls.push(ev));

    lastEs().simulateMessage(null);

    expect(calls).toHaveLength(0);
    client.close();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 9. Unknown type field is still dispatched (forward compatibility)
// ──────────────────────────────────────────────────────────────────────────────

describe('forward compatibility', () => {
  it('dispatches events with unknown type strings (future protocol extensibility)', () => {
    const client = createSseClient();
    const calls: DeckChangedEvent[] = [];
    client.onDeckChanged(null, (ev) => calls.push(ev));

    lastEs().simulateMessage({ deck: 'intro', type: 'renamed' });

    // The client does not filter by type — callers can inspect ev.type.
    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe('renamed');
    client.close();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 10. close()
// ──────────────────────────────────────────────────────────────────────────────

describe('close()', () => {
  it('closes the underlying EventSource', () => {
    const client = createSseClient();
    const es = lastEs();
    client.close();
    expect(es.readyState).toBe(2); // CLOSED
  });

  it('is idempotent — safe to call twice', () => {
    const client = createSseClient();
    expect(() => {
      client.close();
      client.close();
    }).not.toThrow();
  });

  it('prevents further dispatch of in-flight events', () => {
    const client = createSseClient();
    const calls: DeckChangedEvent[] = [];
    client.onDeckChanged(null, (ev) => calls.push(ev));

    client.close();
    // Simulate a message arriving after close (e.g. race condition).
    lastEs().simulateMessage({ deck: 'intro', type: 'changed' });

    // closed flag prevents dispatch; lastEvent must stay null.
    expect(calls).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 11. Multiple handlers for the same deck
// ──────────────────────────────────────────────────────────────────────────────

describe('multiple handlers', () => {
  it('all handlers on the same deck name fire', () => {
    const client = createSseClient();
    const a: number[] = [];
    const b: number[] = [];
    const c: number[] = [];

    client.onDeckChanged('shared', () => a.push(1));
    client.onDeckChanged('shared', () => b.push(1));
    client.onDeckChanged('shared', () => c.push(1));

    lastEs().simulateMessage({ deck: 'shared', type: 'changed' });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(c).toHaveLength(1);
    client.close();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 12. Store subscribe contract (Svelte compatibility)
// ──────────────────────────────────────────────────────────────────────────────

describe('store subscribe contract', () => {
  it('state store calls subscriber immediately with current value', () => {
    const client = createSseClient();
    const received: ConnectionState[] = [];
    const unsub = client.state.subscribe((v) => received.push(v));
    // Must have been called synchronously during subscribe().
    expect(received).toEqual(['connecting']);
    unsub();
    client.close();
  });

  it('lastEvent store calls subscriber immediately with null', () => {
    const client = createSseClient();
    const received: (DeckChangedEvent | null)[] = [];
    const unsub = client.lastEvent.subscribe((v) => received.push(v));
    expect(received).toEqual([null]);
    unsub();
    client.close();
  });

  it('store subscriber receives updates after subscribe', () => {
    const client = createSseClient();
    const states: ConnectionState[] = [];
    client.state.subscribe((v) => states.push(v));

    lastEs().simulateOpen();

    expect(states).toContain('open');
    client.close();
  });
});
