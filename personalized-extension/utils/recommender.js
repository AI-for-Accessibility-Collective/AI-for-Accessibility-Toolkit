import { getRegistryForPrompt } from '../skills/registry.js';

export async function getRecommendations({ supportAreas, siteTypes, freeText, aiCall }) {
  const registry = getRegistryForPrompt();

  const prompt = `You are an accessibility expert helping configure a browser extension.

The user has described their accessibility needs:
- Support areas: ${supportAreas.length > 0 ? supportAreas.join(', ') : 'none selected'}
- Types of sites they use: ${siteTypes.length > 0 ? siteTypes.join(', ') : 'none selected'}
- Additional description: ${freeText || 'none provided'}

Here are the available built-in skills:
${JSON.stringify(registry, null, 2)}

Based on the user's needs, return a JSON object with:
1. "recommended" — an array of objects with:
   - "skillId": the id of a built-in skill to enable
   - "reason": a brief, friendly explanation of why this skill helps (1 sentence)
2. "newSkills" — an array of objects for needs NOT covered by any built-in skill:
   - "name": a short name for the proposed skill
   - "description": what the skill would do (1-2 sentences)
   - "supportAreas": which support areas it addresses

Rules:
- Only recommend skills that genuinely match the user's stated needs
- If the user selected no support areas but wrote free text, infer their needs from the text
- Only add to "newSkills" if there's a clear need that no built-in skill addresses
- Return ONLY valid JSON, no markdown fences, no explanation text

Example response format:
{
  "recommended": [
    { "skillId": "dark-mode", "reason": "Reduces eye strain for comfortable browsing." }
  ],
  "newSkills": [
    { "name": "Recipe Step Highlighter", "description": "Highlights the current step in recipe instructions for easier cooking.", "supportAreas": ["cognitive", "vision"] }
  ]
}`;

  const raw = await aiCall(prompt);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI did not return valid JSON');

  const result = JSON.parse(jsonMatch[0]);

  if (!Array.isArray(result.recommended)) result.recommended = [];
  if (!Array.isArray(result.newSkills)) result.newSkills = [];

  const validIds = new Set(registry.map(s => s.id));
  result.recommended = result.recommended.filter(r => validIds.has(r.skillId));

  return result;
}
