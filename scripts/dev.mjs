import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { buildStory } from "./build.mjs";
import { watchStorySources } from "./watchSources.mjs";

const require = createRequire(import.meta.url);
const liveServer = require("live-server");

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const mdPath = process.argv[2];
if (!mdPath) {
  console.error("Usage: node scripts/dev.mjs <fichier.it>");
  process.exit(1);
}

function rebuild() {
  const { outFile } = buildStory(mdPath);
  console.log(new Date().toISOString(), "→", outFile);
  return basename(outFile);
}

const entry = rebuild();
const distDir = join(root, "dist");

liveServer.start({
  root: distDir,
  file: entry,
  open: "/" + entry,
  logLevel: 1,
  wait: 150,
});

const stopWatch = watchStorySources(mdPath, () => {
  rebuild();
});

function shutdown() {
  stopWatch();
  liveServer.shutdown();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
