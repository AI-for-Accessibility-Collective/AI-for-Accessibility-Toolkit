// System-prompt assembly + per-host domain-skill discovery + the
// loaded-skills block that gets stitched into every prompt.

import {
  BH_AGENT_SYSTEM_PROMPT_BASE,
  BH_AGENT_SKILL_INLINE_MAX,
  BH_AGENT_LOADED_SKILLS_MAX,
} from './constants.js';
import {
  setNavSurface,
  getNavSurface,
  pushLoadedSkill,
  shiftLoadedSkill,
  getLoadedSkills,
  _bhAgentLog,
} from './state.js';

// Bake the interaction-skills index into the system prompt once at the
// start of the run -- the names don't change mid-run, so re-listing every
// turn just spends prompt budget for no information gain.
export async function _bhBuildSystemPrompt() {
  const Skills = globalThis.BrowserSkills;
  if (!Skills) return BH_AGENT_SYSTEM_PROMPT_BASE;
  const interaction = await Skills.listInteraction().catch(() => []);
  if (!interaction.length) return BH_AGENT_SYSTEM_PROMPT_BASE;
  return BH_AGENT_SYSTEM_PROMPT_BASE
    + '\n\nInteraction skills available (load any with read_skill kind="interaction"): '
    + interaction.join(', ') + '.';
}

export function _bhAgentHostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

// Consumes _bhAgentNavSurface exactly once. Mirrors browser-harness-orig's
// goto_url() return value: domain skills appear in the turn after navigation
// and aren't repeated. The model can re-navigate or use read_skill if it
// wants the names back later.
export async function _bhAgentConsumeNavSurface() {
  const surface = getNavSurface();
  setNavSurface(null);
  if (!surface) return '';
  if (!surface.skills || !surface.skills.length) {
    return `Just navigated to ${surface.host}. No domain skills indexed for this host.`;
  }
  return `Just navigated to ${surface.host}. Domain skills available (load with read_skill kind="domain", host="${surface.host}"): ${surface.skills.join(', ')}.`;
}

export function _bhAgentLoadedSkillsBlock() {
  const loaded = getLoadedSkills();
  if (!loaded.length) return '';
  const lines = ['### Loaded skill content'];
  for (const s of loaded) {
    const tag = s.kind === 'domain' ? `domain/${s.host}/${s.name}` : `interaction/${s.name}`;
    const body = s.content.length > BH_AGENT_SKILL_INLINE_MAX
      ? s.content.slice(0, BH_AGENT_SKILL_INLINE_MAX) + '\n...[truncated]'
      : s.content;
    lines.push(`#### ${tag}`);
    lines.push(body);
  }
  return lines.join('\n');
}

// Stage the next prompt's domain-skill discovery line. Called after
// successful navigate/open_tab so the surface fires once on the turn AFTER
// navigation (matching the python harness's goto_url() return behaviour).
export async function _bhAgentSurfaceForHost(host) {
  const Skills = globalThis.BrowserSkills;
  if (!Skills || !host) { setNavSurface(null); return; }
  const h = Skills.normalizeHost(host);
  const skills = await Skills.listDomain(h).catch(() => []);
  setNavSurface({ host: h, skills });
}

// Pre-load a list of domain skills for `host` into the per-run buffer.
// Used by navigate/open_tab when the model passes `read_skills: [...]`,
// so it doesn't have to spend extra turns calling read_skill afterwards.
export async function _bhAgentPreloadDomainSkills(host, names) {
  const Skills = globalThis.BrowserSkills;
  if (!Skills || !host || !Array.isArray(names) || !names.length) return;
  const h = Skills.normalizeHost(host);
  for (const name of names) {
    if (typeof name !== 'string' || !name) continue;
    try {
      const md = await Skills.read('domain', name, host);
      pushLoadedSkill({ kind: 'domain', name, host: h, content: md });
      await _bhAgentLog({ kind: 'info', text: `Pre-loaded domain skill ${name} (${h})` });
    } catch (e) {
      await _bhAgentLog({
        kind: 'error',
        text: `Pre-load skipped ${name} (${h}): ${e.message}`,
      });
    }
  }
  while (getLoadedSkills().length > BH_AGENT_LOADED_SKILLS_MAX) {
    shiftLoadedSkill();
  }
}
