/* global marked */
(function () {
  const dataEl = document.getElementById("story-data");
  if (!dataEl) return;
  const STORY = JSON.parse(dataEl.textContent);
  const { meta, nodes, order: storyOrder } = STORY;

  const STORAGE_SAVE_VERSION = 1;
  const STORAGE_PREFIX = "interactivestory_v1_";

  /** Ordre des passages affichés (persisté au reload). */
  const nodeHistory = [];
  /** Pendant la restauration, ne pas réécrire localStorage à chaque nœud. */
  let restorePass = false;

  /** @type {Record<string, string|number|boolean>} */
  const vars = {};

  /** Nœuds déjà affichés au moins une fois (pour `once` sur les choix). */
  const visited = new Set();

  /** Mis à `true` si `processMarkers` retire un `(clear)` du texte courant. */
  let pendingChronicleClear = false;
  /** Id de passage à afficher après le rendu du passage courant (`(goto: id)`). */
  let pendingGoto = null;
  /** Timer chaîné pour les `(wait: N)` entre morceaux d’un même passage. */
  let nodeWaitTimerId = 0;

  const chronicle = document.getElementById("chronicle");
  const storyRoot = document.getElementById("story-root");
  const optionsNav = document.getElementById("options");
  const aboutPanel = document.getElementById("about-panel");
  const varsPanel = document.getElementById("vars-panel");
  const varsDetails = varsPanel && varsPanel.closest("details");

  const VARS_OPEN_COOKIE = "interactivestory_vars_open";
  const VARS_OPEN_MAX_AGE = 365 * 24 * 60 * 60;

  function readVarsDetailsOpenCookie() {
    const prefix = `${VARS_OPEN_COOKIE}=`;
    for (const part of document.cookie.split("; ")) {
      if (part.startsWith(prefix)) {
        const v = part.slice(prefix.length);
        if (v === "1") return true;
        if (v === "0") return false;
      }
    }
    return null;
  }

  function writeVarsDetailsOpenCookie(open) {
    const path =
      typeof location !== "undefined" && location.pathname
        ? location.pathname
        : "/";
    const secure =
      typeof location !== "undefined" && location.protocol === "https:"
        ? "; Secure"
        : "";
    document.cookie = `${VARS_OPEN_COOKIE}=${open ? "1" : "0"}; path=${path}; max-age=${VARS_OPEN_MAX_AGE}; SameSite=Lax${secure}`;
  }

  if (varsDetails) {
    const savedOpen = readVarsDetailsOpenCookie();
    if (savedOpen !== null) varsDetails.open = savedOpen;
    varsDetails.addEventListener("toggle", () => {
      writeVarsDetailsOpenCookie(varsDetails.open);
    });
  }

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

  /** Invalide la sauvegarde si un passage (corps ou options) change — évite de rejouer sans `(wait:)` après édition. */
  function storyNodesContentHash() {
    let h = 2166136261 >>> 0;
    for (const id of Object.keys(nodes).sort()) {
      const n = nodes[id];
      const blob = `${id}\0${n?.bodyMd ?? ""}\0${(n?.optionLines ?? []).join("\n")}`;
      for (let i = 0; i < blob.length; i++) {
        h ^= blob.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
    }
    return h.toString(16);
  }

  function computeFingerprint() {
    return `${meta.start}|${String(meta.version ?? "")}|${Object.keys(nodes).length}|${storyNodesContentHash()}`;
  }

  function getStorageKey() {
    const title = meta.title || "story";
    const safeTitle = encodeURIComponent(title).slice(0, 100);
    const start = encodeURIComponent(String(meta.start ?? ""));
    return `${STORAGE_PREFIX}${safeTitle}_${start}`;
  }

  function snapshotVarsEqual(a, b) {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.length !== keysB.length) return false;
    for (const k of keysA) {
      if (!valuesEqual(a[k], b[k])) return false;
    }
    return true;
  }

  function visitedMatchesSaved(set, arr) {
    if (!Array.isArray(arr) || set.size !== arr.length) return false;
    for (const x of arr) {
      if (!set.has(x)) return false;
    }
    return true;
  }

  function validateNodeHistory(ids) {
    return (
      Array.isArray(ids) &&
      ids.length > 0 &&
      ids.every((id) => typeof id === "string" && nodes[id])
    );
  }

  function readSave() {
    try {
      const raw = localStorage.getItem(getStorageKey());
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (
        !o ||
        o.v !== STORAGE_SAVE_VERSION ||
        typeof o.fingerprint !== "string" ||
        o.fingerprint !== computeFingerprint() ||
        !validateNodeHistory(o.nodeHistory) ||
        !o.vars ||
        typeof o.vars !== "object" ||
        !Array.isArray(o.visited)
      )
        return null;
      return o;
    } catch {
      return null;
    }
  }

  function persistState() {
    try {
      localStorage.setItem(
        getStorageKey(),
        JSON.stringify({
          v: STORAGE_SAVE_VERSION,
          fingerprint: computeFingerprint(),
          nodeHistory: nodeHistory.slice(),
          vars: { ...vars },
          visited: [...visited],
        }),
      );
    } catch {
      /* quota ou mode privé */
    }
  }

  function wipeRuntimeDomAndState() {
    teardownPageGlitchBurst();
    if (nodeWaitTimerId) {
      clearTimeout(nodeWaitTimerId);
      nodeWaitTimerId = 0;
    }
    if (storyRoot) {
      storyRoot.style.removeProperty("--fx-page-invert");
      storyRoot.style.removeProperty("--fx-page-hue-extra");
      storyRoot.classList.remove("story-root--fx-invert-live");
    }
    if (chronicle) chronicle.replaceChildren();
    if (optionsNav) optionsNav.innerHTML = "";
    visited.clear();
    nodeHistory.length = 0;
    for (const k of Object.keys(vars)) delete vars[k];
  }

  /**
   * Rejoue l’historique depuis zéro (les (set:) du corps reconstituent `vars`).
   * @returns {boolean}
   */
  function tryRestoreFromSave(saved) {
    wipeRuntimeDomAndState();
    restorePass = true;
    for (const id of saved.nodeHistory) {
      const node = nodes[id];
      if (!node) {
        restorePass = false;
        wipeRuntimeDomAndState();
        return false;
      }
      appendNodeBlock(id);
    }
    restorePass = false;
    const historyOk =
      nodeHistory.length === saved.nodeHistory.length &&
      saved.nodeHistory.every((id, i) => nodeHistory[i] === id);
    const stateOk =
      snapshotVarsEqual(vars, saved.vars) &&
      visitedMatchesSaved(visited, saved.visited);
    if (!historyOk || !stateOk) {
      wipeRuntimeDomAndState();
      return false;
    }
    return true;
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

  function compareValues(a, b) {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return String(a).localeCompare(String(b), "fr", { sensitivity: "base" });
  }

  /** Découpe `a & b or c` en respectant les guillemets (priorité AND/OR gérée par l’appelant). */
  function splitLogical(expr, kind) {
    const re =
      kind === "or"
        ? /\s+(?:or|\|\|)\s+/giu
        : /\s+(?:&&|&|\band\b)\s+/giu;
    const parts = [];
    let start = 0;
    let inQuote = false;
    let i = 0;
    while (i < expr.length) {
      if (expr[i] === '"') {
        inQuote = !inQuote;
        i += 1;
        continue;
      }
      if (!inQuote) {
        re.lastIndex = i;
        const m = re.exec(expr);
        if (m && m.index === i) {
          parts.push(expr.slice(start, i));
          i = m.index + m[0].length;
          start = i;
          continue;
        }
      }
      i += 1;
    }
    parts.push(expr.slice(start));
    return parts.map((p) => p.trim()).filter(Boolean);
  }

  function firstMarkdownLinkTarget(s) {
    const m = /\[([^\]]*)\]\(([^)]+)\)/.exec(s);
    return m ? m[2].trim() : null;
  }

  function evalConditionAtom(expr, condCtx = {}) {
    const e = expr.trim();
    if (!e) return false;
    if (/^once$/i.test(e)) {
      const t = condCtx.optionTarget;
      if (!t) return false;
      return !visited.has(t);
    }
    const cmp = /^([\p{L}_][\p{L}\p{N}_]*)\s*(>=|<=|!=|<>|>|<)\s*(.+)$/u.exec(
      e,
    );
    if (cmp) {
      const left = vars[cmp[1]];
      const right = parseLiteral(cmp[3].trim());
      const op = cmp[2];
      const c = compareValues(left, right);
      if (op === ">") return c > 0;
      if (op === "<") return c < 0;
      if (op === ">=") return c >= 0;
      if (op === "<=") return c <= 0;
      if (op === "!=" || op === "<>") return !valuesEqual(left, right);
    }
    const eq = /^([\p{L}_][\p{L}\p{N}_]*)\s*=\s*(.+)$/u.exec(e);
    if (eq) {
      const name = eq[1];
      const lit = parseLiteral(eq[2].trim());
      return valuesEqual(vars[name], lit);
    }
    const shorthand = /^([\p{L}_][\p{L}\p{N}_]*)\s+(\S+)$/u.exec(e);
    if (shorthand) {
      return valuesEqual(vars[shorthand[1]], parseLiteral(shorthand[2]));
    }
    return truthy(vars[e]);
  }

  /** Conditions composées : AND (`&`, `&&`, `and`) puis OR (`or`, `||`) — AND plus prioritaire. */
  function evalCondition(expr, condCtx = {}) {
    const e = expr.trim();
    if (!e) return false;
    const orParts = splitLogical(e, "or");
    if (orParts.length > 1) {
      return orParts.some((part) => {
        const andParts = splitLogical(part, "and");
        return andParts.every((atom) => evalConditionAtom(atom, condCtx));
      });
    }
    const andParts = splitLogical(e, "and");
    if (andParts.length > 1) {
      return andParts.every((atom) => evalConditionAtom(atom, condCtx));
    }
    return evalConditionAtom(e, condCtx);
  }

  /** Affiche la valeur d’une variable dans le markdown (corps, ternaires, blocs binaires). */
  function expandVars(s) {
    return s.replace(/\{\{([\p{L}_][\p{L}\p{N}_]*)\}\}/gu, (_, name) => {
      const v = vars[name];
      if (v === undefined || v === null) return "";
      return String(v);
    });
  }

  /**
   * Effets page : (fx: glitch)… ; (fx: invert true) / (fx: invert false) pilotent invert + hue 180 pendant le glitch.
   * Sur une option, (fx: invert …) s’applique au clic (avant le glitch si présent).
   */
  let pendingPageGlitch = null;
  let pendingPageFxInvert = null;
  let pageGlitchEndTimerId = 0;
  /** Sauvegarde de `html.style.backgroundColor` avant d’aligner sur le fond du body pendant le glitch. */
  let pageGlitchHtmlBgBackup = null;

  function snapshotGlitchPageBackdrop() {
    const body = document.body;
    if (!body) return;
    const bc = getComputedStyle(body).backgroundColor;
    const transparent =
      !bc ||
      bc === "rgba(0, 0, 0, 0)" ||
      bc === "transparent" ||
      /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/i.test(bc.trim());
    if (transparent) {
      document.documentElement.style.removeProperty("--story-page-glitch-backdrop");
      return;
    }
    document.documentElement.style.setProperty("--story-page-glitch-backdrop", bc);
    if (pageGlitchHtmlBgBackup === null) {
      pageGlitchHtmlBgBackup = document.documentElement.style.backgroundColor;
      document.documentElement.style.backgroundColor = bc;
    }
  }

  function clearGlitchPageBackdrop() {
    document.documentElement.style.removeProperty("--story-page-glitch-backdrop");
    if (pageGlitchHtmlBgBackup !== null) {
      document.documentElement.style.backgroundColor = pageGlitchHtmlBgBackup;
      pageGlitchHtmlBgBackup = null;
    }
  }

  function teardownPageGlitchBurst() {
    cancelPageGlitchEndScheduling();
    if (storyRoot) {
      storyRoot.classList.remove(
        "story-root--page-glitch",
        "story-root--page-glitch-strong",
      );
    }
    clearGlitchPageBackdrop();
  }

  function cancelPageGlitchEndScheduling() {
    if (storyRoot) {
      storyRoot.removeEventListener("animationend", onStoryPageGlitchAnimationEnd);
    }
    if (pageGlitchEndTimerId) {
      clearTimeout(pageGlitchEndTimerId);
      pageGlitchEndTimerId = 0;
    }
  }

  function onStoryPageGlitchAnimationEnd(ev) {
    if (!storyRoot || ev.target !== storyRoot) return;
    if (ev.animationName !== "story-page-glitch-main") return;
    if (ev.pseudoElement) return;
    teardownPageGlitchBurst();
  }

  /** Durée en ms de `--story-page-glitch-duration` sur `:root` (fallback 500). */
  function readPageGlitchDurationMs() {
    try {
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue("--story-page-glitch-duration")
        .trim();
      if (!raw) return 100;
      const mMs = /^([\d.]+)\s*ms$/i.exec(raw);
      if (mMs) {
        const n = Number(mMs[1]);
        return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 500;
      }
      const mS = /^([\d.]+)\s*s$/i.exec(raw);
      if (mS) {
        const n = Number(mS[1]);
        return Number.isFinite(n) ? Math.max(0, Math.round(n * 1000)) : 500;
      }
    } catch {
      /* ignore */
    }
    return 500;
  }

  /** Glitch plein écran : durée CSS puis retrait des classes (animationend ou délai si reduced-motion). */
  function armPageGlitchAutoEnd() {
    if (!storyRoot) return;
    cancelPageGlitchEndScheduling();
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      pageGlitchEndTimerId = window.setTimeout(() => {
        pageGlitchEndTimerId = 0;
        teardownPageGlitchBurst();
      }, readPageGlitchDurationMs());
      return;
    }
    storyRoot.addEventListener("animationend", onStoryPageGlitchAnimationEnd);
  }

  /**
   * Même animation que (fx: glitch) dans le corps, puis résolution de la Promise (clic sur une option).
   * @param {"on"|"strong"} mode
   */
  function runPageGlitchBurst(mode) {
    if (!storyRoot) return Promise.resolve();
    teardownPageGlitchBurst();
    void storyRoot.offsetHeight;
    snapshotGlitchPageBackdrop();
    if (mode === "strong") {
      storyRoot.classList.add("story-root--page-glitch", "story-root--page-glitch-strong");
    } else {
      storyRoot.classList.add("story-root--page-glitch");
    }
    void storyRoot.offsetHeight;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      return new Promise((resolve) => {
        pageGlitchEndTimerId = window.setTimeout(() => {
          pageGlitchEndTimerId = 0;
          teardownPageGlitchBurst();
          resolve();
        }, readPageGlitchDurationMs());
      });
    }
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        storyRoot.removeEventListener("animationend", onEnd);
        clearTimeout(fallback);
        teardownPageGlitchBurst();
        resolve();
      };
      const onEnd = (ev) => {
        if (ev.target !== storyRoot) return;
        if (ev.animationName !== "story-page-glitch-main") return;
        if (ev.pseudoElement) return;
        finish();
      };
      const fallback = window.setTimeout(finish, readPageGlitchDurationMs() + 100);
      storyRoot.addEventListener("animationend", onEnd);
    });
  }

  function applyStoryRootFxInvertFlag(on) {
    if (!storyRoot) return;
    if (on) {
      storyRoot.style.setProperty("--fx-page-invert", "1");
      storyRoot.style.setProperty("--fx-page-hue-extra", "180deg");
      storyRoot.classList.add("story-root--fx-invert-live");
      snapshotGlitchPageBackdrop();
    } else {
      storyRoot.style.setProperty("--fx-page-invert", "0");
      storyRoot.style.setProperty("--fx-page-hue-extra", "0deg");
      storyRoot.classList.remove("story-root--fx-invert-live");
      clearGlitchPageBackdrop();
    }
  }

  function syncPendingPageFxInvert() {
    if (pendingPageFxInvert == null || !storyRoot) {
      pendingPageFxInvert = null;
      return;
    }
    applyStoryRootFxInvertFlag(pendingPageFxInvert === true);
    pendingPageFxInvert = null;
  }

  function applyFxMarkers(s) {
    return s.replace(/\(\s*fx:\s*([^)]+)\)/gi, (_, inner) => {
      const compact = String(inner).trim().toLowerCase().replace(/\s+/g, "");
      if (compact === "inverttrue") {
        pendingPageFxInvert = true;
        return "";
      }
      if (compact === "invertfalse") {
        pendingPageFxInvert = false;
        return "";
      }
      if (compact === "glitch" || compact === "glitchon") {
        pendingPageGlitch = "on";
        return "";
      }
      if (compact === "glitch++" || compact === "glitchstrong") {
        pendingPageGlitch = "strong";
        return "";
      }
      if (compact === "glitchoff" || compact === "noglitch") {
        pendingPageGlitch = "off";
        return "";
      }
      return "";
    });
  }

  function syncPendingPageGlitch() {
    if (pendingPageGlitch == null || !storyRoot) {
      pendingPageGlitch = null;
      return;
    }
    if (pendingPageGlitch === "off") {
      teardownPageGlitchBurst();
    } else if (pendingPageGlitch === "strong") {
      cancelPageGlitchEndScheduling();
      storyRoot.classList.remove(
        "story-root--page-glitch",
        "story-root--page-glitch-strong",
      );
      void storyRoot.offsetHeight;
      snapshotGlitchPageBackdrop();
      storyRoot.classList.add("story-root--page-glitch", "story-root--page-glitch-strong");
      armPageGlitchAutoEnd();
    } else if (pendingPageGlitch === "on") {
      cancelPageGlitchEndScheduling();
      storyRoot.classList.remove(
        "story-root--page-glitch",
        "story-root--page-glitch-strong",
      );
      void storyRoot.offsetHeight;
      snapshotGlitchPageBackdrop();
      storyRoot.classList.add("story-root--page-glitch");
      armPageGlitchAutoEnd();
    }
    pendingPageGlitch = null;
  }

  /** `$texte$` → span effet glitch (texte échappé, pas de Markdown à l’intérieur). */
  function applyGlitchMarkers(s) {
    return s.replace(/\$([^$]+)\$/gu, (_, inner) => {
      const text = String(inner);
      const esc = escapeHtml(text);
      return `<span class="text-glitch" data-text="${escapeAttr(text)}">${esc}</span>`;
    });
  }

  /**
   * `[texte](cible)(removelink)` : au rendu, toujours un lien cliquable.
   * Les entrées déjà dans la chronique perdent le lien quand `cible` est visitée
   * (`stripChronicleRemoveLinksTo`) ; un retour sur le nœud source réaffiche le lien.
   */
  function applyRemoveLinkMarkers(s) {
    return s.replace(
      /\[([^\]]*)\]\(([^)]+)\)\s*\(\s*removelink\s*\)/gi,
      (_, label, target) => `[${label}](${target.trim()} "removelink")`,
    );
  }

  /** Remplace un lien `(removelink)` par son texte (sans casser le formatage inline). */
  function unwrapStoryGotoLink(a) {
    const span = document.createElement("span");
    span.innerHTML = a.innerHTML;
    a.replaceWith(span);
    return span;
  }

  /** Remplace par du texte les liens `(removelink)` de la chronique vers un passage déjà joué. */
  function stripChronicleRemoveLinksTo(targetId) {
    if (!chronicle) return;
    for (const a of chronicle.querySelectorAll(
      'a.story-goto[data-removelink="1"]',
    )) {
      if (a.dataset.node !== targetId) continue;
      unwrapStoryGotoLink(a);
    }
  }

  /** Si le fragment est uniquement un id de node connu, en faire un lien Markdown. */
  function ensureStoryLinkIfBareNodeId(fragment) {
    const t = fragment.trim();
    if (!t || /[\s\[\]()]/.test(t)) return fragment;
    if (nodes[t]) return `[${t}](${t})`;
    return fragment;
  }

  function resetAllVariables() {
    for (const k of Object.keys(vars)) delete vars[k];
  }

  function applySet(inner) {
    const s = inner.trim();
    const inc = /^([\p{L}_][\p{L}\p{N}_]*)\s*(\+\+|--)$/u.exec(s);
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
    const eq = /^([\p{L}_][\p{L}\p{N}_]*)\s*=\s*(.+)$/u.exec(e);
    if (!eq) return null;
    return valuesEqual(vars[eq[1]], parseLiteral(eq[2].trim()));
  }

  function parseIfInner(inner) {
    if (inner.startsWith("ifnot:")) {
      return { kind: "ifnot", body: inner.slice(7).trim() };
    }
    if (inner.startsWith("if:")) {
      return { kind: "if", body: inner.slice(3).trim() };
    }
    return null;
  }

  function isGotoMarkerBlock(s) {
    return /^\(\s*goto:\s*[\p{L}_][\p{L}\p{N}_]*\s*\)$/iu.test(s.trim());
  }

  /** Bloc binaire `(if:…)(…)` : garder les `()` seulement pour `(set:)` / `(goto:)`. */
  function binaryIfInnerForProcess(inner, fullBlock) {
    if (/^set:/i.test(inner) || /^goto:/i.test(inner)) return fullBlock;
    return inner;
  }

  function replaceConditionalMarkers(s, depth, ctx) {
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
      const isBinary =
        k < out.length && (out[k] === "(" || out[k] === "[");

      let replacement = "";
      let replaceEnd = blk.end;

      if (isBinary) {
        let innerRaw = "";
        if (out[k] === "(") {
          const blk2 = consumeParenBlock(out, k);
          if (!blk2) {
            pos = openIdx + 1;
            continue;
          }
          replaceEnd = blk2.end;
          const inner = blk2.inner.trim();
          const fullBlock = out.slice(k, blk2.end + 1);
          if (/^once$/i.test(inner)) {
            let k3 = replaceEnd + 1;
            while (k3 < out.length && /\s/.test(out[k3])) k3++;
            if (out[k3] === "(") {
              const blk3 = consumeParenBlock(out, k3);
              if (blk3) {
                innerRaw = blk3.inner.trim();
                replaceEnd = blk3.end;
              }
            } else if (out[k3] === "[") {
              const linkM = /^\[([^\]]*)\]\(([^)]+)\)/.exec(out.slice(k3));
              if (linkM) {
                innerRaw = linkM[0];
                replaceEnd = k3 + linkM[0].length - 1;
              }
            }
          } else {
            innerRaw = binaryIfInnerForProcess(inner, fullBlock);
          }
        } else {
          const linkM = /^\[([^\]]*)\]\(([^)]+)\)/.exec(out.slice(k));
          if (!linkM) {
            pos = openIdx + 1;
            continue;
          }
          innerRaw = linkM[0];
          replaceEnd = k + linkM[0].length - 1;
        }
        const cond = parsed.body;
        const optionTarget = firstMarkdownLinkTarget(innerRaw);
        const condCtx = optionTarget ? { optionTarget } : {};
        let take =
          parsed.kind === "if"
            ? evalCondition(cond, condCtx)
            : !evalCondition(cond, condCtx);
        if (take) {
          if (depth >= 12) {
            replacement = "";
          } else {
            replacement = ensureStoryLinkIfBareNodeId(
              processMarkers(innerRaw, depth + 1, ctx),
            );
          }
          if (pendingGoto && isGotoMarkerBlock(innerRaw)) {
            out = out.slice(0, openIdx) + replacement;
            return out;
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
          replacement = processMarkers(branch, depth + 1, ctx);
        }
      }

      out = out.slice(0, openIdx) + replacement + out.slice(replaceEnd + 1);
      pos = openIdx + replacement.length;
    }
    return out;
  }

  function processMarkers(md, depth = 0, ctx = {}) {
    if (depth > 12) return md;
    let out = md;

    out = replaceConditionalMarkers(out, depth, ctx);

    out = out.replace(/\(\s*reset_variables\s*\)/gi, () => {
      resetAllVariables();
      return "";
    });

    if (!ctx.skipGoto) {
      out = out.replace(
        /\(\s*goto:\s*([\p{L}_][\p{L}\p{N}_]*)\s*\)/giu,
        (_, target) => {
          const id = target.trim();
          if (nodes[id]) pendingGoto = id;
          return "";
        },
      );
    } else {
      out = out.replace(
        /\(\s*goto:\s*[\p{L}_][\p{L}\p{N}_]*\s*\)/giu,
        "",
      );
    }

    if (!ctx.skipSet) {
      const setRe = /\(set:\s*([^)]+)\)/g;
      let m;
      const sets = [];
      while ((m = setRe.exec(out)) !== null) sets.push({ raw: m[0], inner: m[1] });
      for (const st of sets) {
        applySet(st.inner);
        out = out.split(st.raw).join("");
      }
    }
    out = applyRemoveLinkMarkers(out);
    out = expandVars(out);
    if (!ctx.skipFx) out = applyFxMarkers(out);
    out = applyGlitchMarkers(out);
    if (!ctx.skipClear) {
      out = out.replace(/\(\s*clear\s*\)/gi, () => {
        pendingChronicleClear = true;
        return "";
      });
    } else {
      out = out.replace(/\(\s*clear\s*\)/gi, "");
    }
    if (ctx.skipSet) {
      const setRe = /\(set:\s*([^)]+)\)/g;
      let m;
      while ((m = setRe.exec(out)) !== null) {
        if (!ctx.deferredSets) ctx.deferredSets = [];
        ctx.deferredSets.push(m[1]);
      }
      out = out.replace(/\(set:\s*[^)]+\)/g, "").trim();
    }
    return out;
  }

  function applyOptionSetsFromAnchor(a) {
    const raw = a.dataset.optionSets;
    if (!raw) return;
    try {
      const inners = JSON.parse(raw);
      if (!Array.isArray(inners)) return;
      for (const inner of inners) applySet(inner);
    } catch {
      /* ignore */
    }
  }

  /** Découpe le corps brut en alternance `md` / `wait` (avant `processMarkers` par segment). */
  function extractRawWaitSegments(bodyMd) {
    const re = /\(\s*wait:\s*(\d+)\s*\)/gi;
    const segments = [];
    let last = 0;
    for (const m of bodyMd.matchAll(re)) {
      segments.push({ kind: "md", raw: bodyMd.slice(last, m.index) });
      const n = parseInt(m[1], 10);
      const waitMs = Number.isFinite(n) ? Math.min(120000, Math.max(0, n)) : 0;
      segments.push({ kind: "wait", ms: waitMs });
      last = m.index + m[0].length;
    }
    segments.push({ kind: "md", raw: bodyMd.slice(last) });
    return segments;
  }

  function flushChronicleClearIfNeeded() {
    if (pendingChronicleClear && chronicle) {
      chronicle.replaceChildren();
      window.scrollTo(0, 0);
      chronicle.scrollTop = 0;
    }
    pendingChronicleClear = false;
  }

  /** Après affichage du passage courant, enchaîne sur `(goto: id)` si demandé. */
  function flushPendingGoto() {
    const id = pendingGoto;
    pendingGoto = null;
    if (!id || !nodes[id] || restorePass) return false;
    goToNode(id);
    return true;
  }

  /** Laisse le temps de lire le texte affiché avant un `(goto:)` (y compris conditionnel). */
  function schedulePendingGotoAfter(contentDoneMs) {
    if (!pendingGoto) return false;
    const run = () => {
      nodeWaitTimerId = 0;
      flushPendingGoto();
    };
    if (restorePass || contentDoneMs <= 0) {
      run();
    } else {
      nodeWaitTimerId = window.setTimeout(run, contentDoneMs);
    }
    return true;
  }

  function appendStoryArticle(nodeId, processedMd, fastReveal = false) {
    const article = document.createElement("article");
    article.className = "story-node";
    article.dataset.node = nodeId;
    article.innerHTML = marked.parse(processedMd, { async: false });
    const contentDoneMs = applyParagraphFades(article, fastReveal);
    chronicle.appendChild(article);
    return contentDoneMs;
  }

  marked.use({
    breaks: true,
    renderer: {
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const isRemoveLink =
          title && /^removelink$/i.test(String(title).trim());
        const titleAttr =
          title && !isRemoveLink ? ` title="${escapeAttr(title)}"` : "";
        const removeAttr = isRemoveLink ? ` data-removelink="1"` : "";
        if (nodes[href] && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
          return `<a href="#" class="story-goto" data-node="${escapeAttr(href)}"${removeAttr}${titleAttr}>${text}</a>`;
        }
        const safeHref = escapeAttr(href);
        return `<a href="${safeHref}" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
      },
    },
  });

  function noteVarFromConditionAtom(atom, names) {
    const e = atom.trim();
    if (!e || /^once$/i.test(e)) return;
    const cmp = /^([\p{L}_][\p{L}\p{N}_]*)\s*(>=|<=|!=|<>|>|<)\s*/u.exec(e);
    if (cmp) {
      names.add(cmp[1]);
      return;
    }
    const eq = /^([\p{L}_][\p{L}\p{N}_]*)\s*=\s*/u.exec(e);
    if (eq) {
      names.add(eq[1]);
      return;
    }
    const shorthand = /^([\p{L}_][\p{L}\p{N}_]*)\s+\S/u.exec(e);
    if (shorthand) {
      names.add(shorthand[1]);
      return;
    }
    const idOnly = /^([\p{L}_][\p{L}\p{N}_]*)$/u.exec(e);
    if (idOnly) names.add(idOnly[1]);
  }

  function noteVarsFromConditionExpr(expr, names) {
    const e = expr.trim();
    if (!e) return;
    const orParts = splitLogical(e, "or");
    if (orParts.length > 1) {
      for (const part of orParts) {
        const andParts = splitLogical(part, "and");
        if (andParts.length > 1) {
          for (const atom of andParts) noteVarFromConditionAtom(atom, names);
        } else {
          noteVarFromConditionAtom(part, names);
        }
      }
      return;
    }
    const andParts = splitLogical(e, "and");
    if (andParts.length > 1) {
      for (const atom of andParts) noteVarFromConditionAtom(atom, names);
    } else {
      noteVarFromConditionAtom(e, names);
    }
  }

  function noteVarsFromIfConditionBody(body, names) {
    const ternary = splitThreeBySemicolons(body);
    if (ternary) noteVarsFromConditionExpr(ternary[0], names);
    else noteVarsFromConditionExpr(body, names);
  }

  function scanTextForVarNames(text, names) {
    for (const m of text.matchAll(/\{\{([\p{L}_][\p{L}\p{N}_]*)\}\}/gu)) {
      names.add(m[1]);
    }
    for (const m of text.matchAll(/\(set:\s*([\p{L}_][\p{L}\p{N}_]*)/giu)) {
      names.add(m[1]);
    }
    let pos = 0;
    let guard = 0;
    while (guard++ < 5000) {
      const iNot = text.indexOf("(ifnot:", pos);
      const iIf = text.indexOf("(if:", pos);
      if (iNot === -1 && iIf === -1) break;
      const useNot = iNot !== -1 && (iIf === -1 || iNot < iIf);
      const openIdx = useNot ? iNot : iIf;
      const blk = consumeParenBlock(text, openIdx);
      if (!blk) {
        pos = openIdx + 1;
        continue;
      }
      const parsed = parseIfInner(blk.inner);
      if (parsed) noteVarsFromIfConditionBody(parsed.body, names);
      pos = blk.end + 1;
    }
  }

  function collectStoryVarNames() {
    const names = new Set();
    for (const node of Object.values(nodes)) {
      const chunks = [node.bodyMd, ...(node.optionLines || [])];
      for (const text of chunks) {
        if (text) scanTextForVarNames(text, names);
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b, "fr"));
  }

  const storyVarNames = collectStoryVarNames();

  function varValueForInput(v) {
    if (typeof v === "string") return JSON.stringify(v);
    return String(v);
  }

  function applyVarFromPanel(name, raw) {
    const t = raw.trim();
    if (t === "") delete vars[name];
    else vars[name] = parseLiteral(t);
  }

  function refreshStoryAfterVarEdit() {
    const curId = nodeHistory[nodeHistory.length - 1];
    const node = curId ? nodes[curId] : null;
    renderVars();
    if (node) renderOptions(node, 0);
    if (!restorePass) persistState();
  }

  function renderVars() {
    if (!varsPanel) return;
    const keys = [
      ...new Set([...storyVarNames, ...Object.keys(vars)]),
    ].sort((a, b) => a.localeCompare(b, "fr"));
    if (keys.length === 0) {
      varsPanel.innerHTML = "<p><em>Aucune variable</em></p>";
      return;
    }
    const rows = keys
      .map((k) => {
        const defined = Object.prototype.hasOwnProperty.call(vars, k);
        const inputVal = defined ? varValueForInput(vars[k]) : "";
        const placeholder = defined ? "" : "non défini";
        return `<tr><td><code>${escapeHtml(k)}</code></td><td><input type="text" class="var-edit" data-var-name="${escapeAttr(k)}" value="${escapeAttr(inputVal)}" placeholder="${escapeAttr(placeholder)}" aria-label="${escapeAttr(k)}"></td></tr>`;
      })
      .join("");
    varsPanel.innerHTML = `<table><thead><tr><th scope="col">Nom</th><th scope="col">Valeur</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function normalizeOptionLines(node) {
    if (node.optionLines && node.optionLines.length) return node.optionLines;
    if (!node.options || !node.options.length) return [];
    return node.options.map((o) => {
      const core = `[${o.label}](${o.target})`;
      return o.once ? `once ${core}` : core;
    });
  }

  /** Retire les `(fx: …)` d’une ligne d’option ; le dernier marqueur de chaque type gagne. */
  function stripOptionLinePageFx(s) {
    let pageFx = null;
    let fxInvert = null;
    const md = s.replace(/\(\s*fx:\s*([^)]+)\)/gi, (_, inner) => {
      const compact = String(inner).trim().toLowerCase().replace(/\s+/g, "");
      if (compact === "glitch" || compact === "glitchon") pageFx = "on";
      else if (compact === "glitch++" || compact === "glitchstrong") pageFx = "strong";
      else if (compact === "glitchoff" || compact === "noglitch") pageFx = "off";
      else if (compact === "inverttrue") fxInvert = true;
      else if (compact === "invertfalse") fxInvert = false;
      return "";
    });
    return { md: md.trim(), pageFx, fxInvert };
  }

  /** Une ligne du bloc options : mêmes marqueurs que le corps (`(if:)`, `(set:)`, etc.). */
  function choiceFromOptionLine(line) {
    let s = line.trim();
    let once = false;
    if (/^once\s+/i.test(s)) {
      once = true;
      s = s.replace(/^once\s+/i, "").trim();
    } else {
      const mwrap = /^\(once\)\s*\(\s*([\s\S]*?)\s*\)\s*$/.exec(s);
      if (mwrap) {
        once = true;
        s = mwrap[1].trim();
      }
    }
    const stripped = stripOptionLinePageFx(s);
    s = stripped.md;
    const pageFx =
      stripped.pageFx === "on" || stripped.pageFx === "strong"
        ? stripped.pageFx
        : null;
    const fxInvert = stripped.fxInvert;
    const optCtx = {
      skipClear: true,
      skipFx: true,
      skipGoto: true,
      skipSet: true,
      deferredSets: [],
    };
    const processed = processMarkers(s, 0, optCtx);
    if (/\(if(?:not)?:/i.test(processed)) return null;
    const lm = /\[([^\]]*)\]\(([^)]+)\)/.exec(processed.trim());
    if (!lm) return null;
    const sets = optCtx.deferredSets?.length ? optCtx.deferredSets : null;
    return {
      label: lm[1].trim(),
      target: lm[2].trim(),
      once,
      pageFx,
      fxInvert,
      sets,
    };
  }

  /** Durée du fondu d’un bloc (paragraphe / titre / liste, etc.). */
  const PARA_FADE_MS = 2200;
  /** Délai entre le début du fondu de chaque bloc enfant du nœud. */
  const PARA_STAGGER_MS = 750;
  /** Relecture d’un nœud déjà visité (boucle game over, etc.). */
  const PARA_FADE_MS_FAST = 500;
  const PARA_STAGGER_MS_FAST = 120;
  /** Délai entre chaque option après la fin du contenu (ms). */
  const OPTION_STAGGER_MS = 100;

  /**
   * Fondu bloc par bloc sur les enfants directs de l’article (sortie Markdown).
   * @returns {number} ms jusqu’à la fin du fondu du dernier bloc (0 si aucun bloc).
   */
  function applyParagraphFades(articleEl, fastReveal = false) {
    const fadeMs = fastReveal ? PARA_FADE_MS_FAST : PARA_FADE_MS;
    const staggerMs = fastReveal ? PARA_STAGGER_MS_FAST : PARA_STAGGER_MS;
    const blocks = Array.from(articleEl.children);
    let i = 0;
    for (const el of blocks) {
      el.classList.add("para-fade");
      el.style.setProperty("--para-fade", `${fadeMs}ms`);
      el.style.setProperty("--para-d", `${i * staggerMs}ms`);
      i += 1;
    }
    if (blocks.length === 0) return 0;
    return (blocks.length - 1) * staggerMs + fadeMs;
  }

  /**
   * @param {object} node
   * @param {number} baseDelayMs délai avant la 1re option (après le dernier paragraphe).
   */
  function renderOptions(node, baseDelayMs = 0) {
    const lines = normalizeOptionLines(node);
    optionsNav.innerHTML = "";
    if (lines.length === 0) return;
    const ul = document.createElement("ul");
    let optionIndex = 0;
    for (const line of lines) {
      const opt = choiceFromOptionLine(line);
      if (!opt) continue;
      if (opt.once && visited.has(opt.target)) continue;
      const li = document.createElement("li");
      li.className = "option-fade";
      li.style.setProperty(
        "--opt-d",
        `${baseDelayMs + optionIndex * OPTION_STAGGER_MS}ms`,
      );
      optionIndex += 1;
      const a = document.createElement("a");
      a.href = "#";
      a.className = "story-goto";
      a.dataset.node = opt.target;
      if (opt.pageFx) a.dataset.pageFx = opt.pageFx;
      if (opt.fxInvert === true) a.dataset.fxInvert = "1";
      else if (opt.fxInvert === false) a.dataset.fxInvert = "0";
      if (opt.sets) a.dataset.optionSets = JSON.stringify(opt.sets);
      if (opt.label.includes("<")) a.innerHTML = opt.label;
      else a.textContent = opt.label;
      li.appendChild(a);
      ul.appendChild(li);
    }
    if (ul.childElementCount === 0) return;
    optionsNav.appendChild(ul);
  }

  function appendNodeBlock(nodeId) {
    const node = nodes[nodeId];
    if (!node) return;
    if (nodeWaitTimerId) {
      clearTimeout(nodeWaitTimerId);
      nodeWaitTimerId = 0;
    }
    const alreadyVisited = visited.has(nodeId);
    nodeHistory.push(nodeId);
    visited.add(nodeId);
    stripChronicleRemoveLinksTo(nodeId);
    pendingChronicleClear = false;
    pendingGoto = null;

    const rawSegments = extractRawWaitSegments(node.bodyMd);
    const useWaitDelays =
      !restorePass &&
      !alreadyVisited &&
      rawSegments.some((s) => s.kind === "wait" && s.ms > 0) &&
      rawSegments.some((s) => s.kind === "md" && s.raw.trim() !== "");
    const fastReveal = alreadyVisited || restorePass;

    const finishNodeUi = (contentDoneMs, doPersist) => {
      if (!pendingGoto) renderOptions(node, contentDoneMs);
      renderVars();
      if (doPersist && !restorePass) persistState();
      if (chronicle) chronicle.scrollTop = chronicle.scrollHeight;
    };

    if (optionsNav && useWaitDelays) optionsNav.innerHTML = "";

    let lastContentDoneMs = 0;

    function playMdSegment(rawMd) {
      const processed = processMarkers(rawMd);
      syncPendingPageFxInvert();
      syncPendingPageGlitch();
      flushChronicleClearIfNeeded();
      if (!processed.trim()) return 0;
      return appendStoryArticle(nodeId, processed, fastReveal);
    }

    function finishTimeline() {
      nodeWaitTimerId = 0;
      pendingChronicleClear = false;
      finishNodeUi(lastContentDoneMs, true);
    }

    function runFrom(segIdx) {
      nodeWaitTimerId = 0;
      let i = segIdx;
      while (i < rawSegments.length) {
        const seg = rawSegments[i];
        i += 1;
        if (seg.kind === "md") {
          lastContentDoneMs = playMdSegment(seg.raw);
          renderVars();
          if (pendingGoto) {
            if (!restorePass) persistState();
            schedulePendingGotoAfter(lastContentDoneMs);
            return;
          }
          continue;
        }
        if (seg.kind === "wait" && seg.ms > 0) {
          if (useWaitDelays) {
            nodeWaitTimerId = window.setTimeout(() => runFrom(i), seg.ms);
            return;
          }
          continue;
        }
      }
      finishTimeline();
      schedulePendingGotoAfter(lastContentDoneMs);
    }

    runFrom(0);
  }

  function goToNode(nodeId, opts = {}) {
    if (!nodes[nodeId]) return;
    if (opts.clear) {
      if (nodeWaitTimerId) {
        clearTimeout(nodeWaitTimerId);
        nodeWaitTimerId = 0;
      }
      teardownPageGlitchBurst();
      if (chronicle) chronicle.replaceChildren();
      if (optionsNav) optionsNav.innerHTML = "";
      nodeHistory.length = 0;
      window.scrollTo(0, 0);
    }
    appendNodeBlock(nodeId);
    if (chronicle) chronicle.scrollTop = chronicle.scrollHeight;
    if (opts.clear && !restorePass) persistState();
  }

  let optionPageGlitchBusy = false;

  document.addEventListener("click", (ev) => {
    const a = ev.target.closest("a.story-goto");
    if (!a) return;
    if (!chronicle.contains(a) && !(optionsNav && optionsNav.contains(a))) return;
    ev.preventDefault();
    const id = a.dataset.node;
    if (!id) return;
    if (a.dataset.removelink === "1") unwrapStoryGotoLink(a);
    const isOption = optionsNav && optionsNav.contains(a);
    if (isOption) applyOptionSetsFromAnchor(a);
    if (isOption) {
      const inv = a.dataset.fxInvert;
      if (inv === "1") applyStoryRootFxInvertFlag(true);
      else if (inv === "0") applyStoryRootFxInvertFlag(false);
    }
    const fx = a.dataset.pageFx;
    if (isOption && (fx === "on" || fx === "strong")) {
      if (optionPageGlitchBusy) return;
      optionPageGlitchBusy = true;
      a.setAttribute("aria-busy", "true");
      runPageGlitchBurst(fx)
        .then(() => {
          goToNode(id);
        })
        .finally(() => {
          optionPageGlitchBusy = false;
          a.removeAttribute("aria-busy");
        });
      return;
    }
    goToNode(id);
  });

  function formatAboutValue(v) {
    if (v === undefined) return "";
    if (v === null) return "null";
    if (typeof v === "boolean") return String(v);
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    if (typeof v === "string") return v;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }

  if (aboutPanel) {
    const keys = Object.keys(meta).sort((a, b) => a.localeCompare(b, "fr"));
    if (keys.length === 0) {
      aboutPanel.innerHTML = "<p>(aucune métadonnée)</p>";
    } else {
      const rows = keys
        .map((k) => {
          const raw = formatAboutValue(meta[k]);
          const display = escapeHtml(raw).replace(/\n/g, "<br />");
          return `<tr><th scope="row"><code>${escapeHtml(k)}</code></th><td>${display}</td></tr>`;
        })
        .join("");
      aboutPanel.innerHTML = `<table class="about-meta"><tbody>${rows}</tbody></table>`;
    }
  }

  document.title = meta.title || document.title;

  const resetLink = document.getElementById("story-reset");
  if (resetLink) {
    resetLink.addEventListener("click", (ev) => {
      ev.preventDefault();
      try {
        localStorage.removeItem(getStorageKey());
      } catch {
        /* ignore */
      }
      location.reload();
    });
  }

  if (varsPanel) {
    varsPanel.addEventListener("change", (ev) => {
      const input = ev.target.closest("input.var-edit[data-var-name]");
      if (!input) return;
      applyVarFromPanel(input.dataset.varName, input.value);
      refreshStoryAfterVarEdit();
    });
  }

  const jumpSelect = document.getElementById("story-jump");
  if (jumpSelect) {
    const jumpIds =
      Array.isArray(storyOrder) && storyOrder.length
        ? [
            ...storyOrder.filter((id) => Object.prototype.hasOwnProperty.call(nodes, id)),
            ...Object.keys(nodes).filter((id) => !storyOrder.includes(id)),
          ]
        : Object.keys(nodes);
    for (const id of jumpIds) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      jumpSelect.appendChild(opt);
    }
    jumpSelect.addEventListener("change", () => {
      const id = jumpSelect.value;
      if (!id) return;
      goToNode(id, { clear: true });
      jumpSelect.selectedIndex = 0;
    });
  }

  const saved = readSave();
  if (saved && tryRestoreFromSave(saved)) {
    persistState();
    if (chronicle) chronicle.scrollTop = chronicle.scrollHeight;
  } else {
    appendNodeBlock(meta.start);
  }
})();
