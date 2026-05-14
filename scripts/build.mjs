import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { parseStoryMarkdown } from "./parseStory.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

export function slug(s) {
  const base = String(s)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "story";
}

function readMarkedUmd() {
  const candidates = [
    join(root, "node_modules/marked/lib/marked.umd.js"),
    join(root, "node_modules/marked/marked.min.js"),
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, "utf8");
    } catch {
      /* try next */
    }
  }
  throw new Error("marked not found; run npm install");
}

/**
 * @param {string} mdPath path .it relative au cwd ou absolue
 * @returns {{ outFile: string }}
 */
export function buildStory(mdPath) {
  const absMd = resolve(process.cwd(), mdPath);
  const md = readFileSync(absMd, "utf8");
  const story = parseStoryMarkdown(md);

  const templatePath = join(root, "src/template.html");
  let html = readFileSync(templatePath, "utf8");

  const storyJson = JSON.stringify({
    meta: story.meta,
    nodes: story.nodes,
  });

  html = html.replace("{{STORY_JSON}}", storyJson);
  html = html.replace("{{MARKED_LIB}}", readMarkedUmd());
  html = html.replace(
    "{{RUNTIME}}",
    readFileSync(join(root, "src/runtime/story.js"), "utf8"),
  );

  const extraCss = story.css.trim();
  if (extraCss) {
    html = html.replace("/* {{EXTRA_CSS}} */", extraCss);
  } else {
    html = html.replace("/* {{EXTRA_CSS}} */", "");
  }

  const outDir = join(root, "dist");
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${slug(story.meta.title)}.html`);
  writeFileSync(outFile, html, "utf8");
  return { outFile };
}

const __filename = fileURLToPath(import.meta.url);
const isMain = resolve(process.argv[1] ?? "") === __filename;

if (isMain) {
  const mdPath = process.argv[2];
  if (!mdPath) {
    console.error("Usage: node scripts/build.mjs <fichier.it|fichier>");
    process.exit(1);
  }
  const { outFile } = buildStory(mdPath);
  console.log(outFile);
}
