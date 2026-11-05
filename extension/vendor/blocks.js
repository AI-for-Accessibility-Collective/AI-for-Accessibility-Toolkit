// Generated from toolkit/blocks/runtime.js by scripts/build-extension.mjs: do not edit.
"use strict";
(() => {
  // toolkit/blocks/shared.js
  var KEY = "__ai4a11yBlocksShared";
  var UI_ATTR = "data-ai4a11y-ui";
  function sharedState(win) {
    if (!win[KEY]) {
      Object.defineProperty(win, KEY, {
        configurable: true,
        value: {
          nextId: 1,
          // Nodes and values the blocks wrote, so watchers never react to them.
          ourNodes: /* @__PURE__ */ new WeakSet(),
          ourAttrs: /* @__PURE__ */ new WeakMap(),
          // element -> Map(attribute -> value written)
          ourText: /* @__PURE__ */ new WeakMap(),
          // text node -> value written
          liveRegions: {},
          // politeness -> element
          liveUsers: /* @__PURE__ */ new Set(),
          // sessions that announced and are still open
          voice: null,
          // the utterance speaking now, page-wide
          filters: /* @__PURE__ */ new Map(),
          // `${session}:${name}` -> CSS filter value
          cache: /* @__PURE__ */ new Map(),
          // AI answers for this page
          lastInput: null,
          // {target, at}: the person's last click or key
          inputWatch: false,
          route: null,
          // {listeners, stop}
          adjusters: /* @__PURE__ */ new Map(),
          // adapter key -> what the toolkit's shortcut adjusts (keys.adjust)
          shortcut: null,
          // the person's shortcut here, when they gave it to an adapter
          entries: null
          // the box of the toolkit's entries at the start of the tab order (focus.entry)
        }
      });
    }
    return win[KEY];
  }
  function isOurs(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return !!(el && el.closest && el.closest(`[${UI_ATTR}]`));
  }
  function resolveConfig(defaults, builder, personal, personalKeys = {}) {
    const out = { ...defaults };
    for (const [k, v] of Object.entries(builder || {})) if (v !== void 0) out[k] = v;
    for (const [k, p] of Object.entries(personalKeys)) {
      const v = personal && personal[p];
      if (v !== void 0 && v !== null) out[k] = v;
    }
    return out;
  }
  function reducedMotion(env) {
    if (env.personal && env.personal.motionReducer) return true;
    try {
      return !!env.win.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  }
  var hasLayout = (doc) => !!(doc.documentElement && doc.documentElement.clientWidth > 0);
  var cssName = (prop) => prop.startsWith("--") ? prop : prop.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
  var slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "adapter";

  // toolkit/blocks/styles.js
  var FILTER_STYLE_ID = "ai4a11y-filters";
  function stylesBlock(s, env) {
    const sheets = /* @__PURE__ */ new Map();
    function css(name, text, { scope } = {}) {
      if (!s.alive()) return null;
      let el = sheets.get(name);
      if (text == null) {
        if (el) {
          el.remove();
          sheets.delete(name);
        }
        return null;
      }
      if (el && !el.isConnected) {
        sheets.delete(name);
        el = null;
      }
      if (!el) {
        el = env.doc.createElement("style");
        el.id = `ai4a11y-${s.id}-${String(name).replace(/[^\w-]/g, "-")}`;
        el.setAttribute(UI_ATTR, "ui");
        sheets.set(name, el);
        s.append(env.doc.head || env.doc.documentElement, el);
        s.onEnd(() => sheets.delete(name));
      }
      el.textContent = String(text);
      if (scope) s.addClass(env.doc.documentElement, scope);
      return {
        el,
        update: (next) => {
          if (s.alive()) el.textContent = String(next);
        }
      };
    }
    function writeFilters() {
      const { filters } = env.shared;
      let el = env.doc.getElementById(FILTER_STYLE_ID);
      if (!filters.size) {
        if (el) el.remove();
        return;
      }
      if (!el) {
        el = env.doc.createElement("style");
        el.id = FILTER_STYLE_ID;
        el.setAttribute(UI_ATTR, "ui");
        env.shared.ourNodes.add(el);
        (env.doc.head || env.doc.documentElement).appendChild(el);
      }
      el.textContent = `html { filter: ${[...filters.values()].join(" ")} !important; }`;
    }
    function filter(name, value) {
      if (!s.alive()) return;
      const key = `${s.id}:${name}`;
      const had = env.shared.filters.has(key);
      if (value) env.shared.filters.set(key, String(value));
      else env.shared.filters.delete(key);
      writeFilters();
      if (!had) s.onEnd(() => {
        env.shared.filters.delete(key);
        writeFilters();
      });
    }
    return { css, filter };
  }

  // toolkit/blocks/watch.js
  var ROUTE_POLL_MS = 1e3;
  var QUERIES = {
    motionReducer: "(prefers-reduced-motion: reduce)",
    moreContrast: "(prefers-contrast: more)",
    darkMode: "(prefers-color-scheme: dark)",
    forcedColors: "(forced-colors: active)"
  };
  function watchInput(env) {
    const { shared, doc } = env;
    if (shared.inputWatch) return;
    shared.inputWatch = true;
    const note = (e) => {
      if (e.isTrusted) shared.lastInput = { target: e.target, at: Date.now() };
    };
    for (const type of ["pointerdown", "keydown", "input"]) doc.addEventListener(type, note, true);
  }
  function watchBlock(s, env) {
    const { shared, win, doc } = env;
    const ourRecord = (r) => {
      if (r.type === "attributes") {
        const m = shared.ourAttrs.get(r.target);
        return !!m && m.has(r.attributeName) && m.get(r.attributeName) === r.target.getAttribute(r.attributeName);
      }
      if (r.type === "characterData") return shared.ourText.get(r.target) === r.target.nodeValue;
      return false;
    };
    function added(root, fn, opts = {}) {
      if (!s.alive() || typeof win.MutationObserver !== "function") return () => {
      };
      const { debounceMs = 0, cap = 500, types = ["childList"], selector = null, batch = false } = opts;
      const target = root || doc.body || doc.documentElement;
      const watchAdded = types.includes("childList");
      const watchText = types.includes("characterData");
      let pending = /* @__PURE__ */ new Set();
      let timer = null;
      const limit = cap * 50;
      const flush = () => {
        timer = null;
        const all = [...pending];
        const list = all.slice(0, cap);
        pending = new Set(all.slice(cap));
        if (pending.size) timer = win.setTimeout(flush, 0);
        const live = list.filter((el) => el.isConnected && !isOurs(el));
        if (!s.alive() || !live.length) return;
        if (batch) fn(live);
        else for (const el of live) if (s.alive()) fn(el);
      };
      const take = (el) => {
        if (!el || el.nodeType !== 1 || isOurs(el) || pending.size >= limit) return;
        if (!selector) {
          pending.add(el);
          return;
        }
        if (el.matches(selector)) pending.add(el);
        for (const m of el.querySelectorAll(selector)) {
          if (pending.size >= limit) break;
          pending.add(m);
        }
      };
      const mo = new win.MutationObserver((records) => {
        if (!s.alive()) return;
        for (const r of records) {
          if (ourRecord(r)) continue;
          if (r.type === "childList") {
            let text = false;
            for (const n of r.addedNodes) {
              if (shared.ourNodes.has(n)) continue;
              if (n.nodeType === 3) text = true;
              else if (watchAdded) take(n);
            }
            if (text && watchText) take(r.target);
          } else {
            take(r.target.nodeType === 1 ? r.target : r.target.parentElement);
          }
        }
        if (!pending.size) return;
        if (debounceMs > 0) {
          win.clearTimeout(timer);
          timer = win.setTimeout(flush, debounceMs);
        } else {
          win.clearTimeout(timer);
          flush();
        }
      });
      mo.observe(target, {
        subtree: true,
        childList: watchAdded || watchText,
        attributes: types.includes("attributes"),
        characterData: types.includes("characterData")
      });
      const stop = () => {
        mo.disconnect();
        win.clearTimeout(timer);
      };
      s.onEnd(stop);
      return stop;
    }
    function route(fn) {
      if (!s.alive()) return () => {
      };
      if (!shared.route) {
        const listeners = /* @__PURE__ */ new Set();
        let last = win.location.href;
        const check = () => {
          const now = win.location.href;
          if (now === last) return;
          last = now;
          for (const l of [...listeners]) {
            try {
              l(now);
            } catch {
            }
          }
        };
        const nav = win.navigation;
        nav?.addEventListener?.("currententrychange", check);
        win.addEventListener("popstate", check);
        win.addEventListener("hashchange", check);
        const poll = win.setInterval(check, ROUTE_POLL_MS);
        shared.route = {
          listeners,
          stop: () => {
            nav?.removeEventListener?.("currententrychange", check);
            win.removeEventListener("popstate", check);
            win.removeEventListener("hashchange", check);
            win.clearInterval(poll);
            shared.route = null;
          }
        };
      }
      const handler = (url) => {
        if (s.alive()) fn(url);
      };
      const r = shared.route;
      r.listeners.add(handler);
      const stop = () => {
        r.listeners.delete(handler);
        if (!r.listeners.size && shared.route === r) r.stop();
      };
      s.onEnd(stop);
      return stop;
    }
    function prefs(fn) {
      const lists = {};
      const read = () => {
        const out = {};
        for (const [k, q] of Object.entries(QUERIES)) {
          try {
            out[k] = !!(lists[k] || (lists[k] = win.matchMedia?.(q)))?.matches;
          } catch {
            out[k] = false;
          }
        }
        if (env.personal.motionReducer) out.motionReducer = true;
        if (env.personal.darkMode) out.darkMode = true;
        if (env.personal.contrastMode && env.personal.contrastMode !== "none") out.moreContrast = true;
        return out;
      };
      const now = read();
      if (typeof fn === "function" && s.alive()) {
        fn(now);
        for (const list of Object.values(lists)) if (list?.addEventListener) s.listen(list, "change", () => fn(read()));
        if (!shared.personalListeners) shared.personalListeners = /* @__PURE__ */ new Set();
        const h = () => {
          if (s.alive()) fn(read());
        };
        shared.personalListeners.add(h);
        s.onEnd(() => shared.personalListeners.delete(h));
      }
      return now;
    }
    function byPerson(el, { withinMs = 1e3 } = {}) {
      const last = shared.lastInput;
      if (!last || !el || Date.now() - last.at > withinMs) return false;
      return el === last.target || typeof el.contains === "function" && last.target && el.contains(last.target);
    }
    return { added, route, prefs, byPerson };
  }

  // toolkit/blocks/color.js
  function parseColor(value) {
    const v = String(value || "").trim().toLowerCase();
    let m = /^#([0-9a-f]{3,8})$/.exec(v);
    if (m) {
      let h = m[1];
      if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
      if (h.length !== 6 && h.length !== 8) return null;
      const n = (i) => parseInt(h.slice(i, i + 2), 16);
      return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
    }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v);
    if (m) {
      const a = m[4] === void 0 ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      return [+m[1], +m[2], +m[3], a];
    }
    if (v === "white") return [255, 255, 255, 1];
    if (v === "black") return [0, 0, 0, 1];
    if (v === "transparent") return [0, 0, 0, 0];
    return null;
  }
  var channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  var luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  function contrast(a, b) {
    const ca = Array.isArray(a) ? a : parseColor(a);
    const cb = Array.isArray(b) ? b : parseColor(b);
    if (!ca || !cb) return 1;
    const [hi, lo] = [luminance(ca), luminance(cb)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }
  function backgroundOf(el, win) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = parseColor(win.getComputedStyle(n).backgroundColor);
      if (c && c[3] >= 0.5) return c;
    }
    return [255, 255, 255, 1];
  }
  function textColorOf(el, win) {
    return parseColor(win.getComputedStyle(el).color) || [0, 0, 0, 1];
  }
  function pick(candidates, against, min) {
    return candidates.find((c) => contrast(c, against) >= min) || null;
  }
  var hex = ([r, g, b]) => "#" + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");
  var toHsl = ([r, g, b]) => {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, sat, l];
  };
  var fromHsl = ([h, sat, l]) => {
    if (!sat) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q;
    const f = (t) => {
      t = (t + 1) % 1;
      return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255].map(Math.round);
  };
  function nearestWithContrast(fg, bg, min) {
    const f = Array.isArray(fg) ? fg : parseColor(fg);
    const b = Array.isArray(bg) ? bg : parseColor(bg);
    if (!f || !b) return null;
    if (contrast(f, b) >= min) return f.slice(0, 3);
    const [h, sat, l] = toHsl(f);
    const dark = luminance(b) > 0.18;
    for (const toward of dark ? [0, 1] : [1, 0]) {
      if (contrast(fromHsl([h, sat, toward]), b) < min) continue;
      let lo = l, hi = toward;
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        if (contrast(fromHsl([h, sat, mid]), b) >= min) hi = mid;
        else lo = mid;
      }
      return fromHsl([h, sat, hi]);
    }
    return contrast([0, 0, 0], b) >= contrast([255, 255, 255], b) ? [0, 0, 0] : [255, 255, 255];
  }

  // toolkit/blocks/highlight.js
  var BACKGROUNDS = ["#fff3a0", "#ffe066", "#cfe8ff", "#d4f5d4", "#1a1a1a"];
  var LINES = ["#1a5fb4", "#c01c28", "#9a5b00", "#000000", "#ffbf00", "#ffffff"];
  var HIGHLIGHT_DEFAULTS = { style: "background", color: "auto", width: 3 };
  var FOLLOW_DEFAULTS = { source: ["pointer", "focus"], height: 40, dimOutside: 0.4, color: "#ffe066" };
  var RING_DEFAULTS = { color: "auto", width: 3 };
  function highlightBlock(s, env) {
    const { doc, win } = env;
    let n = 0;
    function paint(el, c) {
      const text = textColorOf(el, win);
      const bg = backgroundOf(el, win);
      if (c.style === "background") {
        const wanted2 = c.color === "auto" ? null : parseColor(c.color);
        const color = wanted2 && contrast(wanted2, text) >= 4.5 ? c.color : pick(BACKGROUNDS, text, 4.5);
        if (color) return `background-color: ${color} !important; box-shadow: 0 0 0 2px ${color} !important;`;
      }
      const wanted = c.color === "auto" || c.style === "background" ? null : parseColor(c.color);
      const line = wanted && contrast(wanted, bg) >= 3 ? c.color : pick(LINES, bg, 3) || "#000000";
      if (c.style === "underline") return `text-decoration: underline ${c.width}px ${line} !important; text-underline-offset: 3px !important;`;
      return `outline: ${c.width}px solid ${line} !important; outline-offset: 2px !important;`;
    }
    function element(target, opts = {}) {
      const c = resolveConfig(HIGHLIGHT_DEFAULTS, opts, env.personal, {});
      const cls = `ai4a11y-hl-${s.id}-${++n}`;
      const sheet = s.css(`hl-${n}`, "");
      let current = null;
      const move = (el) => {
        if (!s.alive()) return;
        if (current && current !== el) current.classList.remove(cls);
        current = el || null;
        if (!current) return;
        sheet?.update(`.${cls} { ${paint(current, c)} }`);
        if (!current.classList.contains(cls)) current.classList.add(cls);
      };
      s.onEnd(() => {
        if (current) {
          current.classList.remove(cls);
          if (!current.getAttribute("class")) current.removeAttribute("class");
        }
        current = null;
      });
      move(target);
      return { move, clear: () => move(null), get element() {
        return current;
      } };
    }
    function range(initial, opts = {}) {
      const c = resolveConfig({ color: "auto" }, opts, env.personal, {});
      const name = `ai4a11y-${s.id}-r${++n}`.replace(/[^\w-]/g, "-");
      const registry = win.CSS && win.CSS.highlights;
      const supported = !!(registry && typeof win.Highlight === "function");
      const bg = c.color === "auto" ? "#ffe066" : c.color;
      const fg = contrast(bg, "#000000") >= contrast(bg, "#ffffff") ? "#000000" : "#ffffff";
      s.css(`range-${n}`, `::highlight(${name}) { background-color: ${bg}; color: ${fg}; }`);
      const hl = supported ? new win.Highlight() : null;
      if (hl) {
        registry.set(name, hl);
        s.onEnd(() => registry.delete(name));
      }
      const move = (r) => {
        if (!hl || !s.alive()) return;
        hl.clear();
        if (r) hl.add(r);
      };
      move(initial);
      return { move, clear: () => move(null), supported };
    }
    function follow(opts = {}) {
      const c = resolveConfig(FOLLOW_DEFAULTS, opts, env.personal, {});
      const sources = Array.isArray(c.source) ? c.source : [c.source];
      const still = reducedMotion(env);
      const pane = (name) => {
        const el = s.el("div", { attrs: { "aria-hidden": "true", "data-ai4a11y-band": name } });
        el.setAttribute("style", `position:fixed;left:0;right:0;pointer-events:none;z-index:2147483645;${still ? "" : "transition:top .08s linear,height .08s linear;"}`);
        return s.append(doc.body, el);
      };
      const dim = Math.max(0, Math.min(0.9, Number(c.dimOutside) || 0));
      const above = dim ? pane("above") : null;
      const band = pane("band");
      const below = dim ? pane("below") : null;
      const h = Math.max(8, Number(c.height) || 40);
      if (dim) {
        above.style.background = below.style.background = `rgba(0,0,0,${dim})`;
        above.style.top = "0px";
        band.style.background = "transparent";
      } else {
        band.style.background = c.color;
        band.style.opacity = "0.3";
        band.style.mixBlendMode = "multiply";
      }
      let y = (win.innerHeight || 600) / 2;
      const draw = () => {
        const top = Math.round(y - h / 2);
        band.style.top = `${top}px`;
        band.style.height = `${h}px`;
        if (dim) {
          above.style.height = `${Math.max(0, top)}px`;
          below.style.top = `${top + h}px`;
          below.style.bottom = "0px";
        }
      };
      let queued = false;
      const moveTo = (nextY) => {
        y = nextY;
        if (queued) return;
        queued = true;
        s.frame(() => {
          queued = false;
          draw();
        });
      };
      if (sources.includes("pointer")) s.listen(doc, "pointermove", (e) => moveTo(e.clientY), { passive: true, capture: true });
      if (sources.includes("focus")) {
        s.listen(doc, "focusin", (e) => {
          const r = e.target?.getBoundingClientRect?.();
          if (r && r.height) moveTo(r.top + r.height / 2);
        }, true);
      }
      draw();
      const panes = [above, band, below].filter(Boolean);
      return {
        moveTo,
        hide: () => panes.forEach((p) => {
          p.hidden = true;
        }),
        show: () => panes.forEach((p) => {
          p.hidden = false;
        })
      };
    }
    function focusRing(opts = {}) {
      const c = resolveConfig(RING_DEFAULTS, opts, env.personal, {});
      const width = Math.max(2, Math.min(8, Number(c.width) || 3));
      const color = c.color === "auto" ? "#1a5fb4" : c.color;
      const scope = `ai4a11y-ring-${s.id}`.replace(/[^\w-]/g, "-");
      s.css("ring", `html.${scope} :focus-visible {
  outline: ${width}px solid ${color} !important;
  outline-offset: 2px !important;
  box-shadow: 0 0 0 2px #ffffff, 0 0 0 ${width + 2}px ${color} !important;
}`, { scope });
      return { scope };
    }
    return { element, range, follow, focusRing };
  }

  // toolkit/blocks/targets.js
  var REPLACED = /^(input|select|textarea|img|video|audio|iframe|canvas|object|embed|svg)$/i;
  var FORWARD = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
  var PSEUDO_CSS = `[data-ai4a11y-hit~="rel"] { position: relative !important; }
[data-ai4a11y-hit~="after"]::after, [data-ai4a11y-hit~="before"]::before { all: unset !important; content: "" !important; position: absolute !important; inset: var(--ai4a11y-hit) !important; }`;
  var quarter = (v) => Math.max(0, Math.floor(v * 4) / 4);
  var plain = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
  function split(want, a, b) {
    let x = Math.min(want / 2, a);
    const y = Math.min(want - x, b);
    x = Math.min(want - y, a);
    return [quarter(x), quarter(y)];
  }
  function targetsBlock(s, env) {
    const { doc, win } = env;
    const made = /* @__PURE__ */ new WeakMap();
    let styled = false;
    function pageBox() {
      const de = doc.documentElement;
      const sx = win.scrollX || 0, sy = win.scrollY || 0;
      return { left: -sx, top: -sy, right: Math.max(de.scrollWidth, de.clientWidth) - sx, bottom: Math.max(de.scrollHeight, de.clientHeight) - sy };
    }
    function clipOf(start, page, memo) {
      if (!start || start === doc.body || start === doc.documentElement || start.nodeType !== 1) return { x: page, y: page, vx: page, vy: page, nx: null, ny: null };
      if (memo.has(start)) return memo.get(start);
      const up = clipOf(start.parentElement, page, memo);
      let out = up;
      let cs = null;
      try {
        cs = win.getComputedStyle(start);
      } catch {
      }
      const cx = cs && cs.overflowX !== "visible", cy = cs && cs.overflowY !== "visible";
      if (cx || cy) {
        const r = start.getBoundingClientRect();
        const vl = r.left + start.clientLeft, vt = r.top + start.clientTop;
        const shown = { left: vl, top: vt, right: vl + start.clientWidth, bottom: vt + start.clientHeight };
        const scrolls = (o) => o === "auto" || o === "scroll";
        const area = { left: scrolls(cs.overflowX) ? vl - start.scrollLeft : vl, top: scrolls(cs.overflowY) ? vt - start.scrollTop : vt };
        area.right = scrolls(cs.overflowX) ? area.left + Math.max(start.scrollWidth, start.clientWidth) : shown.right;
        area.bottom = scrolls(cs.overflowY) ? area.top + Math.max(start.scrollHeight, start.clientHeight) : shown.bottom;
        if (cx) out = { ...out, x: area, vx: shown, nx: start };
        if (cy) out = { ...out, y: area, vy: shown, ny: start };
      }
      memo.set(start, out);
      return out;
    }
    const labelled = (el) => el.tagName === "LABEL" && el.control || null;
    function room(els, { size = 24, others = [], rects = null, within = null, still = null } = {}) {
      const S = Number(size) > 0 ? Number(size) : 24;
      const keeps = still ? new Set(still) : null;
      const out = /* @__PURE__ */ new Map();
      const R = /* @__PURE__ */ new Map();
      for (const el of [...els, ...others]) {
        if (!el || R.has(el) || !el.isConnected) continue;
        R.set(el, rects && rects.get(el) || plain(el.getBoundingClientRect()));
      }
      const page = within || pageBox();
      const de = doc.documentElement;
      const view = within || { left: 0, top: 0, right: de.clientWidth, bottom: de.clientHeight };
      const memo = /* @__PURE__ */ new Map();
      const clipFor = (el) => {
        let fixed = false;
        try {
          fixed = win.getComputedStyle(el).position === "fixed";
        } catch {
        }
        return fixed ? { x: view, y: view, vx: view, vy: view, nx: null, ny: null, fixed } : { ...clipOf(el.parentElement, page, memo), fixed };
      };
      const all = [...R].map(([o, q]) => [o, q, clipFor(o)]);
      const edge = (r, b, wx, wy) => ({
        left: Math.min(wx, Math.max(0, r.left - b.x.left)),
        right: Math.min(wx, Math.max(0, b.x.right - r.right)),
        top: Math.min(wy, Math.max(0, r.top - b.y.top)),
        bottom: Math.min(wy, Math.max(0, b.y.bottom - r.bottom))
      });
      for (const el of els) {
        const r = R.get(el);
        if (!r) continue;
        const c = clipFor(el);
        const bound = c.fixed ? view : page;
        const wx = Math.max(0, S - r.width), wy = Math.max(0, S - r.height);
        const cap = edge(r, { x: bound, y: bound }, wx, wy);
        if (wx || wy) {
          for (const [o, full, oc] of all) {
            if (o === el || o.contains(el) || el.contains(o) || labelled(o) === el || labelled(el) === o) continue;
            const sx = oc.nx && !oc.nx.contains(el), sy = oc.ny && !oc.ny.contains(el);
            const q = {
              left: sx ? Math.max(full.left, oc.vx.left) : full.left,
              right: sx ? Math.min(full.right, oc.vx.right) : full.right,
              top: sy ? Math.max(full.top, oc.vy.top) : full.top,
              bottom: sy ? Math.min(full.bottom, oc.vy.bottom) : full.bottom,
              width: full.width,
              height: full.height
            };
            if (q.right <= q.left || q.bottom <= q.top) continue;
            const gx = Math.max(q.left - r.right, r.left - q.right);
            const gy = Math.max(q.top - r.bottom, r.top - q.bottom);
            if (gx >= 2 * S || gy >= 2 * S) continue;
            if (gx >= gy) {
              const g = quarter(Math.max(0, gx) * (q.width < S && !keeps?.has(o) ? 0.5 : 1));
              if (q.left + q.right > r.left + r.right) cap.right = Math.min(cap.right, g);
              else cap.left = Math.min(cap.left, g);
            } else {
              const g = quarter(Math.max(0, gy) * (q.height < S && !keeps?.has(o) ? 0.5 : 1));
              if (q.top + q.bottom > r.top + r.bottom) cap.bottom = Math.min(cap.bottom, g);
              else cap.top = Math.min(cap.top, g);
            }
          }
        }
        const inner = edge(r, c, wx, wy);
        const fit = (k) => Math.min(cap[k], inner[k]);
        let [left, right] = split(wx, fit("left"), fit("right"));
        let [top, bottom] = split(wy, fit("top"), fit("bottom"));
        let clipped = false;
        const [l2, r2] = split(wx, cap.left, cap.right);
        const [t2, b2] = split(wy, cap.top, cap.bottom);
        if (l2 + r2 > left + right || t2 + b2 > top + bottom) {
          [left, right, top, bottom] = [l2, r2, t2, b2];
          clipped = r.left - left < c.x.left - 0.5 || r.right + right > c.x.right + 0.5 || r.top - top < c.y.top - 0.5 || r.bottom + bottom > c.y.bottom + 0.5;
        }
        out.set(el, { rect: r, top, right, bottom, left, clipped, lines: el.getClientRects().length });
      }
      return out;
    }
    const used = (el, which) => {
      try {
        const c = win.getComputedStyle(el, which).content;
        return !!c && c !== "none" && c !== "normal";
      } catch {
        return true;
      }
    };
    function pseudoFor(el, cs) {
      if (REPLACED.test(el.tagName) || win.SVGElement && el instanceof win.SVGElement) return null;
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") return null;
      const which = !used(el, "::after") ? "after" : !used(el, "::before") ? "before" : null;
      if (!which) return null;
      if (cs.position !== "static") return { which, rel: false };
      if (["top", "right", "bottom", "left"].some((p) => cs[p] !== "auto")) return null;
      const other = which === "after" ? "::before" : "::after";
      try {
        if (used(el, other) && win.getComputedStyle(el, other).position === "absolute") return null;
      } catch {
        return null;
      }
      for (const d of el.querySelectorAll("*")) {
        try {
          if (win.getComputedStyle(d).position === "absolute") return null;
        } catch {
          return null;
        }
      }
      return { which, rel: true };
    }
    const ringStyle = (name, e, cursor) => [
      "all: unset",
      "position: absolute",
      `position-anchor: ${name}`,
      `top: calc(anchor(top) - ${e.top}px)`,
      `left: calc(anchor(left) - ${e.left}px)`,
      `bottom: calc(anchor(bottom) - ${e.bottom}px)`,
      `right: calc(anchor(right) - ${e.right}px)`,
      "position-visibility: anchors-visible",
      `cursor: ${cursor || "pointer"}`,
      // A hole where the element is: the ring never covers it.
      `clip-path: polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${e.left}px ${e.top}px, ${e.left}px calc(100% - ${e.bottom}px), calc(100% - ${e.right}px) calc(100% - ${e.bottom}px), calc(100% - ${e.right}px) ${e.top}px, ${e.left}px ${e.top}px)`
    ].map((d) => `${d} !important`).join("; ");
    function makeRing(el, cs, e, attrs) {
      const parent = el.parentNode;
      if (!parent || parent.nodeType !== 1 || win.SVGElement && parent instanceof win.SVGElement) return null;
      if (!(win.CSS && win.CSS.supports && win.CSS.supports("anchor-name: --a"))) return null;
      const name = `--ai4a11y-hit-${env.shared.nextId++}`;
      const theirs = cs.anchorName && cs.anchorName !== "none" ? `${cs.anchorName}, ` : "";
      s.setStyle(el, "anchor-name", theirs + name, "important");
      const ring = s.el("span", { attrs: { "aria-hidden": "true", ...attrs || {} }, kind: "hit" });
      const cursor = cs.cursor;
      ring.style.cssText = ringStyle(name, e, cursor);
      const forward = (ev) => {
        ev.stopPropagation();
        if (ev.type === "mousedown") {
          ev.preventDefault();
          if (typeof el.focus === "function") el.focus({ preventScroll: true });
        }
        const r = el.getBoundingClientRect();
        const x = Math.min(Math.max(ev.clientX, r.left + 0.5), r.right - 0.5);
        const y = Math.min(Math.max(ev.clientY, r.top + 0.5), r.bottom - 0.5);
        const Ctor = win.PointerEvent && ev instanceof win.PointerEvent ? win.PointerEvent : win.MouseEvent;
        el.dispatchEvent(new Ctor(ev.type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: win,
          detail: ev.detail,
          clientX: x,
          clientY: y,
          screenX: ev.screenX + x - ev.clientX,
          screenY: ev.screenY + y - ev.clientY,
          button: ev.button,
          buttons: ev.buttons,
          ctrlKey: ev.ctrlKey,
          shiftKey: ev.shiftKey,
          altKey: ev.altKey,
          metaKey: ev.metaKey,
          pointerId: ev.pointerId,
          pointerType: ev.pointerType,
          isPrimary: ev.isPrimary,
          width: ev.width,
          height: ev.height,
          pressure: ev.pressure
        }));
      };
      for (const type of FORWARD) s.listen(ring, type, forward);
      s.insert(parent, ring, el.nextSibling);
      return { how: "ring", ring, set: (next) => {
        ring.style.cssText = ringStyle(name, next, cursor);
      } };
    }
    function hitAreas(entries, { attrs } = {}) {
      const result = /* @__PURE__ */ new Map();
      if (!s.alive()) return result;
      const plan = [];
      for (const [el, e] of entries) {
        if (!el || !el.isConnected || !e) {
          result.set(el, null);
          continue;
        }
        const had = made.get(el);
        if (had) {
          plan.push({ el, e, had });
          continue;
        }
        if (e.lines > 1 || !(e.top || e.right || e.bottom || e.left)) {
          result.set(el, null);
          continue;
        }
        let cs;
        try {
          cs = win.getComputedStyle(el);
        } catch {
          result.set(el, null);
          continue;
        }
        plan.push({ el, e, cs, pseudo: e.clipped ? null : pseudoFor(el, cs) });
      }
      for (const { el, e, had, cs, pseudo } of plan) {
        if (had) {
          had.set(e);
          result.set(el, had.how);
          continue;
        }
        let m = null;
        if (pseudo) {
          if (!styled) {
            s.css("ai4a11y-hit", PSEUDO_CSS);
            styled = true;
          }
          s.setAttr(el, "data-ai4a11y-hit", pseudo.rel ? `${pseudo.which} rel` : pseudo.which);
          const set = (next) => s.setStyle(el, "--ai4a11y-hit", `-${next.top}px -${next.right}px -${next.bottom}px -${next.left}px`);
          set(e);
          m = { how: "pseudo", set };
        } else {
          m = makeRing(el, cs, e, typeof attrs === "function" ? attrs(el) : attrs);
        }
        if (m) made.set(el, m);
        result.set(el, m ? m.how : null);
      }
      return result;
    }
    const hitArea = (el, entry, options) => hitAreas(/* @__PURE__ */ new Map([[el, entry]]), options).get(el) ?? null;
    return { room, hitArea, hitAreas };
  }

  // toolkit/blocks/tooltip.js
  var TOOLTIP_DEFAULTS = {
    trigger: "[title]",
    content: "title",
    delayMs: 350,
    hideDelayMs: 150,
    placement: "below",
    describe: true,
    maxWidth: 320,
    theme: "dark",
    fontScale: 100
  };
  var THEMES = {
    dark: "background:#1f1f1f;color:#ffffff;border:1px solid #ffffff;",
    light: "background:#ffffff;color:#1f1f1f;border:1px solid #1f1f1f;"
  };
  function tooltipBlock(s, env) {
    const { doc, win } = env;
    let n = 0;
    return function tooltip(opts = {}) {
      const c = resolveConfig(TOOLTIP_DEFAULTS, opts, env.personal, { fontScale: "fontScale" });
      if (!s.alive()) return null;
      const id = `ai4a11y-tip-${s.id}-${++n}`.replace(/[^\w-]/g, "-");
      const tip = s.el("div", { attrs: { role: "tooltip", id } });
      tip.hidden = true;
      const scale = Math.max(1, (Number(c.fontScale) || 100) / 100);
      s.css(`tip-${n}`, `#${id} { position: fixed; left: 0; top: 0; z-index: 2147483646; box-sizing: border-box;
  max-width: min(${Number(c.maxWidth) || 320}px, calc(100vw - 16px)); padding: 8px 10px; border-radius: 6px;
  font: ${Math.round(16 * scale)}px/1.45 system-ui, sans-serif; text-align: start; white-space: normal;
  ${THEMES[c.theme] || THEMES.dark} box-shadow: 0 2px 8px rgba(0,0,0,.3); pointer-events: auto; }
#${id}[hidden] { display: none !important; }`);
      s.append(doc.body, tip);
      let current = null;
      let token = 0;
      let showTimer = 0, hideTimer = 0;
      let pointerAt = null;
      const dismissed = /* @__PURE__ */ new Set();
      const titles = /* @__PURE__ */ new WeakMap();
      const triggerOf = (node) => {
        const el = node && (node.nodeType === 1 ? node : node.parentElement);
        if (!el || !el.closest || tip.contains(el)) return null;
        for (let n2 = el; n2 && n2.nodeType === 1; n2 = n2.parentElement) {
          if (titles.has(n2)) return n2;
          try {
            if (n2.matches(c.trigger)) return n2;
          } catch {
            return null;
          }
        }
        return null;
      };
      const has = (el, node) => !!(el && node && (el === node || el.contains(node)));
      const overTip = () => has(tip, pointerAt);
      const focused = (t) => has(t, doc.activeElement);
      const forgetDismissed = () => {
        for (const t of [...dismissed]) if (!has(t, pointerAt) && !focused(t)) dismissed.delete(t);
      };
      const describe = (t, on) => {
        if (!c.describe) return;
        const ids = (t.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean).filter((x) => x !== id);
        if (on) ids.push(id);
        if (ids.length) t.setAttribute("aria-describedby", ids.join(" "));
        else t.removeAttribute("aria-describedby");
        env.shared.ourAttrs.set(t, new Map([...env.shared.ourAttrs.get(t) || [], ["aria-describedby", t.getAttribute("aria-describedby")]]));
      };
      function hide() {
        token++;
        if (showTimer) showTimer();
        if (hideTimer) hideTimer();
        if (current) describe(current, false);
        current = null;
        tip.hidden = true;
      }
      function place(t) {
        tip.style.left = "0px";
        tip.style.top = "0px";
        const w = tip.offsetWidth, h = tip.offsetHeight;
        const r = t.getBoundingClientRect();
        const vw = win.innerWidth || doc.documentElement.clientWidth, vh = win.innerHeight || doc.documentElement.clientHeight;
        const gap = 6;
        const below = r.bottom + gap, above = r.top - gap - h;
        const left = Math.max(4, Math.min(r.left, vw - w - 4));
        const fits = (top2) => top2 >= 0 && top2 + h <= vh;
        const covers = (top2) => {
          const f = doc.activeElement;
          if (!f || f === doc.body || has(t, f) || has(tip, f)) return false;
          const fr = f.getBoundingClientRect();
          return fr.width && !(fr.right <= left || fr.left >= left + w || fr.bottom <= top2 || fr.top >= top2 + h);
        };
        const order = c.placement === "above" ? [above, below] : [below, above];
        const top = order.find((y) => fits(y) && !covers(y)) ?? order.find(fits) ?? Math.max(0, Math.min(below, vh - h));
        tip.style.left = `${Math.round(left)}px`;
        tip.style.top = `${Math.round(top)}px`;
      }
      async function open(t) {
        if (!s.alive() || dismissed.has(t)) return;
        if (hideTimer) hideTimer();
        if (current === t && !tip.hidden) return;
        if (current && current !== t) describe(current, false);
        current = t;
        const my = ++token;
        let content;
        try {
          if (c.content === "title") {
            if (t.hasAttribute("title")) {
              titles.set(t, t.getAttribute("title"));
              s.setAttr(t, "title", null);
            }
            content = titles.get(t) || "";
          } else {
            content = typeof c.content === "function" ? c.content(t) : c.content;
          }
          if (content && typeof content.then === "function") content = await content;
        } catch {
          content = null;
        }
        if (!s.alive() || my !== token || current !== t || dismissed.has(t)) return;
        if (content === null || content === void 0 || content === "") {
          hide();
          return;
        }
        tip.textContent = "";
        if (typeof content === "string") tip.textContent = content;
        else tip.append(content);
        tip.hidden = false;
        describe(t, true);
        place(t);
      }
      function scheduleHide() {
        if (hideTimer) hideTimer();
        hideTimer = s.timer(() => {
          if (!current) return;
          if (overTip() || has(current, pointerAt) || focused(current)) return;
          hide();
        }, Number(c.hideDelayMs) || 0);
      }
      s.listen(doc, "mouseover", (e) => {
        pointerAt = e.target;
        forgetDismissed();
        if (has(tip, e.target)) {
          if (hideTimer) hideTimer();
          return;
        }
        const t = triggerOf(e.target);
        if (t && t === current) {
          if (hideTimer) hideTimer();
          return;
        }
        if (showTimer) showTimer();
        if (t) showTimer = s.timer(() => {
          if (has(t, pointerAt)) open(t);
        }, Number(c.delayMs) || 0);
        if (current) scheduleHide();
      }, true);
      s.listen(doc, "mouseout", (e) => {
        if (e.relatedTarget) return;
        pointerAt = null;
        if (current) scheduleHide();
      }, true);
      s.listen(doc, "focusin", (e) => {
        forgetDismissed();
        const t = triggerOf(e.target);
        if (t) {
          if (showTimer) showTimer();
          open(t);
        } else if (current && !has(tip, e.target)) scheduleHide();
      }, true);
      s.listen(doc, "focusout", (e) => {
        if (current && has(current, e.target) && !has(current, e.relatedTarget)) scheduleHide();
        for (const t of [...dismissed]) if (has(t, e.target) && !has(t, e.relatedTarget) && !has(t, pointerAt)) dismissed.delete(t);
      }, true);
      s.listen(doc, "keydown", (e) => {
        if (e.key !== "Escape" || !current) return;
        dismissed.add(current);
        hide();
      }, true);
      s.onEnd(hide);
      return {
        el: tip,
        open: (t) => open(t),
        hide,
        get trigger() {
          return current;
        }
      };
    };
  }

  // toolkit/blocks/panel.js
  var PANEL_DEFAULTS = {
    kind: "dialog",
    label: "Panel",
    near: null,
    corner: "bottom-right",
    focus: "from-trigger",
    returnTo: null,
    inert: false,
    theme: "page",
    width: 360,
    zIndex: 2147483646,
    fontScale: 100
  };
  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  function panelBlock(s, env) {
    const { doc, win } = env;
    let n = 0;
    return function panel(opts = {}) {
      const c = resolveConfig(PANEL_DEFAULTS, opts, env.personal, { fontScale: "fontScale" });
      if (!s.alive()) return null;
      const id = `ai4a11y-panel-${s.id}-${++n}`.replace(/[^\w-]/g, "-");
      const full = c.kind === "fullscreen";
      const root = s.el("section", {
        attrs: {
          id,
          role: c.kind === "disclosure" ? "region" : "dialog",
          "aria-labelledby": `${id}-title`,
          "aria-modal": full ? "true" : void 0
        }
      });
      root.hidden = true;
      const head = s.el("div", { attrs: { class: "ai4a11y-panel-head" } });
      const title = s.el("h2", { text: c.label, attrs: { id: `${id}-title`, tabindex: "-1" } });
      const close = s.el("button", { text: "Close", attrs: { type: "button" } });
      const body = s.el("div", { attrs: { class: "ai4a11y-panel-body" } });
      head.append(title, close);
      root.append(head, body);
      const pageStyle = win.getComputedStyle(doc.body || doc.documentElement);
      const theme = c.theme === "dark" ? { bg: "#1f1f1f", fg: "#ffffff", font: "system-ui, sans-serif" } : c.theme === "light" ? { bg: "#ffffff", fg: "#1f1f1f", font: "system-ui, sans-serif" } : { bg: "#ffffff", fg: "#1f1f1f", font: pageStyle.fontFamily || "system-ui, sans-serif" };
      const width = Math.max(200, Number(c.width) || 360);
      const scale = Math.max(1, (Number(c.fontScale) || 100) / 100);
      const corner = String(c.corner || "bottom-right");
      const sides = `${corner.includes("top") ? "top" : "bottom"}: 16px; ${corner.includes("left") ? "left" : "right"}: 16px;`;
      s.css(`panel-${n}`, `#${id} { position: fixed; ${full ? "inset: 0;" : `${sides} width: min(${width}px, calc(100vw - 32px)); max-height: calc(100vh - 32px);`}
  z-index: ${Number(c.zIndex) || 2147483646}; box-sizing: border-box; overflow: auto; padding: 12px 16px 16px;
  background: ${theme.bg}; color: ${theme.fg}; font-family: ${theme.font}; font-size: ${Math.round(16 * scale)}px; line-height: 1.5;
  border: 2px solid ${theme.fg}; border-radius: ${full ? "0" : "8px"}; box-shadow: 0 4px 16px rgba(0,0,0,.3); text-align: start; }
#${id}[hidden] { display: none !important; }
#${id} .ai4a11y-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
#${id} h2 { all: revert; margin: 0; font: 600 1.1em/1.3 inherit; color: inherit; }
#${id} button { all: revert; min-width: 44px; min-height: 32px; padding: 4px 12px; font: inherit; color: ${theme.fg}; background: transparent; border: 2px solid ${theme.fg}; border-radius: 6px; cursor: pointer; }
#${id} :focus-visible { outline: 3px solid ${theme.fg} !important; outline-offset: 2px !important; }`);
      s.append(doc.body, root);
      let opener = null;
      let inerted = [];
      function position() {
        const near = c.near && c.near.isConnected ? c.near : null;
        if (full || !near) return;
        const r = near.getBoundingClientRect();
        const vh = win.innerHeight, vw = win.innerWidth;
        const w = root.offsetWidth, h = root.offsetHeight;
        const left = Math.max(16, Math.min(r.left, vw - w - 16));
        const top = r.bottom + 8 + h <= vh ? r.bottom + 8 : r.top - 8 - h >= 0 ? r.top - 8 - h : null;
        if (top === null) return;
        Object.assign(root.style, { left: `${left}px`, top: `${top}px`, right: "auto", bottom: "auto" });
      }
      function open(by) {
        if (!s.alive() || !root.hidden) return;
        opener = by || doc.activeElement;
        root.hidden = false;
        position();
        if (full && c.inert) {
          for (const child of doc.body.children) {
            if (child === root || child.hasAttribute(UI_ATTR) || child.hasAttribute("inert") || child.matches('[aria-live], [role="status"], [role="alert"]')) continue;
            child.setAttribute("inert", "");
            inerted.push(child);
          }
        }
        if (c.focus === "always" || c.focus === "from-trigger" && by) title.focus();
      }
      function shut() {
        if (root.hidden) return;
        const hadFocus = root.contains(doc.activeElement);
        root.hidden = true;
        for (const el of inerted) el.removeAttribute("inert");
        inerted = [];
        if (hadFocus) {
          const back = [c.returnTo, opener].find((el) => el && el.isConnected && el !== doc.body);
          if (back && typeof back.focus === "function") back.focus();
        }
      }
      s.listen(close, "click", shut);
      s.listen(full ? doc : root, "keydown", (e) => {
        if (e.key !== "Escape" || root.hidden) return;
        e.stopPropagation();
        shut();
      }, full);
      s.onEnd(shut);
      return {
        el: root,
        body,
        title,
        closeButton: close,
        open,
        close: shut,
        get isOpen() {
          return !root.hidden;
        },
        focusable: () => [...root.querySelectorAll(FOCUSABLE)]
      };
    };
  }

  // toolkit/blocks/focus.js
  var ENTRY_CSS = `[data-ai4a11y-entries] > .ai4a11y-entry:not(:focus) { position: absolute !important; width: 1px !important; height: 1px !important; margin: -1px !important; padding: 0 !important; border: 0 !important; overflow: hidden !important; clip-path: inset(50%) !important; white-space: nowrap !important; }
[data-ai4a11y-entries] > .ai4a11y-entry:focus { position: fixed !important; top: 8px !important; left: 8px !important; z-index: 2147483647 !important; margin: 0 !important; padding: 10px 16px !important; min-height: 44px !important; background: #fff !important; color: #000 !important; border: 2px solid #000 !important; border-radius: 4px !important; outline: 3px solid #1a5fb4 !important; outline-offset: 2px !important; font: 600 16px/1.4 system-ui, sans-serif !important; text-decoration: underline !important; cursor: pointer !important; box-shadow: 0 0 0 6px #fff !important; }`;
  var SKIP_TEXT = /skip|jump|main content|go to content/i;
  var NATIVELY_FOCUSABLE = /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|IFRAME)$/;
  function focusBlock(s, env) {
    const { doc, win, shared } = env;
    const focusable = (el) => NATIVELY_FOCUSABLE.test(el.tagName) && !el.disabled || el.hasAttribute("tabindex");
    function region(el, { scroll = true } = {}) {
      if (!s.alive() || !el) return;
      if (!focusable(el)) {
        s.setAttr(el, "tabindex", "-1");
        const drop = () => {
          el.removeEventListener("blur", drop);
          if (el.getAttribute("tabindex") === "-1") el.removeAttribute("tabindex");
        };
        el.addEventListener("blur", drop);
      }
      el.focus({ preventScroll: true });
      if (scroll && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "start", behavior: reducedMotion(env) ? "auto" : "smooth" });
      }
    }
    function keepWhenRemoving(el) {
      if (!el || !el.contains(doc.activeElement)) return;
      let target = el.parentElement;
      while (target && target !== doc.body && !focusable(target)) target = target.parentElement;
      if (!target || target === doc.body) target = el.parentElement || doc.body;
      region(target, { scroll: false });
    }
    function pageSkipLink() {
      const first = [...doc.querySelectorAll("a[href], button, input, select, textarea, [tabindex]")].filter((el) => !env.page.isOurs(el) && el.tabIndex >= 0 && !el.disabled).slice(0, 3);
      return first.find((a) => {
        const href = a.getAttribute && a.getAttribute("href");
        if (!href || !/^#./.test(href)) return false;
        let target = null;
        try {
          target = doc.getElementById(decodeURIComponent(href.slice(1))) || doc.querySelector(`a[name="${CSS.escape(href.slice(1))}"]`);
        } catch {
          target = null;
        }
        return !!target && (SKIP_TEXT.test(env.page.nameOf(a) || a.textContent || "") || target === env.page.main() || target.contains(env.page.main()));
      }) || null;
    }
    function entries() {
      let box = shared.entries;
      if (box && box.isConnected) return box;
      box = doc.createElement("div");
      box.setAttribute(UI_ATTR, "ui");
      box.setAttribute("data-ai4a11y-entries", "");
      const style = doc.createElement("style");
      style.textContent = ENTRY_CSS;
      box.appendChild(style);
      shared.ourNodes.add(box);
      const skip = pageSkipLink();
      const body = doc.body || doc.documentElement;
      if (skip && skip.parentNode) skip.parentNode.insertBefore(box, skip.nextSibling);
      else body.insertBefore(box, body.firstChild);
      shared.entries = box;
      return box;
    }
    const dropIfEmpty = () => {
      const box = shared.entries;
      if (box && !box.querySelector(".ai4a11y-entry")) {
        box.remove();
        shared.entries = null;
      }
    };
    function entry({ label, onActivate } = {}) {
      if (!s.alive() || !label) return null;
      const btn = s.el("button", { text: String(label).slice(0, 80), attrs: { type: "button", class: "ai4a11y-entry" } });
      s.listen(btn, "click", (e) => {
        e.preventDefault();
        if (typeof onActivate === "function") onActivate(e);
      });
      s.onEnd(dropIfEmpty);
      s.append(entries(), btn);
      return btn;
    }
    function skipLink({ label = "Skip to main content", to } = {}) {
      if (!s.alive() || pageSkipLink()) return null;
      const target = to || env.page.main();
      if (!target || target === doc.body || target === doc.documentElement) return null;
      return entry({ label, onActivate: () => region(target) });
    }
    function bands(el) {
      if (typeof doc.elementFromPoint !== "function") return { top: 0, bottom: 0 };
      const vw = win.innerWidth, vh = win.innerHeight;
      const r = el.getBoundingClientRect();
      const xs = [r.left + 2, (r.left + r.right) / 2, r.right - 2].map((x) => Math.min(vw - 1, Math.max(0, x)));
      const bar = (x, y) => {
        for (let n = doc.elementFromPoint(x, y); n && n !== doc.body && n !== doc.documentElement; n = n.parentElement) {
          const pos = win.getComputedStyle(n).position;
          if (pos === "fixed" || pos === "sticky") {
            const b = n.getBoundingClientRect();
            if (b.height >= vh * 0.5 || n.contains(el)) return null;
            return b;
          }
        }
        return null;
      };
      let top = 0, bottom = 0;
      for (const x of xs) {
        const t = bar(x, 1);
        if (t && t.top <= 1) top = Math.max(top, t.bottom);
        const b = bar(x, vh - 2);
        if (b && b.bottom >= vh - 2) bottom = Math.max(bottom, vh - b.top);
      }
      return { top: Math.ceil(top), bottom: Math.ceil(bottom) };
    }
    function keepVisible({ margin = 8 } = {}) {
      if (!s.alive()) return () => {
      };
      const root = doc.documentElement;
      const check = (el) => {
        if (!s.alive() || !el || el === doc.body || el === root || !el.getBoundingClientRect) return;
        const { top, bottom } = bands(el);
        s.setStyle(root, "scroll-padding-top", top ? `${top + margin}px` : "");
        s.setStyle(root, "scroll-padding-bottom", bottom ? `${bottom + margin}px` : "");
        const r = el.getBoundingClientRect();
        const vh = win.innerHeight;
        let dy = 0;
        if (top && r.top < top + margin) dy = r.top - top - margin;
        else if (bottom && r.bottom > vh - bottom - margin && r.height < vh - top - bottom) dy = r.bottom - (vh - bottom - margin);
        if (dy) win.scrollBy(0, dy);
      };
      return s.listen(doc, "focusin", (e) => {
        const el = e.target;
        s.frame(() => {
          if (doc.activeElement === el) check(el);
        });
      }, true);
    }
    return { region, keepWhenRemoving, entry, skipLink, keepVisible };
  }
  var editable = (t) => !!(t && t.closest && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"], [role="searchbox"]'));
  function keysBlock(s, env) {
    const { shared } = env;
    function adjust({ label, settings = [], up, down } = {}) {
      if (!s.alive() || typeof up !== "function" || typeof down !== "function") return () => {
      };
      const entry = { label: String(label || env.adapter).slice(0, 60), settings: (settings || []).map(String), up, down, session: s };
      shared.adjusters.set(env.key, entry);
      if (env.transport.adjustable) Promise.resolve(env.transport.adjustable({ label: entry.label, settings: entry.settings })).catch(() => {
      });
      const stop = () => {
        if (shared.adjusters.get(env.key) === entry) shared.adjusters.delete(env.key);
      };
      s.onEnd(stop);
      return stop;
    }
    return { adjust };
  }

  // toolkit/blocks/text.js
  var WRAP_DEFAULTS = { cap: 500, skip: "" };
  var REPLACE_DEFAULTS = { showOriginal: true, label: "Simplified", originalLabel: "Show original", replacedLabel: "Show simplified" };
  var toRegExp = (match) => {
    if (match instanceof RegExp) return new RegExp(match.source, match.flags.includes("g") ? match.flags : match.flags + "g");
    if (typeof match === "string" && match) return new RegExp(match, "gu");
    throw new Error("text.wrap needs `match`: a regular expression, or its source as a string.");
  };
  function textBlock(s, env) {
    const { doc } = env;
    function wrap(root, opts = {}) {
      const c = resolveConfig(WRAP_DEFAULTS, opts, env.personal, {});
      if (!s.alive() || !root) return 0;
      const re = toRegExp(c.match);
      const build = typeof c.build === "function" ? c.build : (word) => {
        const span = doc.createElement("span");
        span.textContent = word;
        return span;
      };
      let count = 0;
      for (const node of env.page.textNodes(root, { skip: c.skip, includeReplaced: false })) {
        if (count >= c.cap) break;
        const text = node.nodeValue;
        re.lastIndex = 0;
        if (!re.test(text)) continue;
        re.lastIndex = 0;
        const wrapper = doc.createElement("span");
        wrapper.setAttribute("data-ai4a11y-text", s.id);
        let last = 0;
        for (const m of text.matchAll(re)) {
          if (!m[0] || count >= c.cap) break;
          if (m.index > last) wrapper.append(text.slice(last, m.index));
          const made = build(m[0], m);
          wrapper.append(made && made.nodeType ? made : m[0]);
          last = m.index + m[0].length;
          count++;
        }
        if (last < text.length) wrapper.append(text.slice(last));
        s.replace(node, wrapper);
      }
      if (count) s.css("text-wrap", `[data-ai4a11y-text="${s.id}"] { all: unset; display: inline; }`);
      return count;
    }
    function set(node, text) {
      if (!node || node.nodeType !== 3) return;
      s.setText(node, text);
    }
    function replaceBlock(el, text, opts = {}) {
      const c = resolveConfig(REPLACE_DEFAULTS, opts, env.personal, {});
      if (!s.alive() || !el || !el.parentNode || text === null || text === void 0 || !String(text).trim()) return null;
      const box = s.el("div", { kind: "content", attrs: { "data-ai4a11y-replaced": s.id } });
      const inner = doc.createElement("div");
      for (const para of String(text).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
        const p = doc.createElement("p");
        p.textContent = para;
        inner.append(p);
      }
      box.append(inner);
      s.setAttr(el, "hidden", "");
      s.insert(el.parentNode, box, el.nextSibling);
      let showingOriginal = false;
      let button = null;
      if (c.showOriginal) {
        const bar = s.el("div", { attrs: { class: "ai4a11y-replaced-bar" } });
        button = s.el("button", { text: c.originalLabel, attrs: { type: "button" } });
        bar.append(button);
        s.insert(box.parentNode, bar, box.nextSibling);
        s.listen(button, "click", () => toggle());
        s.css("replace-block", `[data-ai4a11y-replaced] > div > p { margin: 0 0 .75em; }
.ai4a11y-replaced-bar { margin: 4px 0 12px; }
.ai4a11y-replaced-bar button { font: inherit; font-size: max(1em, 16px); min-height: 32px; padding: 2px 10px; cursor: pointer; }`);
      }
      function toggle(original = !showingOriginal) {
        if (!s.alive()) return;
        showingOriginal = original;
        if (original) {
          el.removeAttribute("hidden");
          box.hidden = true;
        } else {
          el.setAttribute("hidden", "");
          box.hidden = false;
        }
        env.shared.ourAttrs.set(el, new Map([...env.shared.ourAttrs.get(el) || [], ["hidden", el.getAttribute("hidden")]]));
        if (button) button.textContent = original ? c.replacedLabel : c.originalLabel;
      }
      s.onEnd(() => {
        if (showingOriginal) el.setAttribute("hidden", "");
      });
      return { el: box, original: el, toggle, get showingOriginal() {
        return showingOriginal;
      } };
    }
    let scaling = null;
    const SKIP_SCALE = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|MATH|CANVAS|IFRAME|OBJECT|VIDEO|AUDIO|IMG)$/;
    const FIELDS = "input, select, textarea, button";
    function carriers(root) {
      const out = /* @__PURE__ */ new Set();
      if (!root || root.nodeType !== 1) return out;
      const walker = doc.createTreeWalker(
        root,
        4
        /* NodeFilter.SHOW_TEXT */
      );
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || out.has(el) || !n.nodeValue.trim() || SKIP_SCALE.test(el.tagName) || env.page.isOurs(el)) continue;
        out.add(el);
      }
      if (root.matches && root.matches(FIELDS) && !env.page.isOurs(root)) out.add(root);
      for (const f of root.querySelectorAll ? root.querySelectorAll(FIELDS) : []) if (!env.page.isOurs(f)) out.add(f);
      return out;
    }
    function scale(factor) {
      if (!s.alive()) return 0;
      const f = Math.max(0.5, Math.min(4, Number(factor) || 1));
      if (!scaling) scaling = { factor: 1, group: null, orig: /* @__PURE__ */ new WeakMap(), sized: /* @__PURE__ */ new Set(), clipped: /* @__PURE__ */ new WeakSet(), width: env.win.innerWidth, watching: false };
      const st = scaling;
      st.factor = f;
      if (f === 1) {
        if (st.group) st.group.end();
        st.group = null;
        st.sized.clear();
        st.clipped = /* @__PURE__ */ new WeakSet();
        return 0;
      }
      st.group ||= s.group();
      const n = apply([...carriers(doc.body)]);
      if (!st.watching) {
        st.watching = true;
        s.watch.added(null, (el) => {
          if (st.group && st.factor !== 1) apply([...carriers(el)], true);
        }, { debounceMs: 150 });
        s.listen(env.win, "resize", () => {
          if (!st.group || Math.abs(env.win.innerWidth - st.width) < 1) return;
          st.width = env.win.innerWidth;
          const keep = st.factor;
          scale(1);
          scaling.orig = /* @__PURE__ */ new WeakMap();
          scale(keep);
        });
      }
      return n;
    }
    function apply(list, late = false) {
      const st = scaling;
      const g = st.group;
      const win = env.win;
      const fresh = list.filter((el) => !st.orig.has(el));
      const lifted = [];
      if (late && fresh.length) {
        for (const el of fresh) {
          for (let a = el.parentElement; a; a = a.parentElement) {
            if (st.sized.has(a) && !lifted.includes(a)) {
              lifted.push(a);
              break;
            }
          }
        }
        for (const a of lifted) a.style.setProperty("font-size", `${st.orig.get(a).size}px`, "important");
      }
      const sheetsOff = [...doc.querySelectorAll(`style[${UI_ATTR}]`)].map((x) => x.sheet).filter((sh) => sh && !sh.disabled);
      for (const sh of sheetsOff) sh.disabled = true;
      try {
        for (const el of fresh) {
          const cs = win.getComputedStyle(el);
          const size = parseFloat(cs.fontSize);
          if (!(size > 0)) continue;
          const lh = cs.lineHeight;
          const ratio = /px$/.test(lh) ? parseFloat(lh) / size : null;
          st.orig.set(el, { size, ratio });
        }
      } finally {
        for (const sh of sheetsOff) sh.disabled = false;
      }
      const wasClipped = clippedNow(list);
      for (const a of lifted) a.style.setProperty("font-size", `${Math.round(st.orig.get(a).size * st.factor * 100) / 100}px`, "important");
      let n = 0;
      for (const el of list) {
        const o = st.orig.get(el);
        if (!o || !el.isConnected) continue;
        const px = Math.round(o.size * st.factor * 100) / 100;
        g.setStyle(el, "font-size", `${px}px`, "important");
        if (o.ratio) g.setStyle(el, "line-height", String(Math.round(o.ratio * 1e3) / 1e3));
        st.sized.add(el);
        n++;
      }
      grow(wasClipped, g, st.clipped);
      return n;
    }
    function clippedNow(carriersList) {
      const boxes = /* @__PURE__ */ new Map();
      for (const el of carriersList) {
        for (let b = el; b && b !== doc.body && !boxes.has(b); b = b.parentElement) boxes.set(b, 0);
      }
      for (const b of boxes.keys()) boxes.set(b, b.scrollHeight - b.clientHeight);
      return boxes;
    }
    function grow(before, into, done) {
      let n = 0;
      for (const [b, was] of before) {
        if (done.has(b) || !b.isConnected || !(b.clientHeight > 0)) continue;
        const over = b.scrollHeight - b.clientHeight;
        if (!(over > 1)) continue;
        const cs = env.win.getComputedStyle(b);
        if (cs.display === "inline" || /^(auto|scroll)$/.test(cs.overflowY)) continue;
        if (/^(hidden|clip)$/.test(cs.overflowY) ? was > 1 : !(over > was + 1)) continue;
        done.add(b);
        if (cs.height !== "auto") {
          into.setStyle(b, "min-height", cs.height);
          into.setStyle(b, "height", "auto", "important");
        }
        if (cs.maxHeight !== "none") into.setStyle(b, "max-height", "none", "important");
        n++;
      }
      return n;
    }
    const SPACING = {
      "line-height": { key: "lineHeight", unit: "", token: "lh" },
      "letter-spacing": { key: "letterSpacing", unit: "em", token: "ls" },
      "word-spacing": { key: "wordSpacing", unit: "em", token: "ws" }
    };
    const spacingPx = (cs, prop) => {
      const v = cs[SPACING[prop].key];
      if (v === "normal") return prop === "line-height" ? NaN : 0;
      return parseFloat(v);
    };
    const ROOM_ATTR = "data-ai4a11y-room";
    const grown = /* @__PURE__ */ new WeakSet();
    function fit(change, { root, atLeast = [] } = {}) {
      if (!s.alive() || typeof change !== "function") return 0;
      const list = [...carriers(root || doc.body)];
      const props = (Array.isArray(atLeast) ? atLeast : [atLeast]).filter((p) => SPACING[p]);
      const measure = () => list.map((el) => {
        const cs = env.win.getComputedStyle(el);
        return { fs: parseFloat(cs.fontSize), v: props.map((p) => spacingPx(cs, p)) };
      });
      const had = props.length ? measure() : null;
      const before = clippedNow(list);
      change();
      if (had) {
        const now = measure();
        const rules = /* @__PURE__ */ new Map();
        list.forEach((el, i) => {
          const { fs } = had[i];
          if (!(fs > 0)) return;
          const tokens = [];
          props.forEach((p, j) => {
            if (!(had[i].v[j] > now[i].v[j] + 0.25)) return;
            const { unit, token } = SPACING[p];
            const value = Math.round(had[i].v[j] / fs * 1e3) / 1e3;
            const t = `${token}${value}`;
            tokens.push(t);
            rules.set(t, `[${ROOM_ATTR}~="${t}"] { ${p}: ${value}${unit} !important; }`);
          });
          if (tokens.length) s.setAttr(el, ROOM_ATTR, tokens.join(" "));
        });
        if (rules.size) s.css("text-fit-room", `@layer ai4a11y-room {
${[...rules.values()].join("\n")}
}`);
      }
      return grow(before, s, grown);
    }
    return { wrap, set, replaceBlock, scale, fit, nodes: (root, opts) => env.page.textNodes(root, opts) };
  }

  // toolkit/blocks/ai/prompts.js
  var STR = (max) => ({ type: "string", maxLength: max });
  var PROMPT_FIELDS = Object.freeze({
    readingLevel: { description: "'plain', 'easy-read', or a school grade from 1 to 12. From the person's profile when it has one.", personal: true, anyOf: [{ enum: ["plain", "easy-read"] }, { type: "integer", minimum: 1, maximum: 12 }] },
    translateTo: { ...STR(40), description: "translate: the language to translate into, e.g. 'Spanish' (the settings vocabulary's translateTo)." },
    language: { ...STR(40), description: "The language to answer in, e.g. 'Spanish'. By default the language of the text." },
    tone: { ...STR(60), description: "e.g. 'friendly', 'formal', 'calm'. By default the tone of the original." },
    audience: { ...STR(200), description: "Who reads the answer, in a phrase, e.g. 'visitors new to banking terms'. Describe what they need, not a condition." },
    context: { ...STR(2e3), description: "What the model needs to understand the text: the page title, the heading, the sentence around a word, the site." },
    keep: { type: "array", maxItems: 50, items: STR(80), description: "Terms to keep exactly as written: names, drug names, product codes." },
    glossary: { type: "object", maxProperties: 30, additionalProperties: STR(200), description: "{ term: explanation } for terms the answer should explain your way." },
    instructions: { ...STR(1e3), description: 'Anything else, in a few plain sentences: "Use British spelling." "Explain each step as a numbered list."' },
    template: { ...STR(4e3), description: "A whole prompt of your own instead of the default. Must contain {text}; can use {context}, {readingLevel}, {language}, {translateTo}, {tone}, {audience}, {keep}, {glossary}, {instructions}, {maxSentences}, {maxChars}." },
    maxSentences: { type: "integer", minimum: 1, maximum: 20, description: "At most this many sentences (summarize, define)." },
    maxChars: { type: "integer", minimum: 20, maximum: 2e3, description: "At most this many characters (define, label, describe, chart)." },
    question: { ...STR(500), description: "choose: the question the options answer, about the page, in a plain sentence: 'Which of these is the page's main content?'" },
    choices: { type: "integer", minimum: 1, maximum: 12, description: "choose: how many options there are (set by the block)." },
    purpose: { enum: ["alt", "long"], description: "describe: 'alt' is one sentence for alt text, 'long' a fuller description." },
    minRatio: { type: "number", minimum: 0, maximum: 1, description: "Reject a rewrite shorter than this share of the input (gate)." },
    maxRatio: { type: "number", minimum: 0.5, maximum: 5, description: "Reject a rewrite longer than this many times the input (gate)." }
  });
  var TASKS = Object.freeze({
    simplify: { kind: "text", input: "a passage", gate: "rewrite", minRatio: 0.3, maxRatio: 2, summary: "Rewrite a passage in plain language, keeping every fact." },
    summarize: { kind: "text", input: "a passage", gate: "summary", maxSentences: 3, summary: "A short summary of a passage: the main point and anything the reader must do." },
    define: { kind: "text", input: "a word or phrase (put the sentence it is in into context)", gate: "short-passage", maxChars: 240, maxSentences: 2, summary: "What a word or phrase means here, in one or two plain sentences." },
    translate: { kind: "text", input: "a passage", gate: "rewrite", minRatio: 0.25, maxRatio: 4, summary: "Translate a passage into `translateTo`, keeping names, numbers and links." },
    rewrite: { kind: "text", input: "a passage", gate: "rewrite", minRatio: 0.2, maxRatio: 3, needs: "instructions or template", summary: "Rewrite a passage the way `instructions` say." },
    label: { kind: "text", input: "what is known about the control: its type, its current text, nearby text", gate: "short", maxChars: 60, summary: "A short accessible name (1-4 words) for a control." },
    linkText: { kind: "text", input: "the link's text, its address and the sentence around it", gate: "short", maxChars: 60, summary: "Link text (2-8 words) that says where a link goes." },
    columnHeader: { kind: "text", input: "the column's cells, one per line", gate: "short", maxChars: 60, summary: "A short header (1-4 words) for a table column." },
    choose: { kind: "text", input: "the options, numbered, each with what the page shows of it", gate: "choice", summary: "Which of the options the adapter found answers its question, judged from what the page shows of each; or that the page does not make it clear." },
    describe: { kind: "vision", input: "an image of the element", gate: "description", maxChars: 150, summary: "Describe an image for a person who cannot see it (alt text, or a longer description)." },
    chart: { kind: "vision", input: "an image of a chart", gate: "description", maxChars: 1200, summary: "Describe a chart: its type, axes, trend, and the highest and lowest values." }
  });

  // toolkit/blocks/ai.js
  var AI_DEFAULTS = { budget: 40, maxInputChars: 6e3 };
  var PERSONAL = { readingLevel: "readingLevel", translateTo: "translateTo" };
  var OPTION_KEYS = ["readingLevel", "translateTo", "language", "tone", "audience", "context", "keep", "glossary", "instructions", "template", "maxSentences", "maxChars", "purpose", "minRatio", "maxRatio", "question", "choices"];
  var MAX_CHOICES = 12;
  var CACHE_MAX = 300;
  function aiBlock(s, env) {
    let used = 0;
    const transport = env.transport || {};
    function cached(key, make) {
      const cache = env.shared.cache;
      let p = cache.get(key);
      if (p) return { p, fresh: false };
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      p = make();
      cache.set(key, p);
      p.then((v) => {
        if (v === null) cache.delete(key);
      });
      return { p, fresh: true };
    }
    function options(opts) {
      const c = resolveConfig(AI_DEFAULTS, opts, env.personal, PERSONAL);
      const o = {};
      for (const k of OPTION_KEYS) if (c[k] !== void 0 && c[k] !== null && c[k] !== "") o[k] = c[k];
      if (Array.isArray(o.keep)) {
        const f = PROMPT_FIELDS.keep;
        o.keep = [...new Set(o.keep.filter((x) => typeof x === "string" && x.trim() && x.length <= f.items.maxLength).map((x) => x.trim()))].slice(0, f.maxItems);
        if (!o.keep.length) delete o.keep;
      }
      if (o.glossary && typeof o.glossary === "object" && !Array.isArray(o.glossary)) {
        const f = PROMPT_FIELDS.glossary;
        o.glossary = Object.fromEntries(Object.entries(o.glossary).filter(([, v]) => typeof v === "string" && v.length <= 200).slice(0, f.maxProperties));
      }
      return { c, o };
    }
    async function ask(kind, task, input, opts, extra) {
      if (!s.alive()) return null;
      if (!TASKS[task] || TASKS[task].kind !== kind) throw new Error(`ai.${kind} has no task "${task}". Tasks: ${Object.entries(TASKS).filter(([, t]) => t.kind === kind).map(([k]) => k).join(", ")}.`);
      if (typeof transport.ai !== "function") return null;
      const { c, o } = options(opts);
      const key = `${kind}\0${task}\0${JSON.stringify(o)}\0${input}\0${extra.cacheKey || ""}`;
      const hit = env.shared.cache.has(key);
      if (!hit && used >= c.budget) return null;
      const { p, fresh } = cached(key, () => Promise.resolve().then(() => transport.ai({ kind, task, input, options: o, ...extra.request })).then((r) => r && typeof r.text === "string" && r.text.trim() ? r.text.trim() : null, () => null));
      if (fresh) used++;
      const out = await p;
      return s.alive() ? out : null;
    }
    async function text(task, input, opts = {}) {
      const t = String(input ?? "").trim();
      const max = Number(opts.maxInputChars) || AI_DEFAULTS.maxInputChars;
      if (!t || t.length > max) return null;
      return ask("text", task, t, opts, {});
    }
    async function vision(task, el, opts = {}) {
      if (!s.alive() || !el) return null;
      let image = null, rect = null;
      try {
        image = typeof env.capture === "function" ? await env.capture(el) : null;
      } catch {
        image = null;
      }
      if (!image) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        rect = { x: r.left, y: r.top, width: r.width, height: r.height, viewportWidth: env.win.innerWidth, viewportHeight: env.win.innerHeight };
      }
      const note = String(opts.about || "").slice(0, 500);
      const id = image ? `${image.data.length}:${image.data.slice(0, 64)}:${image.data.slice(-64)}` : JSON.stringify(rect);
      return ask("vision", task, note, opts, { cacheKey: id, request: image ? { image } : { rect } });
    }
    async function choose(question, options2, opts = {}) {
      if (!s.alive() || !String(question || "").trim() || !Array.isArray(options2)) return null;
      const list = options2.slice(0, MAX_CHOICES).map((o) => o && o.nodeType === 1 ? { value: o, about: outline(o) } : o).filter((o) => o && o.value !== void 0 && String(o.about || "").trim());
      if (!list.length || list.length < Math.min(options2.length, MAX_CHOICES)) return null;
      const max = Number(opts.maxInputChars) || AI_DEFAULTS.maxInputChars;
      const each = Math.floor(max / list.length) - 20;
      const input = list.map((o, i) => `Option ${i + 1}:
${String(o.about).trim().slice(0, each)}`).join("\n\n");
      const { maxInputChars, ...rest } = opts;
      const answer = await ask("text", "choose", input, { ...rest, question: String(question).trim().slice(0, 500), choices: list.length }, {});
      const n = Number(answer);
      return Number.isInteger(n) && n >= 1 && n <= list.length ? list[n - 1].value : null;
    }
    function outline(el, { maxChars = 1500 } = {}) {
      if (!el || el.nodeType !== 1) return "";
      const text2 = (n) => String(n.innerText ?? n.textContent ?? "").replace(/\s+/g, " ").trim();
      const links = (n) => n.querySelectorAll("a[href]").length;
      const what = (n) => {
        const role = n.getAttribute("role");
        const names = [n.id && `id "${n.id}"`, n.getAttribute("class") && `class "${String(n.getAttribute("class")).trim().slice(0, 60)}"`].filter(Boolean);
        return `<${n.localName}>${role ? ` role ${role}` : ""}${names.length ? ` (${names.join(", ")})` : ""}`;
      };
      const all = text2(el);
      const lines = [`${what(el)}: ${all.length} characters of text, ${links(el)} links. It begins: "${all.slice(0, 160)}"`];
      let shown = 0;
      for (const c of el.children) {
        if (shown >= 15) {
          lines.push("  …");
          break;
        }
        const t = text2(c);
        if (!t && !c.querySelector("img, svg, video, canvas, iframe")) continue;
        shown++;
        const k = links(c);
        lines.push(`  ${what(c)}${t ? `: "${t.slice(0, 100)}"` : ": no text"}${k ? `, ${k} link${k === 1 ? "" : "s"}` : ""}`);
      }
      return lines.join("\n").slice(0, maxChars);
    }
    return {
      text,
      vision,
      choose,
      outline,
      get used() {
        return used;
      },
      get available() {
        return typeof transport.ai === "function";
      }
    };
  }
  async function captureInPage(el, win) {
    const doc = el.ownerDocument;
    const MAX2 = 1024;
    const toPayload = (dataUrl) => {
      const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(dataUrl || "");
      return m ? { mimeType: m[1], data: m[2] } : null;
    };
    const draw = (source, w, h) => {
      const scale = Math.min(1, MAX2 / Math.max(w, h));
      const canvas = doc.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
      return toPayload(canvas.toDataURL("image/png"));
    };
    try {
      if (el.tagName === "CANVAS") return draw(el, el.width, el.height);
      if (el.tagName === "IMG" && el.complete && el.naturalWidth) return draw(el, el.naturalWidth, el.naturalHeight);
      if (el.tagName && el.tagName.toLowerCase() === "svg") {
        const r = el.getBoundingClientRect();
        const xml = new win.XMLSerializer().serializeToString(el);
        const img = new win.Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = "data:image/svg+xml;base64," + win.btoa(unescape(encodeURIComponent(xml)));
        });
        return draw(img, r.width || img.naturalWidth || 300, r.height || img.naturalHeight || 150);
      }
    } catch {
    }
    return null;
  }

  // toolkit/blocks/widget.js
  var PART = '[aria-roledescription="slide" i], [role="tabpanel" i]';
  var CONTROL = 'button, [role="button" i], [role="tab" i], [role="switch" i], input[type="button" i], input[type="submit" i], input[type="reset" i], input[type="image" i]';
  function widgetParts(widget) {
    if (!widget || widget.nodeType !== 1) return [];
    const all = [...widget.querySelectorAll(PART)].filter((el) => !isOurs(el));
    return all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
  }
  function controlled(el) {
    const doc = el.ownerDocument;
    return (el.getAttribute("aria-controls") || "").split(/\s+/).filter(Boolean).map((id) => doc.getElementById(id)).filter(Boolean);
  }
  function ownControls(widget, { parts, selector = CONTROL } = {}) {
    if (!widget || widget.nodeType !== 1) return [];
    const ps = Array.isArray(parts) ? parts.filter((p) => p && p.nodeType === 1) : widgetParts(widget);
    const inPart = (el) => ps.some((p) => p.contains(el));
    const forWidget = (t) => t === widget || t.contains(widget) || ps.includes(t) || ps.some((p) => t.contains(p) && widget.contains(t));
    const out = [];
    for (const el of widget.querySelectorAll(selector)) {
      if (isOurs(el)) continue;
      const targets = controlled(el);
      if (targets.length ? targets.some(forWidget) : !inPart(el)) out.push(el);
    }
    return out;
  }

  // toolkit/blocks/landmarks.js
  var LANDMARK_ROLES = ["banner", "complementary", "contentinfo", "form", "main", "navigation", "region", "search"];
  var LANDMARK = new Set(LANDMARK_ROLES);
  var NEEDS_NAME = /* @__PURE__ */ new Set(["form", "region"]);
  var ROLES = new Set("alert alertdialog application article banner blockquote button caption cell checkbox code columnheader combobox complementary contentinfo definition deletion dialog directory document emphasis feed figure form generic grid gridcell group heading img image insertion link list listbox listitem log main mark marquee math menu menubar menuitem menuitemcheckbox menuitemradio meter navigation none note option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status strong subscript superscript switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem".split(" "));
  var GLOBAL_ARIA = [
    "aria-atomic",
    "aria-busy",
    "aria-controls",
    "aria-current",
    "aria-describedby",
    "aria-details",
    "aria-dropeffect",
    "aria-errormessage",
    "aria-flowto",
    "aria-grabbed",
    "aria-haspopup",
    "aria-invalid",
    "aria-keyshortcuts",
    "aria-label",
    "aria-labelledby",
    "aria-live",
    "aria-owns",
    "aria-relevant",
    "aria-roledescription"
  ];
  var HEADER_SCOPE_TAGS = /* @__PURE__ */ new Set(["article", "aside", "main", "nav", "section"]);
  var HEADER_SCOPE_ROLES = /* @__PURE__ */ new Set(["article", "complementary", "main", "navigation"]);
  var ASIDE_SCOPE_TAGS = /* @__PURE__ */ new Set(["article", "aside", "nav", "section"]);
  var ASIDE_SCOPE_ROLES = /* @__PURE__ */ new Set(["article", "complementary", "navigation"]);
  var CANDIDATES = "header, footer, main, nav, aside, section, form, search, [role]";
  function explicitRole(el) {
    const tokens = (el.getAttribute("role") || "").trim().toLowerCase().split(/\s+/);
    const role = tokens.find((t) => ROLES.has(t) || /^(doc|graphics)-[a-z]+$/.test(t)) || "";
    if (role !== "none" && role !== "presentation") return role;
    if (el.hasAttribute("tabindex") || GLOBAL_ARIA.some((a) => el.hasAttribute(a))) return "";
    return role;
  }
  function hasName(el) {
    const doc = el.ownerDocument;
    const ids = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
    if (ids.some((id) => doc.getElementById(id))) return true;
    return Boolean((el.getAttribute("aria-label") || "").trim() || (el.getAttribute("title") || "").trim());
  }
  function hidden(el) {
    if (el.closest('[hidden], [aria-hidden="true" i]')) return true;
    const win = el.ownerDocument.defaultView;
    if (!win) return false;
    if (win.getComputedStyle(el).visibility === "hidden") return true;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (win.getComputedStyle(n).display === "none") return true;
    }
    return false;
  }
  function inside(el, tags, roles) {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const role = n.hasAttribute("role") ? explicitRole(n) : "";
      if (role ? roles.has(role) : tags.has(n.localName)) return true;
    }
    return false;
  }
  function landmark(el) {
    if (!el || el.nodeType !== 1 || isOurs(el) || hidden(el)) return null;
    const role = el.hasAttribute("role") ? explicitRole(el) : "";
    if (role && !(NEEDS_NAME.has(role) && !hasName(el))) return LANDMARK.has(role) ? role : null;
    switch (el.localName) {
      case "header":
        return inside(el, HEADER_SCOPE_TAGS, HEADER_SCOPE_ROLES) ? null : "banner";
      case "footer":
        return inside(el, HEADER_SCOPE_TAGS, HEADER_SCOPE_ROLES) ? null : "contentinfo";
      case "main":
        return "main";
      case "nav":
        return "navigation";
      case "search":
        return "search";
      case "aside":
        return inside(el, ASIDE_SCOPE_TAGS, ASIDE_SCOPE_ROLES) && !hasName(el) ? null : "complementary";
      case "section":
        return hasName(el) ? "region" : null;
      case "form":
        return hasName(el) ? "form" : null;
      default:
        return null;
    }
  }
  function landmarks(doc, role, { root } = {}) {
    const from = root || doc.body || doc.documentElement;
    if (!from) return [];
    const all = [from, ...from.querySelectorAll(CANDIDATES)];
    return all.filter((el) => el.matches(CANDIDATES) && (role ? landmark(el) === role : landmark(el) !== null));
  }

  // toolkit/blocks/page.js
  var SKIP_SELECTOR = [
    "script",
    "style",
    "noscript",
    "template",
    "svg",
    "math",
    "canvas",
    "iframe",
    "object",
    "textarea",
    "input",
    "select",
    "option",
    "code",
    "pre",
    "kbd",
    "samp",
    "var",
    '[contenteditable=""]',
    '[contenteditable="true"]',
    "[aria-live]",
    '[role="status"]',
    '[role="alert"]',
    '[role="log"]',
    '[role="timer"]',
    '[role="marquee"]',
    `[${UI_ATTR}="ui"]`
  ].join(", ");
  var CHROME_LANDMARKS = /* @__PURE__ */ new Set(["navigation", "banner", "contentinfo", "complementary", "search"]);
  var MAY_BE_LANDMARK = "header, footer, nav, aside, search, section, form, [role]";
  var ARTICLE = 'article, [role="article" i]';
  var isChrome = (el) => el.matches(MAY_BE_LANDMARK) && CHROME_LANDMARKS.has(landmark(el));
  function inChrome(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) if (isChrome(n)) return true;
    return false;
  }
  var BLOCK = /^(address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|section|table|td|th|tr|ul|br|summary|details)$/i;
  var INTERACTIVE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="option"], [tabindex]:not([tabindex="-1"])';
  var NAME_FROM_CONTENT = /^(a|button|summary|h[1-6]|label|legend|caption|figcaption|option|td|th|li|dt)$/i;
  var CONTENT_ROLES = /* @__PURE__ */ new Set(["button", "link", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "checkbox", "radio", "switch", "option", "treeitem", "cell", "columnheader", "rowheader", "heading", "tooltip"]);
  var SVG_NS = "http://www.w3.org/2000/svg";
  var squash = (t) => String(t || "").replace(/\s+/g, " ").trim();
  function pageBlock(env) {
    const { doc, win } = env;
    const layout = () => hasLayout(doc);
    function isVisible(el, { size = true } = {}) {
      if (!el || el.nodeType !== 1 || !el.isConnected) return false;
      if (el.closest("[hidden]")) return false;
      const style = win.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0) return false;
      if (!layout()) return true;
      if (typeof el.checkVisibility === "function" && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
      if (!size) return true;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    function main() {
      const shown = (el) => isVisible(el) || win.getComputedStyle(el).display === "contents" && [...el.children].some((c) => isVisible(c));
      const visible = (list) => [...list].filter((el) => shown(el) && !isOurs(el));
      const marked = visible(doc.querySelectorAll('main, [role="main" i]'));
      if (marked.length) return marked[0];
      const articles = visible(doc.querySelectorAll(ARTICLE)).filter((el) => {
        const role = (el.getAttribute("role") || "").trim().toLowerCase();
        return (!role || role === "article") && !(el.parentElement && el.parentElement.closest(ARTICLE)) && !inChrome(el);
      });
      if (articles.length === 1) return articles[0];
      return doc.body || doc.documentElement;
    }
    function textNodes(root, { skip = "", includeReplaced = true } = {}) {
      const out = [];
      if (!root) return out;
      const skipSel = skip ? `${SKIP_SELECTOR}, ${skip}` : SKIP_SELECTOR;
      const hiddenCache = /* @__PURE__ */ new Map();
      const hidden2 = (el) => {
        if (hiddenCache.has(el)) return hiddenCache.get(el);
        let h = false;
        if (el.matches(skipSel) || el.hidden || el.getAttribute("aria-hidden") === "true") h = true;
        else if (el.getAttribute(UI_ATTR) === "content" && !includeReplaced) h = true;
        else {
          const st = win.getComputedStyle(el);
          h = st.display === "none" || st.visibility === "hidden";
        }
        if (!h && el.parentElement && el !== root) h = hidden2(el.parentElement);
        hiddenCache.set(el, h);
        return h;
      };
      const walker = doc.createTreeWalker(
        root,
        4
        /* SHOW_TEXT */
      );
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.nodeValue.trim()) continue;
        const parent = n.parentElement;
        if (!parent || hidden2(parent)) continue;
        out.push(n);
      }
      return out;
    }
    function readableText(root, { blockPause = "\n", skip = "", includeReplaced = true } = {}) {
      let text = "";
      let lastBlock = null;
      for (const node of textNodes(root, { skip, includeReplaced })) {
        let block = node.parentElement;
        while (block && block !== root && !BLOCK.test(block.tagName)) block = block.parentElement;
        if (text && block !== lastBlock) text = text.replace(/\s+$/, "") + blockPause;
        lastBlock = block;
        text += node.nodeValue.replace(/\s+/g, " ");
      }
      return text.replace(/[ \t]+/g, " ").trim();
    }
    function headings({ maxLevel = 6, root = doc.body } = {}) {
      const out = [];
      if (!root) return out;
      for (const el of root.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading" i]')) {
        if (isOurs(el) || !isVisible(el) || el.closest('[aria-hidden="true"]')) continue;
        if (/^(presentation|none)$/i.test((el.getAttribute("role") || "").trim())) continue;
        const aria = parseInt(el.getAttribute("aria-level"), 10);
        const level = /^H[1-6]$/.test(el.tagName) && !el.hasAttribute("aria-level") ? +el.tagName[1] : aria >= 1 ? aria : 2;
        if (level > maxLevel) continue;
        out.push({ el, level, text: nameOf(el) });
      }
      return out;
    }
    function contentText(el) {
      let t = "";
      for (const n of el.childNodes) {
        if (n.nodeType === 3) t += n.nodeValue;
        else if (n.nodeType === 1) {
          if (n.hidden || n.getAttribute("aria-hidden") === "true" || /^(script|style|template|input|textarea|select)$/i.test(n.tagName)) continue;
          if (n.tagName === "IMG") t += " " + (n.getAttribute("alt") || "") + " ";
          else t += " " + contentText(n) + " ";
        }
      }
      return t;
    }
    function labelledBy(el) {
      const ids = (el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
      return ids.map((id) => doc.getElementById(id)).filter(Boolean).map((ref) => squash(ref.getAttribute("aria-label")) || squash(contentText(ref)) || squash(ref.getAttribute("title"))).join(" ");
    }
    function labelFor(el) {
      const labels = el.labels ? [...el.labels] : [];
      if (!labels.length && el.id) labels.push(...doc.querySelectorAll(`label[for="${CSS_escape(el.id)}"]`));
      const wrap = el.closest("label");
      if (wrap && !labels.includes(wrap)) labels.push(wrap);
      return labels.map((l) => squash(contentText(l))).filter(Boolean).join(" ");
    }
    function svgTitleOf(el) {
      if (el.namespaceURI !== SVG_NS) return "";
      for (const child of el.children) if (child.localName === "title" && child.namespaceURI === SVG_NS) return child.textContent;
      return "";
    }
    function nameOf(el) {
      if (!el || el.nodeType !== 1) return "";
      const tag = el.tagName;
      const type = (el.getAttribute("type") || "").toLowerCase();
      const isField = /^(INPUT|TEXTAREA|SELECT)$/.test(tag);
      const role = (el.getAttribute("role") || "").toLowerCase().split(/\s+/)[0];
      const candidates = [
        labelledBy(el),
        el.getAttribute("aria-label"),
        svgTitleOf(el),
        tag === "IMG" || tag === "INPUT" && type === "image" || tag === "AREA" ? el.getAttribute("alt") : "",
        isField ? labelFor(el) : "",
        tag === "INPUT" && /^(button|submit|reset)$/.test(type) ? el.getAttribute("value") : "",
        NAME_FROM_CONTENT.test(tag) || CONTENT_ROLES.has(role) ? contentText(el) : "",
        tag === "FIELDSET" ? el.querySelector("legend")?.textContent : "",
        tag === "TABLE" ? el.querySelector("caption")?.textContent : "",
        el.getAttribute("title"),
        isField ? el.getAttribute("placeholder") : "",
        tag === "INPUT" && type === "submit" ? "Submit" : tag === "INPUT" && type === "reset" ? "Reset" : ""
      ];
      return candidates.map(squash).find(Boolean) || "";
    }
    function find(name, { within = doc.body, selector = INTERACTIVE } = {}) {
      const want = squash(name).toLowerCase();
      if (!want || !within) return null;
      let best = null, bestScore = 0;
      for (const el of within.querySelectorAll(selector)) {
        if (isOurs(el) || !isVisible(el)) continue;
        const have = nameOf(el).toLowerCase();
        if (!have) continue;
        const score = have === want ? 3 : have.startsWith(want) ? 2 : have.includes(want) ? 1 : 0;
        if (score > bestScore) {
          best = el;
          bestScore = score;
          if (score === 3) break;
        }
      }
      return best;
    }
    function textContrast(el) {
      const cs = win.getComputedStyle(el);
      const layers = [];
      let overImage = false;
      const box = layout() ? el.getBoundingClientRect() : null;
      const cx = box && box.left + box.width / 2, cy = box && box.top + box.height / 2;
      const under = (n) => {
        if (!box || n === el || !(box.width || box.height)) return true;
        const r = n.getBoundingClientRect();
        return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
      };
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        if (!under(n)) continue;
        const ns = n === el ? cs : win.getComputedStyle(n);
        const c2 = parseColor(ns.backgroundColor);
        if (ns.backgroundImage && ns.backgroundImage !== "none") {
          overImage = true;
          break;
        }
        if (c2 && c2[3] > 0) layers.push(c2);
        if (c2 && c2[3] >= 0.999) break;
      }
      let bg = [255, 255, 255];
      for (const [r, g, b, a] of layers.reverse()) bg = [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
      const c = parseColor(cs.color) || [0, 0, 0, 1];
      const fg = [0, 1, 2].map((i) => c[i] * c[3] + bg[i] * (1 - c[3]));
      const size = parseFloat(cs.fontSize) || 16;
      const large = size >= 24 || size >= 18.66 && (parseInt(cs.fontWeight, 10) || 400) >= 700;
      const min = large ? 3 : 4.5;
      const ratio = Math.round(contrast(fg, bg) * 100) / 100;
      const fix = overImage || ratio >= min ? null : hex(nearestWithContrast(fg, bg, min + 0.05));
      return { color: hex(fg), background: hex(bg), ratio, min, large, overImage, fix };
    }
    return {
      main,
      textNodes,
      readableText,
      headings,
      nameOf,
      find,
      isVisible,
      isOurs: (el) => isOurs(el),
      background: (el) => backgroundOf(el, win),
      contrast,
      textContrast,
      widgetParts,
      ownControls,
      landmark,
      landmarks: (role, opts) => landmarks(doc, role, opts)
    };
  }
  function CSS_escape(s) {
    return String(s).replace(/["\\]/g, "\\$&");
  }

  // toolkit/blocks/main.js
  var MAIN_QUESTION = "Which of these is the page's main content: what a person comes to this page to read or use, not its menus, sidebars, header or footer?";
  var NOT_RUNNING = 'a[href], button, label, summary, select, option, [role="link" i], [role="button" i], [role="menuitem" i], [role="tab" i], [role="option" i]';
  var PARAGRAPH_TAGS = /^(p|h[1-6]|li|dt|dd|blockquote|figcaption|caption|summary|address)$/i;
  var PARAGRAPH = 60;
  var MIN_TOTAL = 200;
  var SHARE = 0.2;
  var ONE_BLOCK = 500;
  var TIGHT = 0.85;
  var MAX = 6;
  function mainCandidates(env) {
    const { doc, win, page } = env;
    const body = doc.body;
    if (!body) return [];
    const blocked = /* @__PURE__ */ new Map();
    const excluded = (el) => {
      if (!el || el === body || el === doc.documentElement) return false;
      if (blocked.has(el)) return blocked.get(el);
      let x = isOurs(el) || el.localName === "dialog" || /^(dialog|alertdialog)$/i.test((el.getAttribute("role") || "").trim()) || isChrome(el);
      if (!x) {
        try {
          x = win.getComputedStyle(el).position === "fixed";
        } catch {
          x = false;
        }
      }
      if (!x) x = excluded(el.parentElement);
      blocked.set(el, x);
      return x;
    };
    const blockOf = (node) => {
      let b = node.parentElement;
      while (b && b !== body && !BLOCK.test(b.tagName)) b = b.parentElement;
      return b || body;
    };
    const own = /* @__PURE__ */ new Map();
    for (const node of page.textNodes(body)) {
      const parent = node.parentElement;
      if (excluded(parent) || parent.closest(NOT_RUNNING)) continue;
      const n = node.nodeValue.replace(/\s+/g, " ").trim().length;
      if (!n) continue;
      const b = blockOf(node);
      own.set(b, (own.get(b) || 0) + n);
    }
    const paragraphs = [...own].filter(([b, n]) => n >= PARAGRAPH && !/^h[1-6]$/i.test(b.tagName));
    const total = paragraphs.reduce((t, [, n]) => t + n, 0);
    if (total < MIN_TOTAL) return [];
    const held = /* @__PURE__ */ new Map();
    for (const [b, n] of paragraphs) {
      for (let a = b; a && a !== body && a !== doc.documentElement; a = a.parentElement) {
        const h = held.get(a) || { text: 0, count: 0 };
        h.text += n;
        h.count++;
        held.set(a, h);
      }
    }
    let found = [...held].filter(([el, h]) => h.text >= SHARE * total && (h.count >= 2 || h.text >= ONE_BLOCK) && !PARAGRAPH_TAGS.test(el.tagName) && page.isVisible(el));
    found = found.filter(([el, h]) => !found.some(([d, dh]) => d !== el && el.contains(d) && dh.text >= TIGHT * h.text));
    return found.sort((a, b) => b[1].text - a[1].text).slice(0, MAX).map(([el]) => el).sort((a, b) => a.compareDocumentPosition(b) & 4 ? -1 : 1);
  }
  var sameList = (a, b) => a.length === b.length && a.every((el, i) => el === b[i]);
  function findMainBlock(s, env) {
    const { doc, win, shared } = env;
    const said = () => {
      const m = env.page.main();
      return m && m !== doc.body && m !== doc.documentElement ? m : null;
    };
    return async function findMain() {
      if (!s.alive()) return null;
      const first = said();
      if (first) return first;
      if (!s.ai.available) return null;
      const options = mainCandidates(env);
      if (!options.length) return null;
      const href = String(win.location && win.location.href || "");
      for (; ; ) {
        let asked = shared.mainAsked;
        if (!asked || asked.href !== href || !sameList(asked.options, options)) {
          const title = String(doc.title || "").replace(/\s+/g, " ").trim().slice(0, 200);
          asked = { href, options, asker: s, answer: s.ai.choose(MAIN_QUESTION, options, title ? { context: `The page's title: "${title}"` } : {}) };
          shared.mainAsked = asked;
        }
        const el = await asked.answer;
        if (!s.alive()) return null;
        if (el === null && asked.asker !== s && !asked.asker.alive() && shared.mainAsked === asked) {
          shared.mainAsked = null;
          continue;
        }
        return said() || (el && el.isConnected ? el : null);
      }
    };
  }

  // toolkit/blocks/speech.js
  var SAY_DEFAULTS = { speechRate: 1, pitch: 1, voice: null, lang: null, chunkChars: 220, waitForGesture: true };
  var LISTEN_DEFAULTS = { lang: null, feedback: "announce", maxErrors: 3 };
  function speechBlock(s, env) {
    const { win, doc, shared } = env;
    function source(input) {
      if (typeof input === "string") return { text: input, map: null };
      if (input && typeof input.getRangeAt === "function") input = input.rangeCount ? input.getRangeAt(0) : null;
      const range = input && input.startContainer && typeof input.intersectsNode === "function" ? input : null;
      let root = range ? range.commonAncestorContainer : input;
      if (root && root.nodeType === 3) root = root.parentElement;
      if (!root || root.nodeType !== 1) return { text: String(input ?? ""), map: null };
      let text = "";
      const map = [];
      for (const node of env.page.textNodes(root)) {
        let base = 0, stop = node.nodeValue.length;
        if (range) {
          if (!range.intersectsNode(node)) continue;
          if (node === range.startContainer) base = range.startOffset;
          if (node === range.endContainer) stop = range.endOffset;
          if (stop <= base) continue;
        }
        if (text && !/\s$/.test(text)) text += " ";
        map.push({ node, base, start: text.length, end: text.length + stop - base });
        text += node.nodeValue.slice(base, stop);
      }
      if (range && !map.length) return { text: String(range), map: null };
      return { text, map };
    }
    function chunks(text, max) {
      const out = [];
      const parts = text.match(/[^.!?。！？\n]+[.!?。！？]*[\s]*|\n+/g) || [text];
      let cur = "", start = 0, pos = 0;
      for (const p of parts) {
        if (cur && cur.length + p.length > max) {
          out.push({ text: cur, start });
          start = pos;
          cur = "";
        }
        cur += p;
        pos += p.length;
      }
      if (cur.trim()) out.push({ text: cur, start });
      return out.filter((c) => c.text.trim());
    }
    function say(input, opts = {}) {
      const c = resolveConfig(SAY_DEFAULTS, opts, env.personal, { speechRate: "speechRate" });
      const remote = env.transport.speak;
      const synth = win.speechSynthesis;
      const Utterance = win.SpeechSynthesisUtterance;
      let resolveDone;
      const done = new Promise((r) => {
        resolveDone = r;
      });
      let current = null;
      const handle = {
        supported: !!remote || !!(synth && Utterance),
        done,
        get speaking() {
          return state === "speaking" || state === "paused";
        },
        pause() {
          if (state === "speaking") {
            state = "paused";
            if (remote) current?.pause();
            else synth.pause();
          }
        },
        resume() {
          if (state === "paused") {
            state = "speaking";
            if (remote) current?.resume();
            else synth.resume();
          }
        },
        stop() {
          finish(true);
        }
      };
      let state = "waiting";
      if (!s.alive() || !handle.supported) {
        resolveDone(false);
        return handle;
      }
      const { text, map } = source(input);
      const from = Math.max(0, Math.min(text.length, Math.floor(Number(opts.from) || 0)));
      const parts = chunks(text.slice(from), Math.max(40, Number(c.chunkChars) || 220)).map((p) => ({ ...p, start: p.start + from }));
      if (!parts.length) {
        resolveDone(false);
        return handle;
      }
      const rate = Math.max(0.5, Math.min(2, Number(c.speechRate) || 1));
      const pitch = Math.max(0, Math.min(2, Number(c.pitch) || 1));
      const lang = c.lang || doc.documentElement.lang || "";
      const rangeAt = (abs, len) => {
        if (!map) return null;
        const entry = map.find((m) => abs >= m.start && abs < m.end);
        if (!entry) return null;
        const r = doc.createRange();
        const from2 = entry.base + abs - entry.start;
        r.setStart(entry.node, from2);
        r.setEnd(entry.node, Math.min(entry.base + entry.end - entry.start, from2 + Math.max(1, len)));
        return r;
      };
      const wordLength = (abs) => {
        const m = /^[\p{L}\p{N}'’-]+/u.exec(text.slice(abs));
        return m ? m[0].length : 1;
      };
      const word = (abs, len) => {
        if (state === "done" || !c.onWord) return;
        try {
          c.onWord(rangeAt(abs, len || wordLength(abs)), abs);
        } catch {
        }
      };
      const next = (i) => {
        if (state !== "done" && s.alive()) {
          try {
            c.onChunk?.(i + 1, parts.length);
          } catch {
          }
          speak(i + 1);
        }
      };
      const voice = () => {
        const voices = synth.getVoices ? synth.getVoices() : [];
        return voices.find((v) => v.name === c.voice) || c.lang && voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(String(c.lang).toLowerCase())) || null;
      };
      function finish(stopped) {
        if (state === "done") return;
        const wasActive = state !== "waiting";
        state = "done";
        if (shared.voice === handle) {
          shared.voice = null;
          if (wasActive) {
            if (remote) {
              try {
                current?.stop();
              } catch {
              }
            } else synth.cancel();
          }
        }
        current = null;
        if (c.onWord) try {
          c.onWord(null, -1);
        } catch {
        }
        resolveDone(!stopped);
      }
      function speak(i) {
        if (state === "done" || !s.alive()) return;
        if (i >= parts.length) {
          finish(false);
          return;
        }
        const part = parts[i];
        if (remote) {
          let ended = false;
          current = remote({ text: part.text, speechRate: rate, pitch, lang, voice: c.voice || null }, (e) => {
            if (ended || state === "done" || !e) return;
            if (e.type === "word") word(part.start + (Number(e.charIndex) || 0), Number(e.length) || 0);
            else if (e.type === "end") {
              ended = true;
              next(i);
            } else if (["error", "interrupted", "cancelled"].includes(e.type)) {
              ended = true;
              finish(true);
            }
          });
          return;
        }
        const u = new Utterance(part.text);
        u.rate = rate;
        u.pitch = pitch;
        u.lang = lang;
        const v = voice();
        if (v) u.voice = v;
        u.onboundary = (e) => {
          if (e.name && e.name !== "word") return;
          word(part.start + e.charIndex, e.charLength);
        };
        u.onend = () => next(i);
        u.onerror = (e) => {
          if (e.error !== "interrupted" && e.error !== "canceled") finish(true);
        };
        synth.speak(u);
      }
      function start() {
        if (state !== "waiting" || !s.alive()) return;
        if (shared.voice && shared.voice !== handle) shared.voice.stop();
        shared.voice = handle;
        state = "speaking";
        if (!remote) synth.cancel();
        speak(0);
      }
      s.listen(doc, "keydown", (e) => {
        if (e.key === "Escape" && handle.speaking) handle.stop();
      }, true);
      s.onEnd(() => finish(true));
      const activation = win.navigator && win.navigator.userActivation;
      if (c.waitForGesture && activation && !activation.hasBeenActive) {
        const go = (e) => {
          if (e.isTrusted && e.key !== "Escape") {
            off1();
            off2();
            start();
          }
        };
        const off1 = s.listen(doc, "pointerdown", go, true);
        const off2 = s.listen(doc, "keydown", go, true);
      } else {
        start();
      }
      return handle;
    }
    function listen(opts = {}) {
      const c = resolveConfig(LISTEN_DEFAULTS, opts, env.personal, {});
      const Recognition = win.SpeechRecognition || win.webkitSpeechRecognition;
      const handle = { supported: !!Recognition, listening: false, stop() {
      } };
      if (!s.alive() || !Recognition) return handle;
      const commands = Object.entries(c.commands || {}).map(([phrase, fn]) => {
        const p = phrase.toLowerCase().trim();
        const re = p.includes("*") ? new RegExp("^" + p.split("*").map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(.+?)") + "$") : null;
        return { p, re, fn };
      });
      const say2 = (m) => {
        if (c.feedback === "announce") s.announce(m);
      };
      const badge = s.el("div", { attrs: { role: "group", "aria-label": "Voice commands" } });
      const label = s.el("span", { text: "Listening" });
      const stopButton = s.el("button", { text: "Stop listening", attrs: { type: "button" } });
      badge.append(label, stopButton);
      badge.setAttribute("style", "position:fixed;left:16px;bottom:16px;z-index:2147483646;display:flex;gap:8px;align-items:center;padding:6px 10px;background:#1f1f1f;color:#fff;border:2px solid #fff;border-radius:8px;font:14px/1.4 system-ui,sans-serif;");
      stopButton.setAttribute("style", "min-height:32px;min-width:44px;padding:2px 10px;font:inherit;color:#fff;background:transparent;border:2px solid #fff;border-radius:6px;cursor:pointer;");
      s.append(doc.body, badge);
      s.listen(stopButton, "click", () => stop("Stopped listening."));
      const rec = new Recognition();
      rec.continuous = true;
      rec.interimResults = false;
      rec.lang = c.lang || doc.documentElement.lang || win.navigator && win.navigator.language || "en-US";
      let errors = 0;
      let restart = 0;
      function stop(message) {
        if (!handle.listening && badge.hidden) return;
        handle.listening = false;
        win.clearTimeout(restart);
        try {
          rec.abort();
        } catch {
        }
        badge.hidden = true;
        if (message) say2(message);
      }
      handle.stop = () => stop("Stopped listening.");
      rec.onresult = (e) => {
        const result = e.results[e.results.length - 1];
        if (!result || !result.isFinal) return;
        errors = 0;
        const heard = String(result[0].transcript || "").toLowerCase().replace(/[.,!?]/g, "").trim();
        for (const cmd of commands) {
          const m = cmd.re ? cmd.re.exec(heard) : heard === cmd.p ? [heard] : null;
          if (!m) continue;
          try {
            cmd.fn(m[1], heard);
          } catch {
          }
          return;
        }
        if (typeof c.onUnknown === "function") c.onUnknown(heard);
        else say2(`No command "${heard}".`);
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          stop("Voice commands are off: this site may not use the microphone.");
          return;
        }
        if (e.error === "no-speech" || e.error === "aborted") return;
        errors++;
        if (errors >= c.maxErrors) stop("Voice commands stopped after repeated errors. Turn them on again to retry.");
      };
      rec.onend = () => {
        if (!handle.listening || !s.alive()) return;
        restart = win.setTimeout(() => {
          if (handle.listening && s.alive()) {
            try {
              rec.start();
            } catch {
            }
          }
        }, 250 + Math.min(errors, 5) * 500);
      };
      s.onEnd(() => stop());
      handle.listening = true;
      try {
        rec.start();
      } catch {
        stop("Voice commands could not start.");
        return handle;
      }
      say2("Listening for voice commands.");
      return handle;
    }
    return { say, listen };
  }

  // toolkit/blocks/media.js
  var PAUSE_DEFAULTS = { showControls: false };
  function mediaBlock(s, env) {
    const isMedia = (el) => !!el && (el.tagName === "VIDEO" || el.tagName === "AUDIO");
    const chosen = /* @__PURE__ */ new WeakMap();
    const paused = /* @__PURE__ */ new WeakMap();
    function pause(el, opts = {}) {
      if (!s.alive() || !isMedia(el)) return false;
      const c = resolveConfig(PAUSE_DEFAULTS, opts, env.personal, {});
      if (paused.has(el)) {
        if (c.showControls) s.setAttr(el, "controls", "");
        try {
          el.pause();
        } catch {
        }
        return paused.get(el).playing;
      }
      const playing = !el.paused || el.autoplay && !(el.played && el.played.length) && !el.currentTime;
      let personTouched = false;
      const CONTROL2 = 'button, [role="button"], input[type="button"], input[type="submit"], summary';
      const mark = () => {
        const last = env.shared.lastInput;
        const onControl = last && Date.now() - last.at < 1500 && last.target && last.target.closest && last.target.closest(CONTROL2);
        if (s.watch.byPerson(el, { withinMs: 1500 }) || onControl) personTouched = true;
      };
      s.setAttr(el, "autoplay", null);
      if (c.showControls) s.setAttr(el, "controls", "");
      try {
        el.pause();
      } catch {
      }
      paused.set(el, { playing });
      s.onEnd(() => paused.delete(el));
      s.listen(el, "play", mark);
      s.listen(el, "pause", mark);
      s.onEnd(() => {
        if (!playing || personTouched || !el.paused || !el.isConnected) return;
        const p = el.play();
        if (p && typeof p.catch === "function") p.catch(() => {
        });
      });
      return playing;
    }
    function pauseAll(root = env.doc, opts = {}) {
      let n = 0;
      for (const el of root.querySelectorAll("video, audio")) if (pause(el, opts)) n++;
      return n;
    }
    function mute(el) {
      if (!s.alive() || !isMedia(el) || el.muted) return false;
      let personTouched = false;
      el.muted = true;
      s.listen(el, "volumechange", () => {
        if (!el.muted && s.watch.byPerson(el, { withinMs: 1500 })) personTouched = true;
      });
      s.onEnd(() => {
        if (!personTouched && el.muted) el.muted = false;
      });
      return true;
    }
    function captions(video, { lang } = {}) {
      if (!s.alive() || !video || !video.textTracks) return null;
      const want = String(lang || env.personal.language || env.doc.documentElement.lang || env.win.navigator && env.win.navigator.language || "").toLowerCase().split("-")[0];
      const tracks = [...video.textTracks].filter((t) => t.kind === "captions" || t.kind === "subtitles");
      if (!tracks.length) return null;
      const inLang = want && tracks.find((t) => (t.language || "").toLowerCase().split("-")[0] === want);
      const showing = tracks.find((t) => t.mode === "showing");
      const ours = chosen.get(video);
      if (showing && !(ours && ours.track === showing && inLang && inLang !== showing)) return showing;
      const choice = inLang || tracks.find((t) => t.kind === "captions") || tracks[0];
      if (ours) {
        ours.track.mode = "disabled";
        ours.track = choice;
        choice.mode = "showing";
        return choice;
      }
      const before = tracks.map((t) => [t, t.mode]);
      const rec = { track: choice };
      chosen.set(video, rec);
      choice.mode = "showing";
      s.onEnd(() => {
        chosen.delete(video);
        if (rec.track.mode !== "showing") return;
        rec.track.mode = "disabled";
        for (const [t, mode] of before) t.mode = mode;
      });
      return choice;
    }
    return { pause, pauseAll, mute, captions };
  }

  // toolkit/blocks/personal-sites.js
  var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  var PERSONAL_KEYS = Object.freeze({
    speechRate: "Speaking rate, 0.5-2. speech.say({ speechRate }) uses the profile's over yours.",
    fontScale: "Text size in percent, 100-200. Tooltips and panels scale their text by it (their `fontScale`).",
    textSizeMethod: "'zoom' (the browser's zoom) or 'font' (the text size only): how the person wants text made bigger. Unset: your default.",
    lineHeight: "Line spacing, 1-3 (times the font size).",
    letterSpacing: "Letter spacing in em, 0-0.5.",
    targetSize: "Smallest size of a clickable control, in CSS pixels, 24-64.",
    motionReducer: "true when the profile asks for reduced motion. Bands and scrolling stop animating, as with the system setting.",
    contrastMode: "'light' or 'yellow-black' when the profile asks for more contrast; 'none' when the person turned it off.",
    darkMode: "true when the profile asks for a dark theme.",
    readingLevel: "'plain', 'easy-read' or a grade 1-12 (the profile's reading level, or plain language). ai.text({ readingLevel }) uses the profile's over yours."
  });
  var SETTABLE_KEYS = Object.freeze(["speechRate", "fontScale", "textSizeMethod", "lineHeight", "letterSpacing", "targetSize", "motionReducer", "contrastMode", "darkMode"]);
  function personalFromSettings(settings, { keepOff = false } = {}) {
    const s = settings || {};
    const out = {};
    if (s.speechRate !== void 0 && s.speechRate !== null && Number.isFinite(Number(s.speechRate))) out.speechRate = clamp(Number(s.speechRate), 0.5, 2);
    if (s.fontScale !== void 0 && s.fontScale !== null && Number.isFinite(Number(s.fontScale))) out.fontScale = clamp(Math.round(Number(s.fontScale)), 100, 200);
    if (s.textSizeMethod === "zoom" || s.textSizeMethod === "font") out.textSizeMethod = s.textSizeMethod;
    const num = (k, lo, hi, round) => {
      if (s[k] === void 0 || s[k] === null || !Number.isFinite(Number(s[k]))) return;
      const v = clamp(Number(s[k]), lo, hi);
      out[k] = round ? Math.round(v) : Math.round(v * 100) / 100;
    };
    num("lineHeight", 1, 3);
    num("letterSpacing", 0, 0.5);
    num("targetSize", 24, 64, true);
    for (const k of ["motionReducer", "darkMode"]) {
      if (s[k] === true) out[k] = true;
      else if (keepOff && s[k] === false) out[k] = false;
    }
    if (typeof s.contrastMode === "string") {
      if (s.contrastMode !== "none") out.contrastMode = s.contrastMode;
      else if (keepOff) out.contrastMode = "none";
    }
    return out;
  }
  function siteOf(hostOrUrl) {
    let host = String(hostOrUrl || "");
    try {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) host = new URL(host).hostname;
    } catch {
    }
    return host.toLowerCase().replace(/^www\./, "");
  }
  function personalForSite(personal, explicit, host) {
    const site = siteOf(host);
    return { ...personal || {}, ...explicit?.general || {}, ...site && explicit?.sites?.[site] || {} };
  }

  // toolkit/blocks/profile.js
  var PERSON_MS = 5e3;
  function profileBlock(s, env) {
    const { shared } = env;
    if (!shared.personalListeners) shared.personalListeners = /* @__PURE__ */ new Set();
    function get(key) {
      const p = env.personal;
      return key === void 0 ? p : p[key];
    }
    function byPerson() {
      const now = Date.now();
      const last = shared.lastInput;
      if (last && now - last.at <= PERSON_MS && isOurs(last.target)) return true;
      return !!shared.lastShortcut && now - shared.lastShortcut <= PERSON_MS;
    }
    async function set(changes, { scope = "site" } = {}) {
      if (!s.alive()) return { applied: false, saved: false, reason: "ended" };
      const wanted = Object.fromEntries(Object.entries(changes || {}).filter(([k]) => SETTABLE_KEYS.includes(k)));
      const clean = personalFromSettings(wanted, { keepOff: true });
      if (!Object.keys(clean).length) return { applied: false, saved: false, reason: "nothing-settable" };
      if (!byPerson()) return { applied: false, saved: false, reason: "not-by-person" };
      shared.personalOverrides = { ...shared.personalOverrides || {}, ...clean };
      const now = env.personal;
      for (const fn of [...shared.personalListeners]) {
        try {
          fn(now, clean);
        } catch {
        }
      }
      if (!env.transport.profile) return { applied: true, saved: false, reason: "unavailable" };
      try {
        const r = await env.transport.profile({ op: "set", changes: clean, scope: scope === "all" ? "all" : "site" });
        return { applied: true, saved: !!(r && r.saved), ...r && r.reason ? { reason: r.reason } : {} };
      } catch {
        return { applied: true, saved: false, reason: "unavailable" };
      }
    }
    function onChange(fn) {
      if (!s.alive() || typeof fn !== "function") return () => {
      };
      const h = (p, changed) => {
        if (s.alive()) fn(p, changed);
      };
      shared.personalListeners.add(h);
      const stop = () => shared.personalListeners.delete(h);
      s.onEnd(stop);
      return stop;
    }
    return { get, set, onChange, keys: SETTABLE_KEYS };
  }

  // toolkit/blocks/zoom.js
  var clamp2 = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function zoomBlock(s, env) {
    const t = env.transport.zoom;
    let mine = false;
    const restore = () => {
      Promise.resolve(t({ op: "restore" })).catch(() => {
      });
    };
    async function set(factor) {
      const f = Number(factor);
      if (!t || !s.alive() || !Number.isFinite(f)) return false;
      const r = await Promise.resolve(t({ op: "set", factor: clamp2(f, 0.25, 5) })).catch(() => null);
      if (!r || !r.ok) return false;
      if (!s.alive()) {
        restore();
        return false;
      }
      if (!mine) {
        mine = true;
        s.onEnd(restore);
      }
      return true;
    }
    async function get() {
      if (!t) return null;
      const r = await Promise.resolve(t({ op: "get" })).catch(() => null);
      return r && Number.isFinite(r.factor) ? r.factor : null;
    }
    function method(builderDefault = "zoom") {
      const p = env.personal.textSizeMethod;
      const m = p === "zoom" || p === "font" ? p : builderDefault === "font" ? "font" : "zoom";
      return m === "zoom" && !t ? "font" : m;
    }
    return { supported: !!t, set, get, method };
  }

  // toolkit/blocks/session.js
  var Ended = class extends Error {
    constructor() {
      super("The session ended.");
      this.name = "Ended";
    }
  };
  function createSession(env, config = {}) {
    const always = config.restore === "always";
    const undo = [];
    const timers = /* @__PURE__ */ new Set();
    let open = true;
    const { shared } = env;
    const id = `${slug(env.adapter)}-${shared.nextId++}`;
    const restoreAttr = (el, name, value, index) => {
      const later = [...el.attributes].slice(index).filter((a) => a.name !== name).map((a) => [a.name, a.value]);
      for (const [n] of later) el.removeAttribute(n);
      el.setAttribute(name, value);
      for (const [n, v] of later) el.setAttribute(n, v);
    };
    const written = /* @__PURE__ */ new WeakMap();
    const recordOf = (el, key) => {
      const m = written.get(el);
      return m && m.get(key);
    };
    const keep = (el, key, rec) => {
      let m = written.get(el);
      if (!m) written.set(el, m = /* @__PURE__ */ new Map());
      m.set(key, rec);
    };
    const noteAttr = (el, name, value) => {
      let m = shared.ourAttrs.get(el);
      if (!m) shared.ourAttrs.set(el, m = /* @__PURE__ */ new Map());
      m.set(name, value);
    };
    const s = {
      id,
      get ended() {
        return !open;
      },
      alive: () => open,
      get personal() {
        return env.personal;
      },
      /** Run fn on end(), in reverse order with the rest. */
      onEnd(fn) {
        if (open) undo.push(fn);
      },
      setAttr(el, name, value) {
        if (!open || !el) return;
        const next = value === null || value === void 0 || value === false ? null : String(value);
        const rec = recordOf(el, "a:" + name);
        if (rec && el.getAttribute(name) === rec.next) {
          if (next === null) el.removeAttribute(name);
          else el.setAttribute(name, next);
          rec.next = next;
          noteAttr(el, name, next);
          return;
        }
        const had = el.hasAttribute(name);
        const before = el.getAttribute(name);
        const index = [...el.attributes].findIndex((a) => a.name === name);
        if (next === null) el.removeAttribute(name);
        else el.setAttribute(name, next);
        noteAttr(el, name, next);
        const r = { next };
        keep(el, "a:" + name, r);
        undo.push(() => {
          if (!always && el.getAttribute(name) !== r.next) return;
          if (!had) el.removeAttribute(name);
          else if (el.hasAttribute(name)) el.setAttribute(name, before);
          else restoreAttr(el, name, before, index);
          noteAttr(el, name, had ? before : null);
        });
      },
      setStyle(el, prop, value, priority = "") {
        if (!open || !el || !el.style) return;
        const p = cssName(prop);
        const rec = recordOf(el, "s:" + p);
        if (rec && el.style.getPropertyValue(p) === rec.set) {
          el.style.setProperty(p, value, priority);
          rec.set = el.style.getPropertyValue(p);
          noteAttr(el, "style", el.getAttribute("style"));
          return;
        }
        const hadAttr = el.hasAttribute("style");
        const beforeAttr = el.getAttribute("style");
        const before = el.style.getPropertyValue(p);
        const beforePriority = el.style.getPropertyPriority(p);
        el.style.setProperty(p, value, priority);
        const r = { set: el.style.getPropertyValue(p) };
        keep(el, "s:" + p, r);
        noteAttr(el, "style", el.getAttribute("style"));
        undo.push(() => {
          if (!always && el.style.getPropertyValue(p) !== r.set) return;
          if (before) el.style.setProperty(p, before, beforePriority);
          else el.style.removeProperty(p);
          if (!hadAttr && !el.getAttribute("style")) el.removeAttribute("style");
          else if (hadAttr) {
            const probe = env.doc.createElement("div");
            probe.setAttribute("style", beforeAttr);
            if (probe.style.cssText === el.style.cssText) el.setAttribute("style", beforeAttr);
          }
          noteAttr(el, "style", el.getAttribute("style"));
        });
      },
      addClass(el, ...names) {
        if (!open || !el) return;
        for (const name of names) {
          if (!name || el.classList.contains(name)) continue;
          el.classList.add(name);
          noteAttr(el, "class", el.getAttribute("class"));
          undo.push(() => {
            el.classList.remove(name);
            if (!el.getAttribute("class")) el.removeAttribute("class");
          });
        }
      },
      /** Put `node` into `parent` before `before` (or last); it goes on end(). */
      insert(parent, node, before = null) {
        if (!open || !parent || !node) return node;
        parent.insertBefore(node, before && before.parentNode === parent ? before : null);
        shared.ourNodes.add(node);
        undo.push(() => {
          if (node.parentNode) node.parentNode.removeChild(node);
        });
        return node;
      },
      append(parent, node) {
        return s.insert(parent, node, null);
      },
      /** Swap a page node for a new one; the same old node comes back on end(). */
      replace(oldNode, newNode) {
        if (!open || !oldNode || !oldNode.parentNode) return newNode;
        oldNode.parentNode.replaceChild(newNode, oldNode);
        shared.ourNodes.add(newNode);
        undo.push(() => {
          if (newNode.parentNode) newNode.parentNode.replaceChild(oldNode, newNode);
        });
        return newNode;
      },
      /** Take a node out of the page; it goes back where it was on end(). */
      remove(node) {
        if (!open || !node || !node.parentNode) return;
        const parent = node.parentNode;
        const next = node.nextSibling;
        parent.removeChild(node);
        undo.push(() => {
          if (node.parentNode) return;
          parent.insertBefore(node, next && next.parentNode === parent ? next : null);
        });
      },
      /** Change a text node's text; the original comes back unless the page changed it since. */
      setText(node, text) {
        if (!open || !node) return;
        const before = node.nodeValue;
        const next = String(text);
        node.nodeValue = next;
        shared.ourText.set(node, next);
        undo.push(() => {
          if (always || node.nodeValue === next) node.nodeValue = before;
        });
      },
      listen(target, type, fn, options) {
        if (!open || !target) return () => {
        };
        const handler = (e) => {
          if (open) fn(e);
        };
        target.addEventListener(type, handler, options);
        const capture = typeof options === "boolean" ? options : !!(options && options.capture);
        const off = () => target.removeEventListener(type, handler, capture);
        undo.push(off);
        return off;
      },
      // Each returns a function that cancels it. Timers are kept apart from
      // the undo list, so one that fired or was cancelled is not kept.
      timer(fn, ms = 0) {
        if (!open) return () => {
        };
        const t = env.win.setTimeout(() => {
          timers.delete(cancel);
          if (open) fn();
        }, ms);
        const cancel = () => {
          env.win.clearTimeout(t);
          timers.delete(cancel);
        };
        timers.add(cancel);
        return cancel;
      },
      every(fn, ms) {
        if (!open) return () => {
        };
        const t = env.win.setInterval(() => {
          if (open) fn();
        }, ms);
        const cancel = () => {
          env.win.clearInterval(t);
          timers.delete(cancel);
        };
        timers.add(cancel);
        return cancel;
      },
      frame(fn) {
        if (!open) return () => {
        };
        let live = true;
        const raf = env.win.requestAnimationFrame ? env.win.requestAnimationFrame.bind(env.win) : (f) => env.win.setTimeout(f, 16);
        const cancel = () => {
          live = false;
          timers.delete(cancel);
        };
        timers.add(cancel);
        raf(() => {
          timers.delete(cancel);
          if (open && live) fn();
        });
        return cancel;
      },
      /** Await a promise of your own; throws Ended if the session ended meanwhile. */
      guard(promise) {
        return Promise.resolve(promise).then(
          (v) => {
            if (!open) throw new Ended();
            return v;
          },
          (e) => {
            if (!open) throw new Ended();
            throw e;
          }
        );
      },
      /** A new element marked as the toolkit's own UI (not yet in the page). */
      el(tag, { text, attrs, kind = "ui" } = {}) {
        const node = env.doc.createElement(tag);
        node.setAttribute(UI_ATTR, kind);
        if (text !== void 0) node.textContent = String(text);
        for (const [k, v] of Object.entries(attrs || {})) if (v !== void 0 && v !== null && v !== false) node.setAttribute(k, v === true ? "" : String(v));
        return node;
      },
      announce: (message, options) => {
        if (open) {
          shared.liveUsers.add(s);
          env.announce(message, options);
        }
      },
      /** A session inside this one: its end() undoes only its own changes; it ends with this one. */
      group(options = {}) {
        const child = createSession(env, { ...config, ...options });
        if (open) undo.push(() => child.end());
        else child.end();
        return child;
      },
      /** Undo everything, in reverse. Idempotent; never throws. */
      end() {
        if (!open) return false;
        open = false;
        for (const cancel of [...timers]) cancel();
        for (let i = undo.length - 1; i >= 0; i--) {
          try {
            undo[i]();
          } catch {
          }
        }
        undo.length = 0;
        shared.liveUsers.delete(s);
        if (!shared.liveUsers.size) env.announce.release();
        return true;
      }
    };
    s.announce.batch = (key, message, options) => {
      if (open) {
        shared.liveUsers.add(s);
        env.announce.batch(key, message, options);
      }
    };
    s.announce.ready = () => {
      if (open) {
        shared.liveUsers.add(s);
        env.announce.ready();
      }
    };
    const styles = stylesBlock(s, env);
    s.css = styles.css;
    s.filter = styles.filter;
    s.watch = watchBlock(s, env);
    s.highlight = highlightBlock(s, env);
    s.targets = targetsBlock(s, env);
    s.tooltip = tooltipBlock(s, env);
    s.panel = panelBlock(s, env);
    s.focus = focusBlock(s, env);
    s.keys = keysBlock(s, env);
    s.text = textBlock(s, env);
    s.ai = aiBlock(s, env);
    s.speech = speechBlock(s, env);
    s.media = mediaBlock(s, env);
    s.profile = profileBlock(s, env);
    s.zoom = zoomBlock(s, env);
    s.page = Object.freeze({ ...env.page, findMain: findMainBlock(s, env) });
    return s;
  }

  // toolkit/blocks/announce.js
  var SETTLE_MS = 250;
  var SR_ONLY = "position:absolute!important;width:1px!important;height:1px!important;margin:-1px!important;padding:0!important;border:0!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;clip-path:inset(50%)!important;white-space:nowrap!important;";
  function announcer(env) {
    const { doc, win, shared } = env;
    const batches = /* @__PURE__ */ new Map();
    let batchTimer = null;
    const born = shared.liveBorn || (shared.liveBorn = /* @__PURE__ */ new WeakMap());
    function region(politeness) {
      let r = shared.liveRegions[politeness];
      if (r && r.isConnected) return r;
      r = doc.createElement("div");
      r.setAttribute(UI_ATTR, "ui");
      r.setAttribute("aria-live", politeness);
      r.setAttribute("aria-atomic", "true");
      r.setAttribute("style", SR_ONLY);
      shared.ourNodes.add(r);
      (doc.body || doc.documentElement).appendChild(r);
      shared.liveRegions[politeness] = r;
      born.set(r, Date.now());
      return r;
    }
    const pending = shared.livePending || (shared.livePending = {});
    function announce(message, { politeness = "polite", maxChars = 300 } = {}) {
      const text = String(message ?? "").replace(/\s+/g, " ").trim().slice(0, maxChars);
      if (!text) return;
      const p = politeness === "assertive" ? "assertive" : "polite";
      const el = region(p);
      if (pending[p]) {
        pending[p].text += " " + text;
        return;
      }
      el.textContent = "";
      pending[p] = { text };
      const age = Date.now() - (born.get(el) || 0);
      win.setTimeout(() => {
        const entry = pending[p];
        delete pending[p];
        if (entry && el.isConnected) el.textContent = entry.text;
      }, Math.max(60, SETTLE_MS - age));
    }
    announce.ready = () => {
      region("polite");
      region("assertive");
    };
    announce.batch = (key, message, { windowMs = 400, politeness = "polite" } = {}) => {
      batches.set(key, { message, politeness });
      if (batchTimer) return;
      batchTimer = win.setTimeout(() => {
        batchTimer = null;
        const list = [...batches.values()];
        batches.clear();
        const assertive = list.some((b) => b.politeness === "assertive");
        announce(list.map((b) => b.message).join(" "), { politeness: assertive ? "assertive" : "polite" });
      }, windowMs);
    };
    announce.release = () => {
      for (const [k, el] of Object.entries(shared.liveRegions)) {
        el.remove();
        delete shared.liveRegions[k];
      }
      for (const k of Object.keys(pending)) delete pending[k];
      win.clearTimeout(batchTimer);
      batchTimer = null;
      batches.clear();
    };
    return announce;
  }

  // toolkit/blocks/names.js
  var BLOCKS_VERSION = "2026-11-04.3";
  var BLOCK_NAMES = Object.freeze(["session", "styles", "watch", "page", "highlight", "targets", "announce", "tooltip", "panel", "focus", "text", "ai.text", "ai.vision", "ai.choose", "speech.out", "speech.in", "media", "profile", "zoom"]);

  // toolkit/blocks/shortcut.js
  var SHORTCUT_DEFAULT = Object.freeze({ up: "Alt+Shift+ArrowUp", down: "Alt+Shift+ArrowDown" });
  var MODIFIER_CODES = /^(Alt|Shift|Control|Meta|OS)(Left|Right)?$/;
  function comboOf(e) {
    if (!e || !e.code || MODIFIER_CODES.test(e.code)) return "";
    return [e.ctrlKey && "Ctrl", e.metaKey && "Meta", e.altKey && "Alt", e.shiftKey && "Shift", e.code].filter(Boolean).join("+");
  }

  // toolkit/blocks/create.js
  var EMPTY = Object.freeze({});
  function setPersonal(win, personal, explicit) {
    const shared = sharedState(win);
    const before = shared.personalBase ? personalForSite(shared.personalBase, { general: shared.personalOverrides || {} }, "") : {};
    const base = Object.freeze(explicit ? personalForSite(personal, explicit, win.location && win.location.hostname) : { ...personal || {} });
    shared.personalBase = base;
    if (shared.personalOverrides) {
      const left = Object.fromEntries(Object.entries(shared.personalOverrides).filter(([k, v]) => base[k] !== v && !(base[k] === void 0 && (v === false || v === "none"))));
      shared.personalOverrides = Object.keys(left).length ? left : void 0;
    }
    const after = personalForSite(base, { general: shared.personalOverrides || {} }, "");
    const changed = {};
    for (const k of /* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)])) if (before[k] !== after[k]) changed[k] = after[k];
    if (Object.keys(changed).length && shared.personalListeners) {
      for (const fn of [...shared.personalListeners]) {
        try {
          fn(after, changed);
        } catch {
        }
      }
    }
  }
  function createBlocks({ win = globalThis, adapter = "adapter", key, personal, explicit = null, ai = null, capture, profile = null, zoom = null, speak = null, adjustable = null } = {}) {
    if (!win || !win.document) throw new Error("createBlocks needs a window with a document.");
    const shared = sharedState(win);
    const fn = (f) => typeof f === "function" ? f : null;
    const env = {
      win,
      doc: win.document,
      shared,
      adapter,
      key: String(key || adapter),
      transport: { ai: fn(ai), profile: fn(profile), zoom: fn(zoom), speak: fn(speak), adjustable: fn(adjustable) },
      capture: typeof capture === "function" ? capture : (el) => captureInPage(el, win)
    };
    if (personal !== void 0 || explicit) setPersonal(win, personal, explicit);
    let seenBase, seenOverrides, current = Object.freeze({});
    Object.defineProperty(env, "personal", {
      enumerable: true,
      get() {
        const b = shared.personalBase || EMPTY;
        const o = shared.personalOverrides;
        if (b !== seenBase || o !== seenOverrides) {
          seenBase = b;
          seenOverrides = o;
          current = Object.freeze(o ? personalForSite(b, { general: o }, "") : b);
        }
        return current;
      }
    });
    env.page = pageBlock(env);
    env.announce = announcer(env);
    watchInput(env);
    return Object.freeze({
      session: (config) => createSession(env, config),
      page: env.page,
      get personal() {
        return env.personal;
      },
      blocks: BLOCK_NAMES,
      version: BLOCKS_VERSION
    });
  }
  function setShortcut(win, shortcut, { name, toggle } = {}) {
    const shared = sharedState(win);
    shared.shortcut = shortcut && shortcut.adapter ? { ...shortcut, name: String(name || shortcut.adapter.split("/").pop()), toggle } : null;
    if (shared.shortcutListening) return;
    shared.shortcutListening = true;
    let speaker = null;
    win.document.addEventListener("keydown", (e) => {
      const sc = shared.shortcut;
      if (!sc || e.isComposing || e.ctrlKey || e.metaKey) return;
      const combo = comboOf(e);
      const which = combo === sc.up ? "up" : combo === sc.down ? "down" : null;
      if (!which || editable(e.target)) return;
      const a = shared.adjusters.get(sc.adapter);
      if (a && a.session.alive()) {
        e.preventDefault();
        if (e.isTrusted) shared.lastShortcut = Date.now();
        try {
          a[which](e);
        } catch {
        }
        return;
      }
      if (which !== "up" || e.repeat || typeof sc.toggle !== "function") return;
      e.preventDefault();
      Promise.resolve(sc.toggle(sc.adapter)).then((state) => {
        if (state !== "on" && state !== "off") return;
        speaker ||= createBlocks({ win, adapter: "toolkit" }).session();
        speaker.announce(`${sc.name} ${state} on this site.`);
      }, () => {
      });
    }, true);
  }

  // toolkit/blocks/runtime.js
  if (!globalThis.__ai4a11yBlocks) {
    Object.defineProperty(globalThis, "__ai4a11yBlocks", {
      configurable: true,
      value: Object.freeze({
        version: BLOCKS_VERSION,
        create: (options) => createBlocks({ ...options, win: globalThis }),
        setPersonal: (personal, explicit) => setPersonal(globalThis, personal, explicit),
        setShortcut: (shortcut, host) => setShortcut(globalThis, shortcut, host)
      })
    });
  }
})();
