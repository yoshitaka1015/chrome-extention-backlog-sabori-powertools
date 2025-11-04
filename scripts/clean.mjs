import { rm } from "fs/promises";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "..", "dist");

try {
  await rm(distDir, { recursive: true, force: true });
  console.log("Removed dist directory.");
} catch (error) {
  console.error("Failed to clean dist directory:", error);
  process.exitCode = 1;
}
