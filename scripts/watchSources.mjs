import { watch } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

/**
 * @param {string} mdPath chemin .it (relatif cwd ou absolu)
 * @param {(reason: string) => void} onChange debounced callback
 * @param {{ debounceMs?: number }} [opts]
 */
export function watchStorySources(mdPath, onChange, opts = {}) {
  const debounceMs = opts.debounceMs ?? 200;
  const absMd = resolve(process.cwd(), mdPath);
  const paths = [
    absMd,
    join(root, "src/template.html"),
    join(root, "src/runtime/story.js"),
    join(root, "scripts/parseStory.mjs"),
  ];

  let timer = null;
  const schedule = (reason) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange(reason);
    }, debounceMs);
  };

  const unwatchers = [];
  for (const p of paths) {
    try {
      const w = watch(p, { persistent: true }, (_evt) => {
        schedule(p);
      });
      unwatchers.push(() => w.close());
    } catch (e) {
      console.error("watch error for", p, e);
    }
  }

  return () => {
    if (timer) clearTimeout(timer);
    for (const u of unwatchers) u();
  };
}
