/* global marked */
(function () {
  const dataEl = document.getElementById("story-data");
  if (!dataEl) return;
  const STORY = JSON.parse(dataEl.textContent);
  const { meta, nodes } = STORY;

  /** @type {Record<string, string|number|boolean>} */
  const vars = {};

  /** Nœuds déjà affichés au moins une fois (pour `ifNotYet` sur les choix). */
  const visited = new Set();

  const chronicle = document.getElementById("chronicle");
  const optionsNav = document.getElementById("options");
  const aboutPanel = document.getElementById("about-panel");

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function parseLiteral(raw) {
    const t = raw.trim();
    if (/^true$/i.test(t)) return true;
    if (/^false$/i.test(t)) return false;
    if (/^(-?\d+(\.\d+)?)$/.test(t)) return Number(t);
    const m = /^"([^"]*)"$/.exec(t);
    if (m) return m[1];
    return t;
  }

  function truthy(v) {
    if (v === false || v === 0 || v === "") return false;
    if (v == null) return false;
    return true;
  }

  function valuesEqual(a, b) {
    if (typeof a === "number" && typeof b === "string" && /^-?\d/.test(b))
      return a === Number(b);
    if (typeof b === "number" && typeof a === "string" && /^-?\d/.test(a))
      return Number(a) === b;
    return a === b;
  }

  function evalCondition(expr) {
    const e = expr.trim();
    const eq = /^(\w+)\s*=\s*(.+)$/.exec(e);
    if (eq) {
      const name = eq[1];
      const lit = parseLiteral(eq[2].trim());
      return valuesEqual(vars[name], lit);
    }
    const shorthand = /^(\w+)\s+(\S+)$/.exec(e);
    if (shorthand) {
      return valuesEqual(vars[shorthand[1]], parseLiteral(shorthand[2]));
    }
    return truthy(vars[e]);
  }

  /** Affiche la valeur d’une variable dans le markdown (corps, ternaires, blocs binaires). */
  function expandVars(s) {
    return s.replace(/\{\{(\w+)\}\}/g, (_, name) => {
      const v = vars[name];
      if (v === undefined || v === null) return "";
      return String(v);
    });
  }

  /** Si le fragment est uniquement un id de node connu, en faire un lien Markdown. */
  function ensureStoryLinkIfBareNodeId(fragment) {
    const t = fragment.trim();
    if (!t || /[\s\[\]()]/.test(t)) return fragment;
    if (nodes[t]) return `[${t}](${t})`;
    return fragment;
  }

  function applySet(inner) {
    const s = inner.trim();
    const inc = /^(\w+)\s*(\+\+|--)$/.exec(s);
    if (inc) {
      const k = inc[1];
      const cur = Number(vars[k]);
      if (!Number.isFinite(cur)) return;
      vars[k] = inc[2] === "++" ? cur + 1 : cur - 1;
      return;
    }
    const sp = s.indexOf(" ");
    if (sp === -1) return;
    const name = s.slice(0, sp).trim();
    const rest = s.slice(sp + 1).trim();
    vars[name] = parseLiteral(rest);
  }

  function consumeParenBlock(str, openIdx) {
    let depth = 0;
    for (let i = openIdx; i < str.length; i++) {
      const ch = str[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) return { end: i, inner: str.slice(openIdx + 1, i) };
      }
    }
    return null;
  }

  function splitThreeBySemicolons(body) {
    let first = -1;
    let second = -1;
    let inQuote = false;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === '"') inQuote = !inQuote;
      if (!inQuote && c === ";") {
        if (first === -1) first = i;
        else if (second === -1) {
          second = i;
          break;
        }
      }
    }
    if (first === -1 || second === -1) return null;
    return [
      body.slice(0, first).trim(),
      body.slice(first + 1, second).trim(),
      body.slice(second + 1).trim(),
    ];
  }

  function evalEqualityCond(condStr) {
    const e = condStr.trim();
    const eq = /^(\w+)\s*=\s*(.+)$/.exec(e);
    if (!eq) return null;
    return valuesEqual(vars[eq[1]], parseLiteral(eq[2].trim()));
  }

  function parseIfInner(inner) {
    if (inner.startsWith("ifnot:")) {
      return { kind: "ifnot", body: inner.slice(7).trim() };
    }
    if (inner.startsWith("if:")) {
      return { kind: "if", body: inner.slice(4).trim() };
    }
    return null;
  }

  function replaceConditionalMarkers(s, depth) {
    let out = s;
    let pos = 0;
    let guard = 0;
    while (guard++ < 5000) {
      const iNot = out.indexOf("(ifnot:", pos);
      const iIf = out.indexOf("(if:", pos);
      if (iNot === -1 && iIf === -1) break;
      const useNot = iNot !== -1 && (iIf === -1 || iNot < iIf);
      const openIdx = useNot ? iNot : iIf;

      const blk = consumeParenBlock(out, openIdx);
      if (!blk) {
        pos = openIdx + 1;
        continue;
      }

      const parsed = parseIfInner(blk.inner);
      if (!parsed) {
        pos = openIdx + 1;
        continue;
      }

      let k = blk.end + 1;
      while (k < out.length && /\s/.test(out[k])) k++;
      const isBinary = k < out.length && out[k] === "(";

      let replacement = "";
      let replaceEnd = blk.end;

      if (isBinary) {
        const blk2 = consumeParenBlock(out, k);
        if (!blk2) {
          pos = openIdx + 1;
          continue;
        }
        replaceEnd = blk2.end;
        const cond = parsed.body;
        const innerRaw = blk2.inner.trim();
        const take =
          parsed.kind === "if" ? evalCondition(cond) : !evalCondition(cond);
        if (take) {
          if (depth >= 12) {
            replacement = "";
          } else {
            replacement = ensureStoryLinkIfBareNodeId(
              processMarkers(innerRaw, depth + 1),
            );
          }
        }
      } else {
        const parts = splitThreeBySemicolons(parsed.body);
        if (!parts) {
          pos = openIdx + 1;
          continue;
        }
        const eq = evalEqualityCond(parts[0]);
        if (eq === null) {
          pos = openIdx + 1;
          continue;
        }
        const branch = parsed.kind === "if" ? (eq ? parts[1] : parts[2]) : !eq ? parts[1] : parts[2];
        if (depth >= 12) {
          replacement = "";
        } else {
          replacement = processMarkers(branch, depth + 1);
        }
      }

      out = out.slice(0, openIdx) + replacement + out.slice(replaceEnd + 1);
      pos = openIdx + replacement.length;
    }
    return out;
  }

  function processMarkers(md, depth = 0) {
    if (depth > 12) return md;
    let out = md;
    const setRe = /\(set:\s*([^)]+)\)/g;
    let m;
    const sets = [];
    while ((m = setRe.exec(md)) !== null) sets.push({ raw: m[0], inner: m[1] });
    for (const st of sets) {
      applySet(st.inner);
      out = out.split(st.raw).join("");
    }

    out = replaceConditionalMarkers(out, depth);
    return expandVars(out);
  }

  marked.use({
    breaks: true,
    renderer: {
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
        if (nodes[href] && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
          return `<a href="#" class="story-goto" data-node="${escapeAttr(href)}"${titleAttr}>${text}</a>`;
        }
        const safeHref = escapeAttr(href);
        return `<a href="${safeHref}" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
      },
    },
  });

  function renderMd(md) {
    const processed = processMarkers(md);
    return marked.parse(processed, { async: false });
  }

  function renderOptions(list) {
    optionsNav.innerHTML = "";
    if (!list || list.length === 0) return;
    const visible = list.filter(
      (opt) => !opt.ifNotYet || !visited.has(opt.target),
    );
    if (visible.length === 0) return;
    const ul = document.createElement("ul");
    for (const opt of visible) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = "#";
      a.className = "story-goto";
      a.dataset.node = opt.target;
      a.textContent = opt.label;
      li.appendChild(a);
      ul.appendChild(li);
    }
    optionsNav.appendChild(ul);
  }

  function appendNodeBlock(nodeId) {
    const node = nodes[nodeId];
    if (!node) return;
    visited.add(nodeId);
    const article = document.createElement("article");
    article.className = "story-node";
    article.dataset.node = nodeId;
    article.innerHTML = renderMd(node.bodyMd);
    chronicle.appendChild(article);
    renderOptions(node.options);
  }

  function goToNode(nodeId) {
    if (!nodes[nodeId]) return;
    appendNodeBlock(nodeId);
    chronicle.scrollTop = chronicle.scrollHeight;
  }

  document.addEventListener("click", (ev) => {
    const a = ev.target.closest("a.story-goto");
    if (!a) return;
    if (!chronicle.contains(a) && !optionsNav.contains(a)) return;
    ev.preventDefault();
    const id = a.dataset.node;
    if (id) goToNode(id);
  });

  if (aboutPanel) {
    const bits = [
      meta.version && `<p><strong>Version</strong> ${escapeHtml(meta.version)}</p>`,
      meta.author && `<p><strong>Auteur</strong> ${escapeHtml(meta.author)}</p>`,
      meta.email &&
        `<p><strong>Mail</strong> <a href="mailto:${escapeAttr(meta.email)}">${escapeHtml(meta.email)}</a></p>`,
      meta.link &&
        `<p><strong>Lien</strong> <a href="${escapeAttr(meta.link)}" rel="noopener noreferrer">${escapeHtml(meta.link)}</a></p>`,
    ]
      .filter(Boolean)
      .join("");
    aboutPanel.innerHTML = bits || "<p>(aucune métadonnée)</p>";
  }

  document.title = meta.title || document.title;
  appendNodeBlock(meta.start);
})();
