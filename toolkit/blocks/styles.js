// Block 2, styles: the adapter's stylesheets, and the one page filter every
// adapter shares.
//
// s.css(name, text, { scope }) adds one <style> per name (a second call with
// the same name replaces its text; s.css(name, null) takes it away) and, with `scope`, a class on <html> while
// the session is open, for the rules to hang from. s.filter(name, value) adds
// a CSS filter to the page's single filter chain: dark mode, dimming and
// colour filters compose instead of overwriting each other.

import { UI_ATTR } from './shared.js';

const FILTER_STYLE_ID = 'ai4a11y-filters';

export function stylesBlock(s, env) {
  const sheets = new Map();

  function css(name, text, { scope } = {}) {
    if (!s.alive()) return null;
    let el = sheets.get(name);
    if (text == null) {
      // Takes it away; the same name later makes a new one.
      if (el) { el.remove(); sheets.delete(name); }
      return null;
    }
    if (el && !el.isConnected) { sheets.delete(name); el = null; }
    if (!el) {
      el = env.doc.createElement('style');
      el.id = `ai4a11y-${s.id}-${String(name).replace(/[^\w-]/g, '-')}`;
      el.setAttribute(UI_ATTR, 'ui');
      sheets.set(name, el);
      s.append(env.doc.head || env.doc.documentElement, el);
      s.onEnd(() => sheets.delete(name));
    }
    el.textContent = String(text);
    if (scope) s.addClass(env.doc.documentElement, scope);
    return {
      el,
      update: (next) => { if (s.alive()) el.textContent = String(next); },
    };
  }

  function writeFilters() {
    const { filters } = env.shared;
    let el = env.doc.getElementById(FILTER_STYLE_ID);
    if (!filters.size) { if (el) el.remove(); return; }
    if (!el) {
      el = env.doc.createElement('style');
      el.id = FILTER_STYLE_ID;
      el.setAttribute(UI_ATTR, 'ui');
      env.shared.ourNodes.add(el);
      (env.doc.head || env.doc.documentElement).appendChild(el);
    }
    el.textContent = `html { filter: ${[...filters.values()].join(' ')} !important; }`;
  }

  function filter(name, value) {
    if (!s.alive()) return;
    const key = `${s.id}:${name}`;
    const had = env.shared.filters.has(key);
    if (value) env.shared.filters.set(key, String(value)); else env.shared.filters.delete(key);
    writeFilters();
    if (!had) s.onEnd(() => { env.shared.filters.delete(key); writeFilters(); });
  }

  return { css, filter };
}
