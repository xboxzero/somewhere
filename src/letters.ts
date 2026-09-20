import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  PerspectiveCamera,
  Plane,
  Points,
  PointsMaterial,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { TEMPERATURE_EVENT } from "./temperature.js";

/**
 * Renders text as a volumetric cloud of particles: the glyphs are rasterised to
 * an offscreen canvas, the opaque pixels are sampled, and each sample is emitted
 * at several depths so the word reads as a solid slab when it rotates. This uses
 * whatever font the browser already has, so it needs no typeface asset.
 */

const NEON = new Color("#00f0ff");
const HOT = new Color("#ff2bd6");

/** Re-read on each build so the glyphs match the current colour temperature. */
function accents(): { neon: Color; hot: Color } {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: Color): Color => {
    const value = style.getPropertyValue(name).trim();
    try {
      return value ? new Color(value) : fallback;
    } catch {
      return fallback;
    }
  };
  return { neon: read("--neon", NEON), hot: read("--hot", HOT) };
}

/** Depth slices emitted per sampled pixel; more slices read as thicker letters. */
const LAYERS = [-1.6, -0.8, 0, 0.8, 1.6];
const SPRING = 0.045;
const DAMPING = 0.86;
const REPEL_RADIUS = 9;
const REPEL_STRENGTH = 26;

/** A travelling wave the glyphs ride: it displaces depth most, height gently. */
const WAVE_DEPTH = 5.2;
const WAVE_HEIGHT = 1.4;
const WAVE_NUMBER = 0.16;
const WAVE_SPEED = 1.7;

export interface LetterFieldHandle {
  setText(text: string): void;
  dispose(): void;
}

interface Sample {
  x: number;
  y: number;
}

interface Glyphs {
  samples: Sample[];
  /** Bounds of the drawn text, not of the canvas, so scaling fits the word itself. */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function sampleGlyphs(text: string, maxWidth: number): Glyphs {
  const empty: Glyphs = { samples: [], minX: 0, maxX: 0, minY: 0, maxY: 0 };
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return empty;

  canvas.width = 2048;
  canvas.height = 420;
  context.font = '700 190px "Chakra Petch", "Segoe UI", system-ui, sans-serif';
  context.textBaseline = "middle";
  context.textAlign = "center";
  context.fillStyle = "#fff";
  context.fillText(text, canvas.width / 2, canvas.height / 2, maxWidth);

  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const samples: Sample[] = [];
  // Step controls density: smaller means more particles and a heavier frame.
  const step = 5;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      const alpha = data[(y * canvas.width + x) * 4 + 3] ?? 0;
      if (alpha <= 128) continue;
      samples.push({ x, y });
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (samples.length === 0) return empty;
  return { samples, minX, maxX, minY, maxY };
}

export function mountLetterField(container: HTMLElement, initialText: string): LetterFieldHandle {
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 0, 62);

  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.append(renderer.domElement);

