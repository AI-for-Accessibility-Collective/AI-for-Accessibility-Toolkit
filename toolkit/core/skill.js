// Skill — a SKILL.md accessibility playbook that orchestrates adapters.
//
// This is the layer the diagrams call "skills" and the Engineer builds: a
// model-facing SKILL.md (name + description + instructions) that names WHICH
// adapters to apply, with WHAT settings, for a given need and page. Adapters
// are the executable code (tools/adapters/, the extension's built-in tools);
// a skill composes them into a recipe.
//
// A skill is BOTH:
//   - model-facing — the markdown body is instructions an agent reads
//     (progressive disclosure: name+description first, full body on demand);
//   - machine-runnable — a fenced JSON recipe block compiles deterministically
//     to the same settings object the adapter apply-path already consumes, so
//     applying a skill needs no LLM at apply-time.
//
// Pure and dependency-free (no YAML lib, no DOM): frontmatter is simple
// `key: value` lines; the recipe is a ```json fenced block. Parsed/validated/
// resolved here; authored as .md files in toolkit/skills/builtin/.

/**
 * @typedef {Object} SkillRecipeStep
 * @property {string} id           - adapter id (must exist in the tools registry)
 * @property {Object} [settings]   - settings to apply for that adapter
 *
 * @typedef {Object} Skill
 * @property {string} name
 * @property {string} description  - when to use it (what the model matches on)
 * @property {string[]} supportAreas
 * @property {string[]} siteRelevance
 * @property {{ adapters: SkillRecipeStep[] }} recipe
 * @property {string} body         - full markdown (instructions), sans frontmatter
 */

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

