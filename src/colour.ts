/**
 * Turning one chosen colour into a whole category's worth of CSS.
 *
 * A category is stored as a single `#rrggbb` — asking for a light colour and a
 * dark one and a text colour would be three decisions where the board only
 * needs one. Dark theme lifts the strip to a pastel of the same hue, and the
 * ink on top flips to whichever of white or near-black actually reads.
 */

const HEX = /^#[0-9a-f]{6}$/i;

export function isHexColour(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

/** Accepts what someone might paste — `#abc`, `ABCDEF`, stray spaces. */
export function parseHex(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  const hashed = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(hashed);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return HEX.test(hashed) ? hashed : null;
}

function toRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex(r: number, g: number, b: number): string {
  const byte = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const span = max - min;
  if (span === 0) return [0, 0, lightness];

  const saturation = span / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === red) hue = ((green - blue) / span) % 6;
  else if (max === green) hue = (blue - red) / span + 2;
  else hue = (red - green) / span + 4;
  return [((hue * 60) + 360) % 360, saturation, lightness];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sextant = Math.floor(h / 60) % 6;
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sextant];
  return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** Perceived brightness, as the WCAG defines it. */
function luminance(hex: string): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = toRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * The dark-theme face of a category colour.
 *
 * Lifted enough to sit above a dark surface rather than punch a hole in it,
 * floored so a near-black choice doesn't disappear into one, and capped so a
 * colour that is already pale doesn't come out white. Full saturation glares
 * against a dark ground, so the very brightest come back a little.
 */
export function forDarkTheme(hex: string): string {
  const [h, s, l] = rgbToHsl(...toRgb(hex));
  return hslToHex(h, Math.min(s, 0.85), Math.min(0.82, Math.max(0.42, l + 0.16)));
}

/**
 * White or near-black on the strip, whichever reads.
 *
 * The tipping point sits above where pure contrast would put it, because the
 * strip's text is small and bold: white holds on the saturated mid-tones this
 * palette is full of, and only genuinely pale colours need dark ink.
 */
export function inkOn(hex: string): string {
  return luminance(hex) > 0.25 ? '#0f141b' : '#ffffff';
}
