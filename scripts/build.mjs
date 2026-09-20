import { context, build } from "esbuild";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const watch = process.argv.includes("--watch");
const outDir = "dist";

const buildOptions = {
  entryPoints: ["src/app.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: !watch,
  sourcemap: watch,
  outfile: `${outDir}/app.js`,
};

/** Matches wiki links of the form [label](#/page/slug). */
const WIKI_LINK = /\]\(#\/page\/([a-z0-9-]+)\)/g;

async function readGraph(slugs) {
  const known = new Set(slugs);
  const edges = [];

  for (const slug of slugs) {
    const markdown = await readFile(`pages/${slug}.md`, "utf8");
    const targets = new Set();

    for (const [, target] of markdown.matchAll(WIKI_LINK)) {
      // Skip self-links and links to pages that no longer exist.
      if (target !== slug && known.has(target)) targets.add(target);
    }

    for (const target of targets) edges.push({ from: slug, to: target });
  }

  return { nodes: slugs.map((slug) => ({ slug })), edges };
}

async function copyStaticAssets() {
  await cp("index.html", `${outDir}/index.html`);
  await cp("style.css", `${outDir}/style.css`);
  await cp("pages", `${outDir}/pages`, { recursive: true });

  // Uploaded images arrive by commit, so the folder may not exist on a fresh clone.
  if (existsSync("images")) {
    await cp("images", `${outDir}/images`, { recursive: true });
  } else {
    await mkdir(`${outDir}/images`, { recursive: true });
  }

  const entries = await readdir("pages");
  const slugs = entries
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.replace(/\.md$/, ""))
    .sort();

  const graph = await readGraph(slugs);

  await writeFile(`${outDir}/pages/index.json`, JSON.stringify(slugs, null, 2));
  await writeFile(`${outDir}/pages/graph.json`, JSON.stringify(graph, null, 2));

  return { slugs, edgeCount: graph.edges.length };
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const { slugs, edgeCount } = await copyStaticAssets();

if (watch) {
  const ctx = await context(buildOptions);
  await ctx.watch();
  console.log(`Watching… (${slugs.length} pages, ${edgeCount} links)`);
} else {
  await build(buildOptions);
  console.log(`Built ${outDir}/ with ${slugs.length} pages and ${edgeCount} links`);
}
