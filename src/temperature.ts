/**
 * Palette derived from colour temperature.
 *
 * Colours come from the Planckian locus: the hue a black body radiates when
 * heated to a given temperature. Low Kelvin is ember red, around 5500K is
 * daylight neutral, and high Kelvin is sky blue. The theme picks one accent
 * temperature and pairs it with its opposite, so the warm/cool contrast that
 * carries the visual hierarchy is a real property of the two temperatures
 * rather than two hues chosen by eye.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const MIN_KELVIN = 1800;
export const MAX_KELVIN = 12000;
export const DEFAULT_KELVIN = 9200;

/**
 * Pivot the warm/cool pairing turns around. Mirroring happens in mired space
 * (10^6 / K), where equal steps are roughly equal perceptual changes; a pivot
 * at daylight would leave both ends cool, so this sits lower to keep real
 * separation between the pair.
 */
const PIVOT_KELVIN = 4000;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * Tanner Helland's approximation of black-body colour, accurate enough across
 * 1000–40000K for display use and cheap enough to run on every slider tick.
 */
export function kelvinToRgb(kelvin: number): Rgb {
  const t = clamp(kelvin, 1000, 40000) / 100;

  let r: number;
  let g: number;
  let b: number;

  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }

  if (t >= 66) {
    b = 255;
  } else if (t <= 19) {
    b = 0;
  } else {
    b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  }

  return {
    r: Math.round(clamp(r, 0, 255)),
    g: Math.round(clamp(g, 0, 255)),
    b: Math.round(clamp(b, 0, 255)),
  };
}

/** Reflects a temperature across the pivot in mired space. */
export function mirrorTemperature(kelvin: number): number {
  const mired = 1_000_000 / clamp(kelvin, MIN_KELVIN, MAX_KELVIN);
  const pivotMired = 1_000_000 / PIVOT_KELVIN;
  const mirrored = 2 * pivotMired - mired;
  if (mirrored <= 0) return MAX_KELVIN;
  return clamp(1_000_000 / mirrored, MIN_KELVIN, MAX_KELVIN);
}

function toHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) return { h: 0, s: 0, l };

  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / delta) % 6;
  else if (max === gn) h = (bn - rn) / delta + 2;
  else h = (rn - gn) / delta + 4;

  return { h: (h * 60 + 360) % 360, s, l };
}

/**
 * Black-body colours are close to white by nature, so a literal conversion
 * gives washed-out tints. Hue is kept exactly as the temperature dictates and
 * only saturation and lightness are pushed to display strength.
 */
function vivid(kelvin: number, saturation: number, lightness: number): string {
  const { h } = toHsl(kelvinToRgb(kelvin));
  return `hsl(${h.toFixed(1)}, ${saturation}%, ${lightness}%)`;
}

export interface Palette {
  kelvin: number;
  mirrorKelvin: number;
  accent: string;
  accentSoft: string;
  counter: string;
  counterSoft: string;
  background: string;
  panel: string;
  text: string;
  muted: string;
  edge: string;
  grid: string;
}

export function buildPalette(kelvin: number): Palette {
  const accentK = clamp(kelvin, MIN_KELVIN, MAX_KELVIN);
  const counterK = mirrorTemperature(accentK);

  const accentHue = toHsl(kelvinToRgb(accentK)).h;
  const counterHue = toHsl(kelvinToRgb(counterK)).h;

  return {
    kelvin: Math.round(accentK),
    mirrorKelvin: Math.round(counterK),
    accent: vivid(accentK, 100, 55),
    accentSoft: `hsla(${accentHue.toFixed(1)}, 100%, 55%, 0.22)`,
    counter: vivid(counterK, 100, 62),
    counterSoft: `hsla(${counterHue.toFixed(1)}, 100%, 62%, 0.45)`,
    // The shell stays near-black but carries the accent's hue, so the whole
    // surface shifts with the temperature instead of only the highlights.
    background: `hsl(${accentHue.toFixed(1)}, 42%, 4%)`,
    panel: `hsla(${accentHue.toFixed(1)}, 38%, 10%, 0.72)`,
    text: `hsl(${accentHue.toFixed(1)}, 60%, 91%)`,
    muted: `hsl(${accentHue.toFixed(1)}, 22%, 60%)`,
    edge: `hsla(${accentHue.toFixed(1)}, 100%, 55%, 0.22)`,
    grid: `hsla(${accentHue.toFixed(1)}, 100%, 55%, 0.05)`,
  };
}

