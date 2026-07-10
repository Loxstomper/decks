/**
 * e2e/constants.ts — values shared by global setup, teardown, and the specs.
 *
 * WHY A SEPARATE MODULE:
 * =====================
 * playwright.config.ts imports global-setup.ts, and Playwright forbids calling
 * `test.beforeAll()` from anything the config transitively imports. Keeping the
 * constants here means a spec can read STATE_FILE without importing (and thus
 * re-executing) global-setup's module body. It also stops STATE_FILE from being
 * defined twice — it previously lived in global-setup.ts *and* was re-declared
 * verbatim in global-teardown.ts, so a change to one silently orphaned the other.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM: reproduce __dirname.
const __dirname = dirname(fileURLToPath(import.meta.url));

/** Runtime state (server PID + temp workspace path) handed from setup to teardown. */
export const STATE_FILE = join(__dirname, '.e2e-state.json');

/** The port the test server listens on. */
export const TEST_PORT = parseInt(process.env.TEST_PORT ?? '19999', 10);

/** Base URL of the test server. */
export const BASE_URL = `http://localhost:${TEST_PORT}`;

/**
 * The one deck scaffolded by global setup, before any spec runs.
 *
 * It exists so the editor always has *a* deck to open on a cold `GET /` (the
 * shell renders "No decks yet" otherwise). Specs that need to mutate a deck must
 * NOT use it — they create their own via `createDeck()` (see fixtures.ts).
 */
export const SMOKE_DECK = 'smoke-deck';
