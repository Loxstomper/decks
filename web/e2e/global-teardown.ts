/**
 * e2e/global-teardown.ts — Playwright global teardown for decks.
 *
 * Runs once after all specs complete (pass or fail). Reads the state file
 * written by global-setup.ts, kills the server process, and removes the
 * temp workspace directory.
 */

import { existsSync, readFileSync, rmSync, unlinkSync } from 'node:fs';

import { STATE_FILE } from './constants.ts';

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(STATE_FILE)) {
    console.warn('[e2e teardown] State file not found — nothing to clean up.');
    return;
  }

  let state: { pid?: number; tmpDir?: string };
  try {
    state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    console.warn('[e2e teardown] Could not parse state file.');
    return;
  }

  // Kill the server process.
  if (state.pid) {
    try {
      process.kill(state.pid, 'SIGTERM');
      console.log(`[e2e teardown] Sent SIGTERM to decks server (pid=${state.pid}).`);
    } catch (err: unknown) {
      // ESRCH = already exited — not an error.
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
        console.warn(`[e2e teardown] Could not kill pid ${state.pid}: ${err}`);
      }
    }
  }

  // Remove the temp workspace.
  if (state.tmpDir && existsSync(state.tmpDir)) {
    try {
      rmSync(state.tmpDir, { recursive: true, force: true });
      console.log(`[e2e teardown] Removed temp workspace at ${state.tmpDir}.`);
    } catch (err) {
      console.warn(`[e2e teardown] Could not remove ${state.tmpDir}: ${err}`);
    }
  }

  // Remove the state file.
  try {
    unlinkSync(STATE_FILE);
  } catch {
    // best-effort
  }
}
