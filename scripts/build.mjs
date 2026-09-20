import { context, build } from "esbuild";
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";

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

async function copyStaticAssets() {
  await cp("index.html", `${outDir}/index.html`);
  await cp("style.css", `${outDir}/style.css`);
  await cp("pages", `${outDir}/pages`, { recursive: true });

  const entries = await readdir("pages");
  const slugs = entries
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.replace(/\.md$/, ""))
    .sort();

  await writeFile(`${outDir}/pages/index.json`, JSON.stringify(slugs, null, 2));
  return slugs;
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const slugs = await copyStaticAssets();

if (watch) {
  const ctx = await context(buildOptions);
  await ctx.watch();
  console.log(`Watching… (${slugs.length} pages)`);
} else {
  await build(buildOptions);
  console.log(`Built ${outDir}/ with ${slugs.length} pages`);
}
