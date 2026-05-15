const vscode = require("vscode");

/** @type {vscode.OutputChannel | undefined} */
let logChannel;

function log(msg) {
  if (!logChannel) {
    logChannel = vscode.window.createOutputChannel("Interactive Story");
  }
  logChannel.appendLine(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

/** Identifiants de variables / passages (sans \\p{L} — incompatible Cursor). */
const ID = "[a-zA-Z_\\u00C0-\\u017F][a-zA-Z0-9_\\u00C0-\\u017F]*";

const COLORS = {
  passage: "#FFB74D",
  markerKeyword: "#64B5F6",
  markerParen: "#7EB6E8",
  variableName: "#81C784",
  literalValue: "#D7BA7D",
  condition: "#C586C0",
  linkLabel: "#FFFFFF",
  linkTarget: "#FFB74D",
  glitch: "#EF5350",
};

/** @type {Record<string, vscode.TextEditorDecorationType>} */
const decorations = {};

function getDecoration(key, options) {
  if (!decorations[key]) {
    decorations[key] = vscode.window.createTextEditorDecorationType(options);
  }
  return decorations[key];
}

const STYLE = {
  passage: () =>
    getDecoration("passage", { color: COLORS.passage, fontWeight: "bold" }),
  markerKeyword: () =>
    getDecoration("markerKeyword", { color: COLORS.markerKeyword }),
  markerParen: () => getDecoration("markerParen", { color: COLORS.markerParen }),
  variableName: () =>
    getDecoration("variableName", { color: COLORS.variableName }),
  literalValue: () =>
    getDecoration("literalValue", { color: COLORS.literalValue }),
  condition: () => getDecoration("condition", { color: COLORS.condition }),
  linkLabel: () => getDecoration("linkLabel", { color: COLORS.linkLabel }),
  linkTarget: () => getDecoration("linkTarget", { color: COLORS.linkTarget }),
  glitch: () =>
    getDecoration("glitch", { color: COLORS.glitch, fontStyle: "italic" }),
};

function emptyBuckets() {
  return {
    passage: [],
    markerKeyword: [],
    markerParen: [],
    variableName: [],
    literalValue: [],
    condition: [],
    linkLabel: [],
    linkTarget: [],
    glitch: [],
  };
}

/** @param {vscode.TextLine} textLine */
function pushRange(buckets, key, textLine, start, end) {
  const len = textLine.text.length;
  start = Math.max(0, Math.min(start, len));
  end = Math.max(start, Math.min(end, len));
  if (start >= end) return;
  const ln = textLine.lineNumber;
  buckets[key].push(new vscode.Range(ln, start, ln, end));
}

function pushGroup(buckets, key, line, m, groupIndex) {
  const g = m[groupIndex];
  if (!g) return;
  let searchFrom = 0;
  for (let i = 1; i < groupIndex; i++) {
    const prev = m[i];
    if (!prev) continue;
    const idx = m[0].indexOf(prev, searchFrom);
    if (idx >= 0) searchFrom = idx + prev.length;
  }
  const rel = m[0].indexOf(g, searchFrom);
  if (rel < 0) return;
  pushRange(buckets, key, line, m.index + rel, m.index + rel + g.length);
}

/** @param {RegExpExecArray} m */
function pushMarkerParens(buckets, line, m) {
  const start = m.index;
  const end = m.index + m[0].length;
  if (m[0].startsWith("(")) {
    pushRange(buckets, "markerParen", line, start, start + 1);
  }
  if (m[0].endsWith(")")) {
    pushRange(buckets, "markerParen", line, end - 1, end);
  }
}

/** @param {vscode.TextLine} line @param {Record<string, vscode.Range[]>} buckets */
function scanConditionExpr(buckets, line, condText, offset) {
  const condRe = new RegExp(
    `(${ID})\\s*(=|>=|<=|!=|<>|>|<)\\s*(\\S+)|(${ID})\\s+(\\S+)|\\b(once)\\b|(\\s&&\\s|\\s&\\s|\\s\\|\\|\\s|\\s+and\\s+|\\s+or\\s+|\\band\\b|\\bor\\b|&&|\\|\\|)`,
    "gi",
  );
  let c;
  while ((c = condRe.exec(condText)) !== null) {
    const at = (relStart, relEnd, key) =>
      pushRange(buckets, key, line, offset + relStart, offset + relEnd);
    if (c[6]) {
      at(c.index, c.index + c[6].length, "markerKeyword");
    } else if (c[7]) {
      at(c.index, c.index + c[0].length, "condition");
    } else if (c[1] && c[2] && c[3]) {
      at(c.index, c.index + c[1].length, "variableName");
      at(
        c.index + c[1].length,
        c.index + c[1].length + c[2].length,
        "condition",
      );
      const vRel = c[0].indexOf(c[3], c[0].indexOf(c[2]) + c[2].length);
      if (vRel >= 0) {
        at(c.index + vRel, c.index + vRel + c[3].length, "literalValue");
      }
    } else if (c[4] && c[5]) {
      at(c.index, c.index + c[4].length, "variableName");
      at(c.index + c[4].length + 1, c.index + c[0].length, "literalValue");
    }
  }
}

/** @param {vscode.TextLine} line @param {Record<string, vscode.Range[]>} buckets */
function scanLineTokens(line, buckets) {
  const text = line.text;
  const run = (re, fn) => {
    let regex;
    try {
      regex = re instanceof RegExp ? re : new RegExp(re.source, re.flags + (re.flags.includes("g") ? "" : "g"));
    } catch (err) {
      log(`Erreur regex: ${err.message}`);
      return;
    }
    let m;
    while ((m = regex.exec(text)) !== null) {
      try {
        fn(m);
      } catch (err) {
        log(`Erreur surlignage: ${err.message}`);
      }
    }
  };

  run(/\[([^\]]*)\]\(([^)]+)\)/g, (m) => {
    const base = m.index;
    const ib = m[0].indexOf("[");
    const ic = m[0].indexOf("]");
    const ip = m[0].indexOf("](");
    if (ib < 0 || ic < 0 || ip < 0) return;
    pushRange(buckets, "linkLabel", line, base + ib, base + ic + 1);
    pushRange(buckets, "linkTarget", line, base + ip + 1, base + m[0].length);
  });

  run(new RegExp(`\\(\\s*(set:)\\s*(${ID})\\s+([^)]+)\\)`, "gi"), (m) => {
    pushMarkerParens(buckets, line, m);
    pushGroup(buckets, "markerKeyword", line, m, 1);
    pushGroup(buckets, "variableName", line, m, 2);
    pushGroup(buckets, "literalValue", line, m, 3);
  });

  run(new RegExp(`\\(\\s*(set:)\\s*(${ID})\\s*(\\+\\+|--)\\s*\\)`, "gi"), (m) => {
    pushMarkerParens(buckets, line, m);
    pushGroup(buckets, "markerKeyword", line, m, 1);
    pushGroup(buckets, "variableName", line, m, 2);
    pushGroup(buckets, "literalValue", line, m, 3);
  });

  run(/\(\s*(ifnot:|if:)\s*([^)]+)\)/gi, (m) => {
    pushMarkerParens(buckets, line, m);
    pushGroup(buckets, "markerKeyword", line, m, 1);
    if (m[2]) {
      const innerStart = m.index + m[0].indexOf(m[2]);
      scanConditionExpr(buckets, line, m[2], innerStart);
    }
  });

  run(new RegExp(`\\(\\s*(goto:)\\s*(${ID})\\s*\\)`, "gi"), (m) => {
    pushMarkerParens(buckets, line, m);
    pushGroup(buckets, "markerKeyword", line, m, 1);
    pushGroup(buckets, "linkTarget", line, m, 2);
  });

  run(/\(\s*(wait:)\s*(\d+)\s*\)/gi, (m) => {
    pushMarkerParens(buckets, line, m);
    pushGroup(buckets, "markerKeyword", line, m, 1);
    pushGroup(buckets, "literalValue", line, m, 2);
  });

  run(/\(\s*(fx:)\s*([^)]+)\)/gi, (m) => {
    pushMarkerParens(buckets, line, m);
    pushGroup(buckets, "markerKeyword", line, m, 1);
    pushGroup(buckets, "literalValue", line, m, 2);
  });

  run(/\(\s*(once|clear|reset_variables)\s*\)/gi, (m) => {
    pushMarkerParens(buckets, line, m);
    pushGroup(buckets, "markerKeyword", line, m, 1);
  });

  run(/\bonce\s+\[/gi, (m) => {
    pushRange(buckets, "markerKeyword", line, m.index, m.index + 4);
  });

  run(new RegExp(`\\{\\{(${ID})\\}\\}`, "g"), (m) => {
    pushGroup(buckets, "variableName", line, m, 1);
  });

  run(/\$[^$\n]+\$/g, (m) => {
    pushRange(buckets, "glitch", line, m.index, m.index + m[0].length);
  });
}

