/**
 * blocks/qr-util.ts — Shared QR helpers for the insert panel + inspector (P19).
 *
 * The contrast guard: a QR scanner needs strong light/dark contrast between the
 * module (foreground) and background colours, otherwise the code is unreadable.
 * We compute the WCAG contrast ratio and warn below {@link QR_MIN_CONTRAST}.
 * Pure; no DOM. Returns null when either colour is not a parseable hex string
 * (e.g. a CSS keyword) — the caller then simply skips the warning.
 */

/** Minimum fg/bg contrast ratio we consider scannable (warn below this). */
export const QR_MIN_CONTRAST = 3;

/** Parse "#rgb" / "#rrggbb" (with or without leading #) to [r,g,b] 0–255, or null. */
export function hexToRgb(hex: string | null | undefined): [number, number, number] | null {
  if (!hex) return null;
  let s = hex.trim().replace(/^#/, '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (s.length !== 6 || /[^0-9a-fA-F]/.test(s)) return null;
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}

/** Relative luminance per WCAG 2.1 (sRGB). */
function luminance([r, g, b]: [number, number, number]): number {
  const a = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

/**
 * WCAG contrast ratio (1–21) between two hex colours, or null when either is not
 * a parseable hex string (the caller skips the guard in that case).
 */
export function qrContrastRatio(fg: string, bg: string): number | null {
  const a = hexToRgb(fg);
  const b = hexToRgb(bg);
  if (!a || !b) return null;
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