// Parse a tiny YAML subset: `key: value`, where value is a plain string or an
// inline list `[a, b, c]`. Enough for name/description/supportAreas/siteRelevance.
function parseFrontmatter(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else {
      val = val.replace(/^["']|["']$/g, '');
    }
    out[key] = val;
  }
  return out;
}

// Extract the first ```json fenced block (the machine-runnable recipe).
function extractRecipe(body) {
  const m = body.match(/```json\s*([\s\S]*?)```/);
  if (!m) return { adapters: [] };
  try {
    const parsed = JSON.parse(m[1]);
    return { adapters: Array.isArray(parsed.adapters) ? parsed.adapters : [] };
  } catch {
    return { adapters: [] };
  }
}

/**
 * Parse a SKILL.md string into a Skill object. Tolerant: missing pieces come
 * back empty rather than throwing, so a half-formed LLM output still parses
 * (validateSkill catches the problems).
 * @param {string} markdown
 * @returns {Skill}
 */
export function parseSkill(markdown) {
  // Normalize line endings and tolerate preamble the LLM may add before the
  // frontmatter (e.g. "Here's your skill:\n\n---\n..."): drop everything up to
  // the frontmatter opener. Anchor on a `---` that is *immediately followed by
  // a `key: value` line*, not just any bare `---` — otherwise a stray markdown
  // horizontal rule in the preamble gets mistaken for the opener and swallows
  // the real frontmatter into the body.
  let src = String(markdown || '').replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const fmStart = lines.findIndex((l, i) => l.trim() === '---' && /^\s*[a-zA-Z][\w-]*\s*:/.test(lines[i + 1] || ''));
  if (fmStart > 0) src = lines.slice(fmStart).join('\n');
  const fm = src.match(FRONTMATTER_RE);
  const front = fm ? parseFrontmatter(fm[1]) : {};
  const body = fm ? fm[2].trim() : src.trim();
  const asArray = (v) => Array.isArray(v) ? v : (v ? [v] : []);
  return {
    name: front.name || '',
    description: front.description || '',
    supportAreas: asArray(front.supportAreas),
    siteRelevance: asArray(front.siteRelevance),
    recipe: extractRecipe(body),
    body,
  };
}

/**
 * Serialize a Skill back to SKILL.md text (round-trips with parseSkill for the
 * structured fields). Used by the Engineer to persist a built skill.
 * @param {Skill} skill
 * @returns {string}
 */
export function serializeSkill(skill) {
  const list = (a) => `[${(a || []).join(', ')}]`;
  const front = [
    '---',
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    `supportAreas: ${list(skill.supportAreas)}`,
    `siteRelevance: ${list(skill.siteRelevance)}`,
    '---',
  ].join('\n');
  // If the body already carries a recipe block, trust it; otherwise append one.
  let body = skill.body || '';
  if (!/```json/.test(body)) {
    body = `${body}\n\n## Recipe\n\`\`\`json\n${JSON.stringify(skill.recipe || { adapters: [] }, null, 2)}\n\`\`\`\n`;
  }
  return `${front}\n\n${body.trim()}\n`;
}

/**
 * Validate a skill against the tools registry (AA_TOOLS): the name/description
 * exist, every recipe adapter id is a real tool, and every settings key is in
 * the settings vocabulary. Returns collected errors (empty = valid).
 * @param {Skill} skill
 * @param {{ tools: any }} deps  - tools = the AA_TOOLS registry (byId + settingsMeta)
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSkill(skill, { tools } = {}) {
  const errors = [];
  if (!skill.name) errors.push('missing name');
  if (!skill.description) errors.push('missing description');
  const steps = skill.recipe?.adapters || [];
  if (steps.length === 0) errors.push('recipe has no adapters');
  const meta = tools?.settingsMeta || {};
  for (const step of steps) {
    if (!step || typeof step.id !== 'string') { errors.push('recipe step missing adapter id'); continue; }
    if (tools?.byId && !tools.byId(step.id)) errors.push(`unknown adapter "${step.id}"`);
    for (const [key, val] of Object.entries(step.settings || {})) {
      const m = meta[key];
      if (Object.keys(meta).length && !m) { errors.push(`unknown setting "${key}" in adapter "${step.id}"`); continue; }
      if (!m) continue;
      // Value must match the setting's declared type and range/options —
      // an LLM-authored recipe can name a real key with a bad value.
      if (m.type === 'number') {
        if (typeof val !== 'number' || Number.isNaN(val)) errors.push(`setting "${key}" must be a number`);
        else if (Array.isArray(m.range) && (val < m.range[0] || val > m.range[1])) errors.push(`setting "${key}"=${val} out of range ${m.range[0]}–${m.range[1]}`);
      } else if (m.type === 'boolean' && typeof val !== 'boolean') {
        errors.push(`setting "${key}" must be true or false`);
      } else if (m.type === 'enum' && Array.isArray(m.options) && !m.options.includes(val)) {
        errors.push(`setting "${key}"="${val}" not one of ${m.options.join(', ')}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Compile a skill's recipe to the deterministic apply-plan: the merged
 * settings object (same shape the extension's applyVisualSettings consumes)
 * plus the ordered adapter ids. This is the bridge skill → adapters, no LLM.
 * Later steps win on key conflicts (author-ordered).
 * @param {Skill} skill
 * @returns {{ settings: Object, adapterIds: string[] }}
 */
export function resolveSkill(skill) {
  const settings = {};
  const adapterIds = [];
  for (const step of (skill.recipe?.adapters || [])) {
    if (!step?.id) continue;
    adapterIds.push(step.id);
    Object.assign(settings, step.settings || {});
  }
  return { settings, adapterIds };
}

/**
 * Score how well a skill fits a person + page (for Librarian retrieval).
 * Deterministic: overlap of supportAreas with the profile, plus a site match.
 * 0 = irrelevant. Higher = better fit.
 * @param {Skill} skill
 * @param {{ supportAreas?: string[], category?: string|null }} ctx
 * @returns {number}
 */
export function matchSkill(skill, { supportAreas = [], category = null } = {}) {
  let score = 0;
  const areas = new Set(supportAreas);
  for (const a of (skill.supportAreas || [])) if (areas.has(a)) score += 2;
  const rel = skill.siteRelevance || [];
  if (category && rel.includes(category)) score += 3;
  if (rel.includes('all')) score += 1;
  return score;
}

// Words too generic to signal WHICH skill a need is about. Post-singular form
// ('site' also covers 'sites'); words of 1-2 letters are dropped by length.
const GENERIC_WORDS = new Set([
  'the', 'and', 'for', 'with', 'when', 'that', 'this', 'them', 'they', 'have',
  'from', 'make', 'making', 'want', 'need', 'please', 'help', 'like', 'can',
  'could', 'would', 'site', 'page', 'website', 'web', 'get', 'turn', 'use',
  'using', 'more', 'some', 'all', 'every', 'thing',
]);

function needTokens(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/)
    .map(w => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) ? w.slice(0, -1) : w)
    .filter(w => w.length > 2 && !GENERIC_WORDS.has(w));
}

// Same word, or one is a prefix of the other ("read" ~ "reading") — enough
// stemming for needs phrased in plain language, without a stemmer dependency.
function tokenLike(a, b) {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short);
}

/**
 * Score how well a skill covers a plain-language NEED (the diagrams' "does
 * the skill exist in the db?" check, before the Engineer builds a new one).
 * Deterministic keyword overlap — each need word counts once, at the weight
 * of the best field it appears in. 0 = no meaningful overlap.
 * @param {Skill} skill
 * @param {string} need
 * @returns {number}
 */
export function matchSkillToNeed(skill, need) {
  const needToks = [...new Set(needTokens(need))];
  if (!needToks.length) return 0;
  const fields = [
    { toks: needTokens(skill.name), weight: 3 },
    { toks: needTokens((skill.supportAreas || []).join(' ')), weight: 2 },
    { toks: needTokens((skill.siteRelevance || []).join(' ')), weight: 2 },
    { toks: needTokens(skill.description), weight: 2 },
  ];
  let score = 0;
  for (const t of needToks) {
    let best = 0;
    for (const f of fields) {
      if (f.weight > best && f.toks.some(ft => tokenLike(t, ft))) best = f.weight;
    }
    score += best;
  }
  return score;
}
