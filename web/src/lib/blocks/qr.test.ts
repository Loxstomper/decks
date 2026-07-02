/**
 * qr.test.ts — QR model accessors (getQrProps/setQrProps) + contrast helper (P19).
 */

import { describe, it, expect } from 'vitest';
import { createElement, getAttribute, getQrProps, setQrProps } from '$lib/model';
import { qrContrastRatio, hexToRgb, QR_MIN_CONTRAST } from './qr-util';

describe('getQrProps', () => {
  it('reads the full marker set', () => {
    const el = createElement('div', {
      'data-qr': 'https://example.com',
      'data-qr-ec': 'Q',
      'data-qr-fg': '#102030',
      'data-qr-bg': '#ffffff',
      'data-qr-quiet': '6',
    });
    expect(getQrProps(el)).toEqual({
      payload: 'https://example.com',
      ec: 'Q',
      fg: '#102030',
      bg: '#ffffff',
      quiet: 6,
    });
  });

  it('returns null for absent / empty / invalid values', () => {
    const el = createElement('div', { 'data-qr': '', 'data-qr-ec': 'Z', 'data-qr-quiet': 'x' });
    const p = getQrProps(el);
    expect(p.payload).toBeNull();
    expect(p.ec).toBeNull(); // invalid EC → null
    expect(p.quiet).toBeNull(); // non-numeric → null
  });
});

describe('setQrProps', () => {
  it('writes a partial delta, leaving untouched keys alone', () => {
    const el = createElement('div', { 'data-qr': 'a', 'data-qr-ec': 'M' });
    setQrProps(el, { fg: '#000000' });
    expect(getAttribute(el, 'data-qr')).toBe('a'); // untouched
    expect(getAttribute(el, 'data-qr-ec')).toBe('M'); // untouched
    expect(getAttribute(el, 'data-qr-fg')).toBe('#000000');
  });

  it('null clears an attribute', () => {
    const el = createElement('div', { 'data-qr': 'a', 'data-qr-fg': '#fff' });
    setQrProps(el, { fg: null });
    expect(getAttribute(el, 'data-qr-fg')).toBeNull();
  });

  it('rejects an empty payload (use null to clear)', () => {
    const el = createElement('div', { 'data-qr': 'a' });
    expect(() => setQrProps(el, { payload: '   ' })).toThrow(TypeError);
  });

  it('rejects an invalid EC level', () => {
    const el = createElement('div', { 'data-qr': 'a' });
    expect(() => setQrProps(el, { ec: 'Z' as never })).toThrow(TypeError);
  });

  it('rejects a negative / non-integer quiet zone', () => {
    const el = createElement('div', { 'data-qr': 'a' });
    expect(() => setQrProps(el, { quiet: -1 })).toThrow(TypeError);
    expect(() => setQrProps(el, { quiet: 2.5 })).toThrow(TypeError);
  });
});

describe('qrContrastRatio', () => {
  it('black on white is the maximum 21:1', () => {
    expect(qrContrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('flags low-contrast pairs below the scannable threshold', () => {
    const r = qrContrastRatio('#777777', '#888888');
    expect(r).not.toBeNull();
    expect(r!).toBeLessThan(QR_MIN_CONTRAST);
  });

  it('returns null when a colour is not parseable hex (caller skips the guard)', () => {
    expect(qrContrastRatio('red', '#ffffff')).toBeNull();
  });

  it('parses #rgb shorthand', () => {
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
    expect(hexToRgb('000')).toEqual([0, 0, 0]);
    expect(hexToRgb('nope')).toBeNull();
  });
});
