import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { PAGES_DIR } from "./config.js";

interface GraphData {
  nodes: { slug: string }[];
  edges: { from: string; to: string }[];
}

interface Node {
  slug: string;
  position: Vector3;
}

const ACCENT = new Color("#00f0ff");
const ACCENT_HOT = new Color("#ff2bd6");

export interface GraphHandle {
  dispose(): void;
}

/** Points render as hard squares without a sprite; this softens them into orbs. */
function glowSprite(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");

  if (context) {
    const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.25, "rgba(255,255,255,0.85)");
    gradient.addColorStop(0.55, "rgba(255,255,255,0.25)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }

  return new CanvasTexture(canvas);
}

async function fetchGraph(): Promise<GraphData> {
  const response = await fetch(`${PAGES_DIR}/graph.json`, { cache: "no-cache" });
  if (!response.ok) throw new Error("Could not load the page graph");
  return (await response.json()) as GraphData;
}

/**
 * Lays nodes out on a Fibonacci sphere, which spreads them evenly without the
 * clustering a random distribution produces at small page counts.
 */
function layout(slugs: string[], radius: number): Node[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return slugs.map((slug, index) => {
    const y = slugs.length === 1 ? 0 : 1 - (index / (slugs.length - 1)) * 2;
    const ringRadius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * index;
    return {
      slug,
      position: new Vector3(
        Math.cos(theta) * ringRadius * radius,
        y * radius,
        Math.sin(theta) * ringRadius * radius,
      ),
    };
  });
}

function buildStarfield(count: number, spread: number): Points {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i += 1) {
    positions[i] = (Math.random() - 0.5) * spread;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    color: new Color("#2a4a6a"),
    size: 0.6,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.7,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  return new Points(geometry, material);
}

/**
 * Renders the wiki as an interactive 3D graph. Returns a handle whose dispose()
 * releases the GPU resources and listeners; callers must invoke it on teardown
 * or the render loop keeps running after the view is gone.
 */
export async function mountGraph(
  container: HTMLElement,
  onSelect: (slug: string) => void,
): Promise<GraphHandle> {
  const data = await fetchGraph();
  const nodes = layout(
    data.nodes.map((node) => node.slug),
    26,
  );
  const byslug = new Map(nodes.map((node) => [node.slug, node]));

  const scene = new Scene();
  const camera = new PerspectiveCamera(55, 1, 0.1, 2000);
  camera.position.set(0, 0, 78);

  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.append(renderer.domElement);

  const world = new Group();
  scene.add(world);
  world.add(buildStarfield(700, 420));

  // Edges
  const edgePositions: number[] = [];
  for (const edge of data.edges) {
    const from = byslug.get(edge.from);
    const to = byslug.get(edge.to);
    if (!from || !to) continue;
    edgePositions.push(
      from.position.x, from.position.y, from.position.z,
      to.position.x, to.position.y, to.position.z,
    );
  }
  const edgeGeometry = new BufferGeometry();
  edgeGeometry.setAttribute("position", new Float32BufferAttribute(edgePositions, 3));
  const edgeMaterial = new LineBasicMaterial({
    color: ACCENT,
    transparent: true,
    opacity: 0.32,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  world.add(new LineSegments(edgeGeometry, edgeMaterial));

  // Nodes
  const nodeGeometry = new BufferGeometry();
  nodeGeometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      nodes.flatMap((node) => [node.position.x, node.position.y, node.position.z]),
      3,
    ),
  );
  nodeGeometry.setAttribute(
    "color",
    new Float32BufferAttribute(nodes.flatMap(() => [ACCENT.r, ACCENT.g, ACCENT.b]), 3),
  );
  const sprite = glowSprite();
  const nodeMaterial = new PointsMaterial({
    size: 7.5,
    map: sprite,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const nodePoints = new Points(nodeGeometry, nodeMaterial);
  world.add(nodePoints);

  // Labels are DOM elements projected onto the canvas: crisp text without a font atlas.
  const labelLayer = document.createElement("div");
  labelLayer.className = "graph-labels";
  container.append(labelLayer);

  const labels = nodes.map((node) => {
    const label = document.createElement("button");
    label.type = "button";
    label.className = "graph-label";
    label.textContent = node.slug.replace(/-/g, " ");
    label.addEventListener("click", () => onSelect(node.slug));
    labelLayer.append(label);
    return label;
  });

  const raycaster = new Raycaster();
  raycaster.params.Points = { threshold: 2.6 };
  const pointer = new Vector2();
  let hovered: number | null = null;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let autoRotate = !reduceMotion;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let yaw = 0;
  let pitch = 0;

  function resize(): void {
    const { clientWidth, clientHeight } = container;
    if (clientWidth === 0 || clientHeight === 0) return;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  }

  function setPointerFromEvent(event: PointerEvent): void {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function onPointerDown(event: PointerEvent): void {
    dragging = true;
    autoRotate = false;
    lastX = event.clientX;
    lastY = event.clientY;
    renderer.domElement.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    setPointerFromEvent(event);
    if (!dragging) return;
    yaw += (event.clientX - lastX) * 0.005;
    pitch += (event.clientY - lastY) * 0.005;
    pitch = Math.max(-1.2, Math.min(1.2, pitch));
    lastX = event.clientX;
    lastY = event.clientY;
  }

  function onPointerUp(event: PointerEvent): void {
    dragging = false;
    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
      renderer.domElement.releasePointerCapture(event.pointerId);
    }
  }

  function onClick(): void {
    if (hovered !== null) {
      const node = nodes[hovered];
      if (node) onSelect(node.slug);
    }
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    camera.position.z = Math.max(38, Math.min(150, camera.position.z + event.deltaY * 0.05));
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("click", onClick);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  const colorAttribute = nodeGeometry.getAttribute("color") as Float32BufferAttribute;
  const projected = new Vector3();
  let frame = 0;

  function render(): void {
    frame = requestAnimationFrame(render);

    if (autoRotate) yaw += 0.0016;
    world.rotation.y = yaw;
    world.rotation.x = pitch;

    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(nodePoints, false)[0];
    const nextHovered = hit?.index ?? null;

    if (nextHovered !== hovered) {
      hovered = nextHovered;
      for (let i = 0; i < nodes.length; i += 1) {
        const color = i === hovered ? ACCENT_HOT : ACCENT;
        colorAttribute.setXYZ(i, color.r, color.g, color.b);
      }
      colorAttribute.needsUpdate = true;
      renderer.domElement.style.cursor = hovered === null ? "grab" : "pointer";
    }

    // Project each node to screen space so its label tracks it.
    const { clientWidth, clientHeight } = container;
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const label = labels[i];
      if (!node || !label) continue;

      projected.copy(node.position).applyMatrix4(world.matrixWorld).project(camera);
      const behind = projected.z > 1;
      label.style.opacity = behind ? "0" : String(0.45 + (1 - projected.z) * 0.9);
      // Sit the label below the node so the glowing point stays visible.
      label.style.transform = `translate(-50%, 0) translate(${
        (projected.x * 0.5 + 0.5) * clientWidth
      }px, ${(-projected.y * 0.5 + 0.5) * clientHeight + 14}px)`;
      label.classList.toggle("is-hovered", i === hovered);
    }

    renderer.render(scene, camera);
  }

  render();

  return {
    dispose() {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("wheel", onWheel);
      nodeGeometry.dispose();
      edgeGeometry.dispose();
      sprite.dispose();
      nodeMaterial.dispose();
      edgeMaterial.dispose();
      renderer.dispose();
      labelLayer.remove();
      renderer.domElement.remove();
    },
  };
}