/** @param {vscode.TextDocument} doc */
function collectDecorations(doc) {
  const buckets = emptyBuckets();
  let inFrontmatter = false;

  for (let i = 0; i < doc.lineCount; i++) {
    const line = doc.lineAt(i);
    const t = line.text.trim();

    if (i === 0 && t === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (t === "---") inFrontmatter = false;
      continue;
    }

    if (t && !/^[\t ]/.test(line.text)) {
      const start = line.firstNonWhitespaceCharacterIndex;
      const end = line.range.end.character;
      if (end > start) {
        buckets.passage.push(new vscode.Range(i, start, i, end));
      }
    }

    try {
      scanLineTokens(line, buckets);
    } catch (err) {
      log(`Erreur ligne ${i + 1}: ${err.message}`);
    }
  }

  return buckets;
}

/** @param {vscode.TextEditor} editor */
function updateEditorDecorations(editor) {
  if (!editor || editor.document.languageId !== "interactivestory") return;
  try {
    const buckets = collectDecorations(editor.document);
    for (const [key, ranges] of Object.entries(buckets)) {
      const style = STYLE[key];
      if (style) editor.setDecorations(style(), ranges);
    }
  } catch (err) {
    log(`Erreur décorations: ${err.message}`);
  }
}

function updateAllEditors() {
  for (const editor of vscode.window.visibleTextEditors) {
    updateEditorDecorations(editor);
  }
}

function disposeDecorations() {
  for (const d of Object.values(decorations)) d.dispose();
  for (const k of Object.keys(decorations)) delete decorations[k];
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  log("Extension activée (v0.3.11)");
  const schedule = () => updateAllEditors();

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(schedule),
    vscode.window.onDidChangeVisibleTextEditors(schedule),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId === "interactivestory") schedule();
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.languageId === "interactivestory") schedule();
    }),
    {
      dispose: () => {
        disposeDecorations();
        logChannel?.dispose();
        logChannel = undefined;
      },
    },
  );

  schedule();
}

function deactivate() {
  disposeDecorations();
  logChannel?.dispose();
  logChannel = undefined;
}

module.exports = { activate, deactivate };
