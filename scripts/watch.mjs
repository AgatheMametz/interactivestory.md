import { buildStory } from "./build.mjs";
import { watchStorySources } from "./watchSources.mjs";

const mdPath = process.argv[2];
if (!mdPath) {
  console.error("Usage: node scripts/watch.mjs <fichier.it>");
  process.exit(1);
}

function rebuild() {
  const { outFile } = buildStory(mdPath);
  console.log(new Date().toISOString(), "→", outFile);
}

rebuild();
watchStorySources(mdPath, () => rebuild());