  const geometry = new BufferGeometry();
  const material = new PointsMaterial({
    size: 0.5,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.62,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const points = new Points(geometry, material);
  scene.add(points);

  let home = new Float32Array(0);
  let current = new Float32Array(0);
  let velocity = new Float32Array(0);
  let count = 0;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let lastText = initialText;

  function setText(text: string): void {
    lastText = text;
    const palette = accents();
    const { samples, minX, maxX, minY, maxY } = sampleGlyphs(text.toUpperCase(), 1900);
    count = samples.length * LAYERS.length;

    home = new Float32Array(count * 3);
    current = new Float32Array(count * 3);
    velocity = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    // Fit the word to the viewport by its own bounds, limited by width and height
    // so a long title shrinks instead of running off the sides.
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const scale = Math.min(74 / spanX, 24 / spanY);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    let i = 0;

    for (const sample of samples) {
      const x = (sample.x - centerX) * scale;
      const y = -(sample.y - centerY) * scale;

      for (const layer of LAYERS) {
        const index = i * 3;
        // Jitter each depth slice sideways so slices don't stack into one
        // over-bright additive point, which washes the neon out to white.
        home[index] = x + (Math.random() - 0.5) * 0.42;
        home[index + 1] = y + (Math.random() - 0.5) * 0.42;
        home[index + 2] = layer + (Math.random() - 0.5) * 0.5;

        // Start scattered so the word assembles itself on first paint.
        current[index] = x + (Math.random() - 0.5) * 90;
        current[index + 1] = y + (Math.random() - 0.5) * 60;
        current[index + 2] = (Math.random() - 0.5) * 70;

        // Edge layers run toward the counter temperature, giving the slab a rim.
        const edge = Math.abs(layer) / 1.6;
        const color = palette.neon.clone().lerp(palette.hot, edge * 0.55);
        colors[index] = color.r;
        colors[index + 1] = color.g;
        colors[index + 2] = color.b;

        i += 1;
      }
    }

    geometry.setAttribute("position", new Float32BufferAttribute(current, 3));
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  }

  const raycaster = new Raycaster();
  const pointer = new Vector2(10, 10);
  const pointerWorld = new Vector3();
  const focalPlane = new Plane(new Vector3(0, 0, 1), 0);
  let pointerInside = false;
  let tilt = 0;

  function onPointerMove(event: PointerEvent): void {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    pointerInside = true;
  }

  function onPointerLeave(): void {
    pointerInside = false;
  }

  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerleave", onPointerLeave);

  function resize(): void {
    const { clientWidth, clientHeight } = container;
    if (clientWidth === 0 || clientHeight === 0) return;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  let frame = 0;
  let time = 0;

  function render(): void {
    frame = requestAnimationFrame(render);
    time += 0.016;

    if (pointerInside) {
      raycaster.setFromCamera(pointer, camera);
      raycaster.ray.intersectPlane(focalPlane, pointerWorld);
      tilt += (pointer.x * 0.35 - tilt) * 0.05;
    } else {
      tilt += (Math.sin(time * 0.4) * 0.16 - tilt) * 0.02;
    }

    points.rotation.y = tilt;
    points.rotation.x = Math.sin(time * 0.3) * 0.06;

    const attribute = geometry.getAttribute("position") as Float32BufferAttribute | undefined;
    if (attribute) {
      const waveScale = reduceMotion ? 0 : 1;

      for (let i = 0; i < count; i += 1) {
        const index = i * 3;
        const homeX = home[index] ?? 0;
        const homeY = home[index + 1] ?? 0;
        const homeZ = home[index + 2] ?? 0;

        // A wave travelling along x, modulated across y, so the word ripples
        // through depth rather than sliding as a flat sheet.
        const phase = homeX * WAVE_NUMBER + time * WAVE_SPEED;
        const wave =
          Math.sin(phase) * Math.cos(homeY * WAVE_NUMBER * 1.9 + time * WAVE_SPEED * 0.6);

        const targets = [
          homeX,
          homeY + wave * WAVE_HEIGHT * waveScale,
          homeZ + wave * WAVE_DEPTH * waveScale,
        ];

        for (let axis = 0; axis < 3; axis += 1) {
          const target = targets[axis] ?? 0;
          const position = current[index + axis] ?? 0;
          let force = (target - position) * SPRING;

          // Quantum jitter: a small persistent uncertainty around the rest position.
          if (!reduceMotion) {
            force += Math.sin(time * 2.2 + i * 0.7 + axis * 2.1) * 0.012;
          }

          velocity[index + axis] = ((velocity[index + axis] ?? 0) + force) * DAMPING;
        }

        if (pointerInside) {
          const dx = (current[index] ?? 0) - pointerWorld.x;
          const dy = (current[index + 1] ?? 0) - pointerWorld.y;
          const distanceSq = dx * dx + dy * dy;

          if (distanceSq < REPEL_RADIUS * REPEL_RADIUS && distanceSq > 0.0001) {
            const distance = Math.sqrt(distanceSq);
            const push = (1 - distance / REPEL_RADIUS) * REPEL_STRENGTH;
            velocity[index] = (velocity[index] ?? 0) + (dx / distance) * push * 0.02;
            velocity[index + 1] = (velocity[index + 1] ?? 0) + (dy / distance) * push * 0.02;
            velocity[index + 2] = (velocity[index + 2] ?? 0) + (Math.random() - 0.5) * push * 0.03;
          }
        }

        current[index] = (current[index] ?? 0) + (velocity[index] ?? 0);
        current[index + 1] = (current[index + 1] ?? 0) + (velocity[index + 1] ?? 0);
        current[index + 2] = (current[index + 2] ?? 0) + (velocity[index + 2] ?? 0);

        attribute.setXYZ(i, current[index] ?? 0, current[index + 1] ?? 0, current[index + 2] ?? 0);
      }
      attribute.needsUpdate = true;
    }

    renderer.render(scene, camera);
  }

  const onTemperature = (): void => setText(lastText);
  document.addEventListener(TEMPERATURE_EVENT, onTemperature);

  setText(initialText);
  resize();
  render();

  return {
    setText,
    dispose() {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      document.removeEventListener(TEMPERATURE_EVENT, onTemperature);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", onPointerLeave);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
