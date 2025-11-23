import { build, context } from "esbuild";
import { mkdir, cp, rm } from "fs/promises";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const srcDir = path.join(projectRoot, "src");
const distDir = path.join(projectRoot, "dist");

const args = new Set(process.argv.slice(2));
const isWatch = args.has("--watch");

async function ensureDist() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
}

async function bundle() {
  const buildOptions = {
    entryPoints: [
      path.join(srcDir, "background", "serviceWorker.ts"),
      path.join(srcDir, "content", "topbar", "index.ts"),
      path.join(srcDir, "content", "topbar", "viewportShimMain.ts"),
      path.join(srcDir, "content", "chatgpt", "index.ts"),
      path.join(srcDir, "content", "gemini", "index.ts"),
      path.join(srcDir, "sidepanel", "index.ts"),
      path.join(srcDir, "options", "index.ts")
    ],
    outbase: srcDir,
    outdir: distDir,
    bundle: true,
    minify: false,
    sourcemap: true,
    target: "chrome120",
    format: "esm",
    platform: "browser",
    tsconfig: path.join(projectRoot, "tsconfig.json"),
    logLevel: "info"
  };

  if (isWatch) {
    const ctx = await context(buildOptions);
    await ctx.watch();
    return ctx;
  }

  await build(buildOptions);
  return null;
}

async function copyStatics() {
  const filesToCopy = [
    ["manifest.json", "manifest.json"],
    ["sidepanel/index.html", "sidepanel/index.html"],
    ["sidepanel/styles.css", "sidepanel/styles.css"],
    ["options/index.html", "options/index.html"]
  ];

  for (const [from, to] of filesToCopy) {
    const srcPath = path.join(srcDir, from);
    const dstPath = path.join(distDir, to);
    await mkdir(path.dirname(dstPath), { recursive: true });
    await cp(srcPath, dstPath, { recursive: false, errorOnExist: false });
  }

  const assetsSrc = path.join(srcDir, "assets");
  const assetsDst = path.join(distDir, "assets");
  await mkdir(assetsDst, { recursive: true });
  await cp(assetsSrc, assetsDst, { recursive: true, errorOnExist: false });
}

async function main() {
  await ensureDist();
  await copyStatics();
  const ctx = await bundle();
  if (ctx && isWatch) {
    console.log("Watching for changes...");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
