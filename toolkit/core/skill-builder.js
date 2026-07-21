// The Engineer — the skill builder agent.
//
// Turns a person's plain-language need + their ability profile + the available
// adapter catalog into a real SKILL.md that composes adapters (the diagrams'
// "Skill builder agent"). The LLM is injected (same pattern as the Librarian's
// gemini caller); this module builds the prompt and parses the result. It does
// NOT generate executable code — it authors instructions that name adapters.

import { parseSkill, serializeSkill, validateSkill } from './skill.js';

/**
 * Build the prompt that instructs the LLM to author a SKILL.md composing the
 * available adapters for a stated need. Grounds the model in the real adapter
 * catalog + settings vocabulary so it can only reference things that exist.
 *
 * When the person tried a previous attempt and it wasn't right, pass it back
 * with their feedback (`previous` + `feedback`) — the diagrams' evaluation
 * loop where a failed validation returns to the skill builder agent.
 *
 * @param {string} need                 - the user's plain-language request
 * @param {Object} opts
 * @param {Object} [opts.profile]        - ability profile (supportAreas, freeText)
 * @param {Object} opts.tools            - AA_TOOLS registry (forPrompt + settingsVocabularyLines)
 * @param {Object} [opts.taxonomy]       - AA_TAXONOMY (categoryIds) for siteRelevance
 * @param {Object} [opts.previous]       - the prior built Skill the person rejected
 * @param {string} [opts.feedback]       - what the person said was wrong with it
 * @returns {string}
 */
export function buildSkillPrompt(need, { profile = {}, tools, taxonomy, previous = null, feedback = '' } = {}) {
  const adapters = tools.forPrompt().map(t =>
    `- ${t.id} — ${t.name}: ${t.description} (helps: ${t.supportAreas.join(', ')})`).join('\n');
  const settingsVocab = tools.settingsVocabularyLines().join('\n');
  const categories = taxonomy ? taxonomy.categoryIds().join(', ') : 'news, social, video, shopping, education, productivity, reference, other';
  const profileBlock = (profile.supportAreas?.length || profile.freeText)
    ? `\nAbout this person:\n- Support areas: ${(profile.supportAreas || []).join(', ') || 'unspecified'}`
      + (profile.freeText ? `\n- In their words: "${profile.freeText}"` : '')
    : '';
  const revisionBlock = (previous && feedback)
    ? `\n\nYou already built this skill for that need:\n\n${serializeSkill(previous)}\n\nThe person tried it and said: "${feedback}"\nRevise the skill to address their feedback. Keep the same name unless the feedback changes what the skill is about, and keep the parts that already worked.`
    : '';

  return `You are the Engineer — an accessibility skill builder. Author a SKILL.md that adapts web pages for the need below by composing EXISTING adapters. You do NOT write code; you write a playbook that names which adapters to apply and with what settings.

The need: "${need}"${profileBlock}${revisionBlock}

Available adapters (use only these ids):
${adapters}

Setting keys and their units/ranges (use only these; values must be in range):
${settingsVocab}

Site categories for siteRelevance: ${categories} (or "all").

Output a COMPLETE SKILL.md, nothing else, in exactly this shape:

---
name: <short-kebab-case-id>
description: <one sentence: what it does and WHEN to use it — this is what an agent matches on>
supportAreas: [<comma-separated from the adapters' "helps" areas>]
siteRelevance: [<comma-separated categories, or "all">]
---

# <Title>

<1-2 sentences: what this skill does for the person.>

## What it does
<numbered list: each adapter you apply and why, in plain language.>

## When to use
<when it helps and when to skip it.>

## Recipe
\`\`\`json
{
  "adapters": [
    { "id": "<adapter-id>", "settings": { "<key>": <value> } }
  ]
}
\`\`\`

Rules:
- Only reference adapter ids and setting keys listed above. Keep the recipe minimal — 1 to 4 adapters that directly serve the need.
- The "Recipe" JSON is the machine-runnable truth; make the prose match it.
- Prefer the narrowest siteRelevance the need implies; use "all" only for genuinely global needs.`;
}

/**
 * Parse the LLM's SKILL.md output into a validated Skill. Tolerant of code
 * fences the model wraps the whole doc in.
 *
 * @param {string} llmOutput
 * @param {{ tools: any }} deps
 * @returns {{ skill: import('./skill.js').Skill, valid: boolean, errors: string[] }}
 */
export function parseBuiltSkill(llmOutput, { tools } = {}) {
  let text = String(llmOutput || '').trim();
  // Strip an outer ```markdown / ``` wrapper if the model added one, without
  // touching the inner ```json recipe fence.
  const outer = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*)\n```$/);
  if (outer) text = outer[1].trim();
  const skill = parseSkill(text);
  const { valid, errors } = validateSkill(skill, { tools });
  return { skill, valid, errors };
}

/**
 * Full build helper: prompt the injected LLM, parse + validate, and (if the
 * model referenced anything invalid) return the errors so the caller can
 * re-prompt. Does not persist — the caller (Librarian) owns storage + consent.
 *
 * @param {string} need
 * @param {Object} deps
 * @param {(prompt: string) => Promise<string>} deps.llm
 * @param {Object} deps.tools
 * @param {Object} [deps.taxonomy]
 * @param {Object} [deps.profile]
 * @param {Object} [deps.previous]  - prior attempt to revise
 * @param {string} [deps.feedback]  - the person's feedback on it
 * @returns {Promise<{ skill: import('./skill.js').Skill|null, valid: boolean, errors: string[] }>}
 */
export async function buildSkill(need, { llm, tools, taxonomy, profile, previous = null, feedback = '' } = {}) {
  if (!llm) return { skill: null, valid: false, errors: ['no LLM available'] };
  const prompt = buildSkillPrompt(need, { profile, tools, taxonomy, previous, feedback });
  let out;
  try {
    out = await llm(prompt);
  } catch (e) {
    return { skill: null, valid: false, errors: [`LLM call failed: ${e.message}`] };
  }
  return parseBuiltSkill(out, { tools });
}
