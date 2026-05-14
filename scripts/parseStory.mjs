import matter from "gray-matter";

const RESERVED_CSS_ID = "_css";

/** Plus court préfixe commun en espaces / tabs (longueur brute). */
function dedentLineBlock(lines) {
  const nonempty = lines.filter((l) => l.trim());
  if (nonempty.length === 0) return "";
  let min = Infinity;
  for (const line of nonempty) {
    const m = line.match(/^[\t ]+/);
    const n = m ? m[0].length : 0;
    if (n < min) min = n;
  }
  if (!Number.isFinite(min) || min === 0) {
    return lines.join("\n").trimEnd();
  }
  return lines
    .map((l) => {
      if (!l.trim()) return "";
      const m = l.match(/^[\t ]+/);
      const n = m ? m[0].length : 0;
      return n >= min ? l.slice(min) : l.trimStart();
    })
    .join("\n")
    .trimEnd();
}

function splitBodyAndOptions(rawLines) {
  let sep = -1;
  for (let j = 0; j < rawLines.length; j++) {
    if (rawLines[j].trim() === "--") {
      sep = j;
      break;
    }
  }
  if (sep === -1) {
    return { bodyLines: rawLines, optLines: [] };
  }
  return {
    bodyLines: rawLines.slice(0, sep),
    optLines: rawLines.slice(sep + 1),
  };
}

function parseOptionsMarkdown(optMd) {
  const options = [];
  const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  const lines = optMd.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let ifNotYet = false;
    let searchIn = line;
    if (/^ifnotyet\s+/i.test(line)) {
      ifNotYet = true;
      searchIn = line.replace(/^ifnotyet\s+/i, "").trim();
    } else {
      const wm = /^\(ifnotyet\)\s*\(\s*([\s\S]*?)\s*\)\s*$/.exec(line);
      if (wm) {
        ifNotYet = true;
        searchIn = wm[1].trim();
      }
    }

    const re = new RegExp(linkRe.source, "g");
    let lm;
    while ((lm = re.exec(searchIn)) !== null) {
      const opt = { label: lm[1].trim(), target: lm[2].trim() };
      if (ifNotYet) opt.ifNotYet = true;
      options.push(opt);
    }
  }
  return options;
}

function extractCssFence(bodyMd) {
  const m = bodyMd.match(/```css\s*\n([\s\S]*?)\n```/);
  return m ? m[1].trim() : "";
}

/**
 * Après front matter : passages délimités par une ligne « titre » (sans indentation).
 * Sous chaque titre : lignes indentées ; une ligne ne contenant que `--` sépare
 * le corps (chronique) de la zone remplacée à chaque changement de node (options).
 */
function splitIndentedPassages(md) {
  const lines = md.split(/\r?\n/);
  const chunks = [];
  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && !lines[i].trim()) i++;
    if (i >= lines.length) break;
    const line = lines[i];
    if (/^[\t ]/.test(line)) {
      i += 1;
      continue;
    }
    const id = line.trim();
    i += 1;
    const rawLines = [];
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) {
        rawLines.push(l);
        i += 1;
        continue;
      }
      if (!/^[\t ]/.test(l)) break;
      rawLines.push(l);
      i += 1;
    }
    chunks.push({ id, rawLines });
  }
  return chunks;
}

export function parseStoryMarkdown(fileContent) {
  const { data, content: rawContent } = matter(fileContent);
  const rest = rawContent.trim();
  const chunks = splitIndentedPassages(rest);

  let css = "";
  const nodes = {};
  const order = [];

  for (const ch of chunks) {
    if (ch.id === RESERVED_CSS_ID) {
      const bodyMd = dedentLineBlock(ch.rawLines);
      css = extractCssFence(bodyMd);
      continue;
    }

    const { bodyLines, optLines } = splitBodyAndOptions(ch.rawLines);
    const bodyMd = dedentLineBlock(bodyLines);
    const optMd = dedentLineBlock(optLines);
    const options = parseOptionsMarkdown(optMd);

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
        : "No story passages found (expected a title line at column 0, then indented content)",
    );
  }
  return { meta, css, nodes, order };
}
