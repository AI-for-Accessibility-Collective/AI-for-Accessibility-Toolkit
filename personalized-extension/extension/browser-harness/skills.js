/* Browser-harness skills (markdown knowledge files).
 *
 * Two registries, three layers:
 *   - interaction-skills: generic UI patterns (dialogs, scrolling, iframes ...)
 *   - domain-skills: per-host playbooks (amazon/cart, github/repo-actions ...)
 *
 *   bundled  — read-only files in BH_ORIG_PATH, indexed by skills-manifest.json
 *              (built at build time by build.js -- service workers can fetch
 *              individual files but can't list directories)
 *   custom   — agent-written content saved to chrome.storage.local.bhSkills,
 *              persists across runs. Overrides bundled when names collide.
 *
 * Loaded by background.js via importScripts. Page-side callers reach these
 * through the bh:* dispatcher in background.js (see client.js).
 */

// Single source of truth. Change here when the python files are stripped out
// and the directory is renamed. build.js mirrors these for the manifest step;
// keep both in sync if the layout shifts.
const BH_ORIG_PATH = 'browser-harness/browser-harness-orig';
const BH_INTERACTION_SUBPATH = 'interaction-skills';
const BH_DOMAIN_SUBPATH = 'agent-workspace/domain-skills';
const BH_MANIFEST_PATH = 'browser-harness/skills-manifest.json';
const BH_SKILLS_KEY = 'bhSkills';

let _bhManifestCache = null;
async function _bhManifest() {
  if (_bhManifestCache) return _bhManifestCache;
  try {
    const r = await fetch(chrome.runtime.getURL(BH_MANIFEST_PATH));
    if (!r.ok) throw new Error(`manifest fetch ${r.status}`);
    _bhManifestCache = await r.json();
  } catch (e) {
    console.warn('[BrowserSkills] manifest load failed:', e.message);
    _bhManifestCache = { interaction: [], domain: {} };
  }
  return _bhManifestCache;
}

async function _bhCustomSkills() {
  const data = await chrome.storage.local.get(BH_SKILLS_KEY);
  return data[BH_SKILLS_KEY] || { interaction: {}, domain: {} };
}

// Mirrors browser-harness-orig's host folder convention: "www.amazon.com" →
// "amazon", "github.com" → "github". Brittle for sites with single-name TLDs
// (e.g. "co.uk") but matches the existing playbook layout 1:1.
function bhNormalizeHost(hostname) {
  return (hostname || '').replace(/^www\./, '').split('.')[0].toLowerCase();
}

async function bhListInteractionSkills() {
  const m = await _bhManifest();
  const custom = (await _bhCustomSkills()).interaction || {};
  return [...new Set([...(m.interaction || []), ...Object.keys(custom)])].sort();
}

// Manifest entries are { dir: <on-disk dir name>, files: [<name>...] }. The
// key is the lowercased dir name so a normalized host ("boss-zhipin") finds
// the upstream "BOSS-zhipin" folder.
function _bhDomainEntry(manifest, host) {
  return manifest.domain && manifest.domain[host];
}

async function bhListDomainSkills(hostname) {
  const m = await _bhManifest();
  const host = bhNormalizeHost(hostname);
  if (!host) return [];
  const entry = _bhDomainEntry(m, host);
  const bundled = entry ? entry.files : [];
  const custom = ((await _bhCustomSkills()).domain || {})[host] || {};
  return [...new Set([...bundled, ...Object.keys(custom)])].sort();
}

async function bhReadSkill(kind, name, host = null) {
  const custom = await _bhCustomSkills();
  if (kind === 'domain') {
    if (!host) throw new Error('domain skill needs host');
    const h = bhNormalizeHost(host);
    if (custom.domain?.[h]?.[name]) return custom.domain[h][name];
    const m = await _bhManifest();
    const entry = _bhDomainEntry(m, h);
    // Fall back to the lowercased key as the directory if the manifest is
    // missing the entry — supports custom-only hosts that the build step
    // never indexed.
    const dir = entry ? entry.dir : h;
    const url = `${BH_ORIG_PATH}/${BH_DOMAIN_SUBPATH}/${dir}/${name}.md`;
    const r = await fetch(chrome.runtime.getURL(url));
    if (!r.ok) throw new Error(`skill not found: domain/${h}/${name}`);
    return await r.text();
  }
  if (custom.interaction?.[name]) return custom.interaction[name];
  const url = `${BH_ORIG_PATH}/${BH_INTERACTION_SUBPATH}/${name}.md`;
  const r = await fetch(chrome.runtime.getURL(url));
  if (!r.ok) throw new Error(`skill not found: interaction/${name}`);
  return await r.text();
}

async function bhWriteSkill(kind, name, content, host = null) {
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('skill content must be a non-empty string');
  }
  const cur = await chrome.storage.local.get(BH_SKILLS_KEY);
  const skills = cur[BH_SKILLS_KEY] || { interaction: {}, domain: {} };
  if (kind === 'domain') {
    if (!host) throw new Error('domain skill needs host');
    const h = bhNormalizeHost(host);
    skills.domain = skills.domain || {};
    skills.domain[h] = skills.domain[h] || {};
    skills.domain[h][name] = content;
  } else {
    skills.interaction = skills.interaction || {};
    skills.interaction[name] = content;
  }
  await chrome.storage.local.set({ [BH_SKILLS_KEY]: skills });
  return { kind, name, host: kind === 'domain' ? bhNormalizeHost(host) : null };
}

async function bhDeleteSkill(kind, name, host = null) {
  const cur = await chrome.storage.local.get(BH_SKILLS_KEY);
  const skills = cur[BH_SKILLS_KEY] || { interaction: {}, domain: {} };
  if (kind === 'domain') {
    const h = bhNormalizeHost(host);
    if (skills.domain?.[h]) delete skills.domain[h][name];
  } else if (skills.interaction) {
    delete skills.interaction[name];
  }
  await chrome.storage.local.set({ [BH_SKILLS_KEY]: skills });
}

globalThis.BrowserSkills = {
  listInteraction: bhListInteractionSkills,
  listDomain: bhListDomainSkills,
  read: bhReadSkill,
  write: bhWriteSkill,
  remove: bhDeleteSkill,
  normalizeHost: bhNormalizeHost,
};
