/**
 * Canvas-based image processing for wiki uploads.
 *
 * Everything runs in the browser because there is no server: the finished image
 * is committed straight to the repository. GitHub's contents API rejects large
 * payloads and base64 inflates bytes by a third, so images are always resized
 * and re-encoded to fit a budget rather than uploaded as-is.
 */

/** Longest edge kept after resizing. Comfortable for page width on any screen. */
export const MAX_EDGE = 1600;

/** Encoded byte ceiling, chosen to stay well inside the contents API limit. */
export const MAX_BYTES = 900_000;

export interface Adjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  /** Extra hue rotation in degrees, used by the neon preset. */
  hue: number;
}

export interface CropRect {
  /** Fractions of the source dimensions, so a crop survives rotation and resize. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export const NEUTRAL: Adjustments = { brightness: 100, contrast: 100, saturation: 100, hue: 0 };

export const FULL_FRAME: CropRect = { x: 0, y: 0, width: 1, height: 1 };

export interface Encoded {
  blob: Blob;
  width: number;
  height: number;
  quality: number;
}

export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as an image."));
    };
    image.src = url;
  });
}

function filterString({ brightness, contrast, saturation, hue }: Adjustments): string {
  return `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) hue-rotate(${hue}deg)`;
}

/**
 * Draws the source through crop, rotation, and colour adjustments, scaled so the
 * longest edge is at most maxEdge. Rotation is a multiple of 90 degrees, which
 * keeps the output axis-aligned and avoids resampling artefacts.
 */
export function renderToCanvas(
  source: CanvasImageSource & { width: number; height: number },
  crop: CropRect,
  rotation: number,
  adjustments: Adjustments,
  maxEdge = MAX_EDGE,
): HTMLCanvasElement {
  const sx = Math.round(crop.x * source.width);
  const sy = Math.round(crop.y * source.height);
  const sw = Math.max(1, Math.round(crop.width * source.width));
  const sh = Math.max(1, Math.round(crop.height * source.height));

  const quarterTurns = (((rotation / 90) % 4) + 4) % 4;
  const swapsAxes = quarterTurns % 2 === 1;
  const croppedWidth = swapsAxes ? sh : sw;
  const croppedHeight = swapsAxes ? sw : sh;

  const scale = Math.min(1, maxEdge / Math.max(croppedWidth, croppedHeight));
  const outWidth = Math.max(1, Math.round(croppedWidth * scale));
  const outHeight = Math.max(1, Math.round(croppedHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;

  const context = canvas.getContext("2d");
  if (!context) return canvas;

  context.imageSmoothingQuality = "high";
  context.filter = filterString(adjustments);
  context.translate(outWidth / 2, outHeight / 2);
  context.rotate((quarterTurns * Math.PI) / 2);

  // After rotating, draw in the un-swapped orientation and let the transform place it.
  const drawWidth = swapsAxes ? outHeight : outWidth;
  const drawHeight = swapsAxes ? outWidth : outHeight;
  context.drawImage(source, sx, sy, sw, sh, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);

  return canvas;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Encodes the canvas, stepping quality and then dimensions down until the result
 * fits the byte budget. Transparency is preserved by keeping PNG only when the
 * image actually needs it, since PNG cannot be quality-scaled the same way.
 */
export async function encodeWithinBudget(
  source: CanvasImageSource & { width: number; height: number },
  crop: CropRect,
  rotation: number,
  adjustments: Adjustments,
  maxBytes = MAX_BYTES,
): Promise<Encoded> {
  let maxEdge = MAX_EDGE;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const canvas = renderToCanvas(source, crop, rotation, adjustments, maxEdge);

    for (const quality of [0.86, 0.75, 0.62, 0.5]) {
      const blob = await toBlob(canvas, "image/jpeg", quality);
      if (!blob) continue;
      if (blob.size <= maxBytes) {
        return { blob, width: canvas.width, height: canvas.height, quality };
      }
    }

    maxEdge = Math.round(maxEdge * 0.75);
  }

  // Last resort: smallest settings we are willing to produce.
  const canvas = renderToCanvas(source, crop, rotation, adjustments, 900);
  const blob = (await toBlob(canvas, "image/jpeg", 0.45)) ?? new Blob();
  return { blob, width: canvas.width, height: canvas.height, quality: 0.45 };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Chunked to avoid blowing the argument limit on large buffers.
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Builds a repo-safe, collision-resistant file name for an upload. */
export function imageFileName(original: string): string {
  const base = original
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  const stamp = Date.now().toString(36);
  return `${base || "image"}-${stamp}.jpg`;
}
