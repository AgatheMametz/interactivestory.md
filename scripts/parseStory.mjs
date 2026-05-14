import matter from "gray-matter";

const H1 = /^#\s+(.+)$/m;
const H1_NOSPACE = /^#([^\s#].*)$/m;
const OPTIONS_HEADING = /^##\s+options\s*$/im;
const CSS_HEADING = /^##\s+css\s*$/im;
const FENCED_CSS = /^```css\s*\n([\s\S]*?)\n```\s*$/m;

function stripCssSection(md) {
  const m = md.match(CSS_HEADING);
  if (!m) return { css: "", rest: md };
  const after = md.slice(m.index + m[0].length);
  const fence = after.match(FENCED_CSS);
  if (!fence) return { css: "", rest: md };
  const css = fence[1].trim();
  const rest =
    md.slice(0, m.index).trimEnd() +
    "\n\n" +
    after.slice(fence.index + fence[0].length).trimStart();
  return { css, rest: rest.trim() };
}

function splitByH1(md) {
  const lines = md.split(/\r?\n/);
  const chunks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const mSpace = line.match(/^#\s+(.+)$/);
    const mNo = line.match(/^#([^\s#].*)$/);
    const title = mSpace?.[1]?.trim() ?? (mNo && !line.startsWith("##") ? mNo[1].trim() : null);
    if (title == null) {
      i += 1;
      continue;
    }
    const id = title;
    i += 1;
    const bodyLines = [];
    while (i < lines.length) {
      const l = lines[i];
      if (/^#\s/.test(l) || /^#[^\s#]/.test(l)) break;
      bodyLines.push(l);
      i += 1;
    }
    chunks.push({ id, raw: bodyLines.join("\n").trimEnd() });
  }
  return chunks;
}

function parseNodeBody(raw) {
  const m = raw.match(OPTIONS_HEADING);
  if (!m) {
    return { bodyMd: raw.trim(), options: [] };
  }
  const bodyMd = raw.slice(0, m.index).trim();
  const optMd = raw.slice(m.index + m[0].length).trim();
  const options = [];
  const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  let lm;
  while ((lm = linkRe.exec(optMd)) !== null) {
    options.push({ label: lm[1].trim(), target: lm[2].trim() });
  }
  return { bodyMd, options };
}

export function parseStoryMarkdown(fileContent) {
  const { data, content: rawContent } = matter(fileContent);
  const { css, rest } = stripCssSection(rawContent.trim());
  const chunks = splitByH1(rest);
  const nodes = {};
  const order = [];
  for (const ch of chunks) {
    const { bodyMd, options } = parseNodeBody(ch.raw);
    nodes[ch.id] = { bodyMd, options };
    order.push(ch.id);
  }
  const meta = {
    title: data.title ?? "Untitled",
    version: data.version ?? "",
    author: data.author ?? "",
    email: data.email ?? "",
    link: data.link ?? "",
    start: data.start ?? order[0] ?? null,
  };
  if (!meta.start || !nodes[meta.start]) {
    throw new Error(
      meta.start
        ? `Unknown start node "${meta.start}"`
        : "No story nodes found (expected at least one # heading)",
    );
  }
  return { meta, css, nodes, order };
}
