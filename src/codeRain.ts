/**
 * Scrolling source code behind the page, seen through the translucent panels.
 *
 * Columns of text drift upward at their own speeds, drawn from fragments that
 * read like the site's own source, so the backdrop looks like something running
 * rather than random glyphs. It is decoration, so it stays cheap: one canvas,
 * no per-character DOM, and it stands still when the tab is hidden or the
 * viewer asks for reduced motion.
 */

const FRAGMENTS = [
  "const palette = buildPalette(kelvin);",
  "await savePage(slug, content, sha);",
  "renderer.render(scene, camera);",
  "for (const sample of samples) {",
  "return kelvinToRgb(temperature);",
  "if (!response.ok) throw new GitHubError();",
  "const wave = Math.sin(phase) * depth;",
  "requestAnimationFrame(render);",
  "export async function loadPage(slug) {",
  "geometry.setAttribute('position', attr);",
  "osc.frequency.value = hz * harmonic;",
  "commit --message 'Edit page'",
  "velocity[i] += (target - position) * SPRING;",
  "context.drawImage(source, 0, 0);",
  "const mired = 1e6 / kelvin;",
  "analyser.getByteTimeDomainData(buffer);",
  "}",
  "});",
];

interface Column {
  x: number;
  y: number;
  speed: number;
  text: string;
  alpha: number;
}

export interface CodeRainHandle {
  dispose(): void;
}

export function mountCodeRain(canvas: HTMLCanvasElement): CodeRainHandle {
  const context = canvas.getContext("2d");
  if (!context) return { dispose() {} };

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lineHeight = 20;
  const columnWidth = 260;
  let columns: Column[] = [];
  let frame = 0;

  function accent(): string {
    const value = getComputedStyle(document.documentElement).getPropertyValue("--neon").trim();
    return value || "#00c8ff";
  }

  function build(): void {
    const count = Math.max(3, Math.ceil(canvas.clientWidth / columnWidth));
    columns = Array.from({ length: count }, (_, i) => ({
      x: i * columnWidth + 12,
      y: Math.random() * canvas.clientHeight,
      speed: 0.18 + Math.random() * 0.35,
      text: FRAGMENTS[Math.floor(Math.random() * FRAGMENTS.length)] ?? "",
      alpha: 0.25 + Math.random() * 0.4,
    }));
  }

  function resize(): void {
    const ratio = Math.min(window.devicePixelRatio, 2);
    canvas.width = canvas.clientWidth * ratio;
    canvas.height = canvas.clientHeight * ratio;
    context!.setTransform(ratio, 0, 0, ratio, 0, 0);
    build();
  }

  function draw(): void {
    frame = requestAnimationFrame(draw);
    if (document.hidden) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    context!.clearRect(0, 0, width, height);
    context!.font = '13px "JetBrains Mono", ui-monospace, monospace';
    const colour = accent();

    for (const column of columns) {
      if (!reduceMotion) column.y -= column.speed;

      if (column.y < -lineHeight) {
        column.y = height + lineHeight;
        column.text = FRAGMENTS[Math.floor(Math.random() * FRAGMENTS.length)] ?? "";
        column.alpha = 0.25 + Math.random() * 0.4;
      }

      context!.globalAlpha = column.alpha;
      context!.fillStyle = colour;
      context!.fillText(column.text, column.x, column.y);

      // A faint trailing copy above gives the column some depth.
      context!.globalAlpha = column.alpha * 0.35;
      context!.fillText(column.text, column.x, column.y - lineHeight * 3);
    }

    context!.globalAlpha = 1;
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  draw();

  return {
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
    },
  };
}
