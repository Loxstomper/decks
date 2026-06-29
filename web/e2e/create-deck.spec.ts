/**
 * e2e/create-deck.spec.ts — Browser-side deck creation (P9-11 + P9-12).
 *
 * Exercises the full stack with no unit-test equivalent:
 *   Navigator "+ Deck" form → POST /api/decks/{name} → deck.New scaffold on
 *   disk → deck list refresh → the new deck opens in the editor.
 *
 * Verifies the create flow end-to-end and that the created deck is real
 * (renders reveal.js in the canvas, like any scaffolded deck).
 */

import { test, expect } from '@playwright/test';

// Unique-ish name so reruns against a persisted workspace don't 409.
// (The e2e workspace is a fresh mkdtemp per run, but this is cheap insurance.)
const NEW_DECK = 'e2e-created-deck';

test.describe('Create deck from the browser (P9-11/P9-12)', () => {
  test('creates a deck via the navigator and opens it', async ({ page }) => {
    await page.goto('/');

    // The "+ Deck" affordance lives in the navigator toolbar.
    const newDeckBtn = page.getByRole('button', { name: 'New deck', exact: true });
    await expect(newDeckBtn).toBeVisible({ timeout: 8_000 });
    await newDeckBtn.click();

    // Inline form: name input + confirm.
    const nameInput = page.getByLabel('New deck name');
    await expect(nameInput).toBeVisible();
    await nameInput.fill(NEW_DECK);
    await page.getByRole('button', { name: 'Confirm create deck' }).click();

    // ── 1. The new deck appears in the navigator deck list ───────────────────
    const createdDeckButton = page.locator('ul button', { hasText: NEW_DECK });
    await expect(createdDeckButton).toBeVisible({ timeout: 8_000 });

    // ── 2. It is a real, openable deck — reveal renders in the canvas ────────
    const revealRoot = page
      .frameLocator('iframe.reveal-frame-iframe')
      .locator('.reveal .slides section')
      .first();
    await expect(revealRoot).toBeAttached({ timeout: 8_000 });
  });

  test('rejects a duplicate deck name without clobbering', async ({ page }) => {
    await page.goto('/');

    // The smoke deck always exists in the e2e workspace; creating it again
    // must surface an error inline and must not 201.
    await page.getByRole('button', { name: 'New deck', exact: true }).click();
    await page.getByLabel('New deck name').fill('smoke-deck');
    await page.getByRole('button', { name: 'Confirm create deck' }).click();

    // The form stays open with an inline error (409 handled gracefully): the
    // create form only persists on failure, and an alert names the conflict.
    await expect(page.getByLabel('New deck name')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('alert')).toContainText('already exists');
  });
});
