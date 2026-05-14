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

function leadingIndentWidth(line) {
  const m = line.match(/^[\t ]+/);
  return m ? m[0].length : 0;
}

/**
 * Corps puis options : la première ligne non vide plus indentée que le minimum
 * du passage ouvre le bloc options (indentation « double » par rapport au corps).
 */
function splitBodyAndOptions(rawLines) {
  const nonempty = rawLines.filter((l) => l.trim());
  if (nonempty.length === 0) {
    return { bodyLines: rawLines, optLines: [] };
  }
  let minIndent = Infinity;
  for (const l of nonempty) {
    const n = leadingIndentWidth(l);
    if (n < minIndent) minIndent = n;
  }
  if (!Number.isFinite(minIndent) || minIndent === 0) {
    return { bodyLines: rawLines, optLines: [] };
  }
  let firstOpt = -1;
  for (let j = 0; j < rawLines.length; j++) {
    const l = rawLines[j];
    if (!l.trim()) continue;
    if (leadingIndentWidth(l) > minIndent) {
      firstOpt = j;
      break;
    }
  }
  if (firstOpt === -1) {
    return { bodyLines: rawLines, optLines: [] };
  }
  return {
    bodyLines: rawLines.slice(0, firstOpt),
    optLines: rawLines.slice(firstOpt),
  };
}

/** Lignes non vides du bloc options (Markdown), évaluées au runtime comme le corps. */
function splitOptionLines(optMd) {
  const lines = [];
  for (const raw of optMd.split(/\r?\n/)) {
    const t = raw.trim();
    if (t) lines.push(t);
  }
  return lines;
}

function extractCssFence(bodyMd) {
  const m = bodyMd.match(/```css\s*\n([\s\S]*?)\n```/);
  return m ? m[1].trim() : "";
}

/**
 * Après front matter : passages délimités par une ligne « titre » (sans indentation).
 * Sous chaque titre : lignes indentées. Le corps est au niveau d’indentation minimal ;
 * les lignes plus indentées (bloc final) sont les options remplacées à chaque navigation.
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
    const optionLines = splitOptionLines(optMd);

    nodes[ch.id] = { bodyMd, optionLines };
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
