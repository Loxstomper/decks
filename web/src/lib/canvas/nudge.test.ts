import { describe, it, expect } from 'vitest';
import {
  isArrowKey,
  freeNudgeDelta,
  reorderNudgeDirection,
  isEditingContext,
  NUDGE_STEP,
  NUDGE_STEP_LARGE,
} from './nudge.ts';

describe('isArrowKey', () => {
  it('recognises the four arrow keys only', () => {
    expect(isArrowKey('ArrowUp')).toBe(true);
    expect(isArrowKey('ArrowDown')).toBe(true);
    expect(isArrowKey('ArrowLeft')).toBe(true);
    expect(isArrowKey('ArrowRight')).toBe(true);
    expect(isArrowKey('Enter')).toBe(false);
    expect(isArrowKey('a')).toBe(false);
  });
});

describe('freeNudgeDelta', () => {
  it('moves 1 logical unit by default (spec 04)', () => {
    expect(freeNudgeDelta('ArrowUp', false)).toEqual({ dx: 0, dy: -NUDGE_STEP });
    expect(freeNudgeDelta('ArrowDown', false)).toEqual({ dx: 0, dy: NUDGE_STEP });
    expect(freeNudgeDelta('ArrowLeft', false)).toEqual({ dx: -NUDGE_STEP, dy: 0 });
    expect(freeNudgeDelta('ArrowRight', false)).toEqual({ dx: NUDGE_STEP, dy: 0 });
  });

  it('moves 10 logical units with Shift (spec 04)', () => {
    expect(NUDGE_STEP_LARGE).toBe(10);
    expect(freeNudgeDelta('ArrowRight', true)).toEqual({ dx: NUDGE_STEP_LARGE, dy: 0 });
    expect(freeNudgeDelta('ArrowUp', true)).toEqual({ dx: 0, dy: -NUDGE_STEP_LARGE });
  });

  it('returns null for non-arrow keys', () => {
    expect(freeNudgeDelta('Enter', false)).toBeNull();
    expect(freeNudgeDelta('x', true)).toBeNull();
  });
});

describe('reorderNudgeDirection', () => {
  it('maps up/left to -1 and down/right to +1', () => {
    expect(reorderNudgeDirection('ArrowUp')).toBe(-1);
    expect(reorderNudgeDirection('ArrowLeft')).toBe(-1);
    expect(reorderNudgeDirection('ArrowDown')).toBe(1);
    expect(reorderNudgeDirection('ArrowRight')).toBe(1);
  });
  it('is 0 for non-arrow keys', () => {
    expect(reorderNudgeDirection('Tab')).toBe(0);
  });
});

describe('isEditingContext (nudge guard)', () => {
  it('is true during an in-place edit session', () => {
    expect(isEditingContext(null, true)).toBe(true);
  });

  it('is true for form text-entry elements', () => {
    expect(isEditingContext({ tagName: 'INPUT' }, false)).toBe(true);
    expect(isEditingContext({ tagName: 'textarea' }, false)).toBe(true);
    expect(isEditingContext({ tagName: 'SELECT' }, false)).toBe(true);
  });

  it('is true for contenteditable elements', () => {
    expect(isEditingContext({ tagName: 'DIV', isContentEditable: true }, false)).toBe(true);
  });

  it('is true inside a CodeMirror editor', () => {
    const cmChild = {
      tagName: 'DIV',
      isContentEditable: false,
      closest: (sel: string) => (sel === '.cm-editor' ? {} : null),
    };
    expect(isEditingContext(cmChild, false)).toBe(true);
  });

  it('is false for a plain non-editing target', () => {
    const plain = {
      tagName: 'DIV',
      isContentEditable: false,
      closest: () => null,
    };
    expect(isEditingContext(plain, false)).toBe(false);
    expect(isEditingContext(null, false)).toBe(false);
  });
});