/**
 * Colour temperature of natural light through the day, as hour/Kelvin
 * keyframes. Sunlight is warmest near the horizon at dawn and dusk and closest
 * to neutral daylight at noon, while the twilight and night sky read cool, so
 * the curve swings low twice a day rather than tracking brightness.
 */
const DAYLIGHT: { hour: number; kelvin: number }[] = [
  { hour: 0, kelvin: 11000 }, // night sky
  { hour: 4, kelvin: 9000 }, // pre-dawn blue hour
  { hour: 5.5, kelvin: 2200 }, // sunrise
  { hour: 7, kelvin: 3600 },
  { hour: 9, kelvin: 5200 },
  { hour: 12, kelvin: 6500 }, // noon, daylight neutral
  { hour: 15, kelvin: 5600 },
  { hour: 17, kelvin: 4200 },
  { hour: 18.5, kelvin: 2400 }, // sunset, golden hour
  { hour: 20, kelvin: 3000 },
  { hour: 21.5, kelvin: 7000 }, // dusk climbing into blue hour
  { hour: 23, kelvin: 10000 },
  { hour: 24, kelvin: 11000 }, // wraps to midnight
];

export function describeDaylight(hour: number): string {
  if (hour < 4) return "night";
  if (hour < 5.5) return "blue hour";
  if (hour < 7.5) return "sunrise";
  if (hour < 11) return "morning";
  if (hour < 14) return "midday";
  if (hour < 17) return "afternoon";
  if (hour < 19.5) return "sunset";
  if (hour < 21.5) return "dusk";
  return "night";
}

/**
 * Temperature of daylight at a moment, interpolated between keyframes in mired
 * space so the transition is perceptually even rather than bunching at the
 * cool end the way interpolating Kelvin directly would.
 */
export function daylightTemperature(now = new Date()): number {
  const hour = now.getHours() + now.getMinutes() / 60;

  let previous = DAYLIGHT[0]!;
  for (const frame of DAYLIGHT) {
    if (frame.hour >= hour) {
      const span = frame.hour - previous.hour;
      const t = span === 0 ? 0 : (hour - previous.hour) / span;
      const fromMired = 1_000_000 / previous.kelvin;
      const toMired = 1_000_000 / frame.kelvin;
      const mired = fromMired + (toMired - fromMired) * t;
      return clamp(1_000_000 / mired, MIN_KELVIN, MAX_KELVIN);
    }
    previous = frame;
  }

  return DEFAULT_KELVIN;
}

const STORAGE_KEY = "wiki_temperature";
const AUTO_KEY = "wiki_temperature_auto";

export function autoEnabled(): boolean {
  return localStorage.getItem(AUTO_KEY) !== "off";
}

export function setAutoEnabled(enabled: boolean): void {
  localStorage.setItem(AUTO_KEY, enabled ? "on" : "off");
}

export function storedTemperature(): number {
  const raw = Number(localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(raw) && raw > 0 ? clamp(raw, MIN_KELVIN, MAX_KELVIN) : DEFAULT_KELVIN;
}

export function storeTemperature(kelvin: number): void {
  localStorage.setItem(STORAGE_KEY, String(Math.round(kelvin)));
}

/** Fired after the palette changes so the WebGL views can match the CSS. */
export const TEMPERATURE_EVENT = "wiki:temperature";

export function applyTemperature(kelvin: number): Palette {
  const palette = buildPalette(kelvin);
  const style = document.documentElement.style;

  style.setProperty("--neon", palette.accent);
  style.setProperty("--hot", palette.counter);
  style.setProperty("--edge", palette.edge);
  style.setProperty("--edge-hot", palette.counterSoft);
  style.setProperty("--void", palette.background);
  style.setProperty("--panel", palette.panel);
  style.setProperty("--text", palette.text);
  style.setProperty("--muted", palette.muted);
  style.setProperty("--grid", palette.grid);

  document.dispatchEvent(new CustomEvent(TEMPERATURE_EVENT, { detail: palette }));
  return palette;
}
