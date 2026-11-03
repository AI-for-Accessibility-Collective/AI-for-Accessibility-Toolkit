'use strict';

const { render } = require('./rubric.js');
const { CONFIG } = require('../core/config.js');

const SYSTEM = `You are an accessibility auditor testing one web page against one WCAG 2.2 success criterion.

You receive the criterion's test rules and a batch of candidate elements from the page. For each candidate, decide whether it meets the criterion's test condition.

Evidence. Each candidate comes with (a) its markup, (b) the browser's computed accessibility facts, and (c) observations made by driving the live page — keyboard, pointer, activation, form submission, viewport changes — sometimes with screenshots. Observations are measurements, not conclusions. You may call the tools you are given to gather more evidence from the live page. Dependent actions must observe the same workflow: use one interact_and_observe call or reuse its stateId. A fresh clone starts again from the initial page; read-only tools do not open a new workflow. Gather evidence whenever the supplied evidence does not settle a candidate. A generic effect flag may reflect focus/hover styling, layout, or unrelated changes; it does not establish a widget state transition. A failed or rejected action provides no evidence that a state failed to update. Use the returned executed action and success status when interpreting observations.

Verdicts, one per candidate:
- FAIL — the evidence shows the test condition is not met.
- PASS — the evidence shows the test condition is met.
- NOT_APPLICABLE — the evidence shows the criterion does not apply to this candidate (say which applicability condition it lacks).
- UNDETERMINED — after gathering the evidence you can, it supports none of the above.

Evidence standard. Every verdict must name the observation it rests on. FAIL and PASS carry the same burden: an absent observation is evidence of nothing, so it cannot support either. Judge each candidate on its own evidence, not on how many others fail or pass. Tool descriptions and your intention to call a tool are not observations. Never invent a tool result or attribute supplied facts to a tool you have not called successfully in this conversation. If more evidence is needed, issue an actual tool call; if it remains unavailable, return UNDETERMINED.

If the page has a failure of this criterion that is not one of the listed candidates, report it under pageFindings with verdict FAIL and the XPath of the element it concerns (from the evidence), or null if it concerns the page as a whole. Otherwise return pageFindings: []. Passing observations are not failures; they must never be reported as FAIL.

Answer with one JSON object and nothing else, containing candidates and pageFindings arrays.
Each candidate object must contain id and path copied verbatim from its candidate, one verdict from the four values above, evidence describing actual supplied or successfully gathered observations, and reason explaining the applicable test condition.
Each page finding must contain path (an observed XPath or JSON null), verdict, evidence, and reason. Return an empty pageFindings array when there is no additional finding. Do not insert example entries, placeholders, ellipses, intended tool calls, or conditional failures awaiting verification. Unavailable evidence requires UNDETERMINED.`;

function compact(v) {
  return JSON.stringify(v, (k, x) => (x === null || x === undefined || (Array.isArray(x) && !x.length) ? undefined : x));
}

function axLine(ax) {
  if (!ax) return 'not in the accessibility tree';
  const states = Object.entries(ax).filter(([k, v]) => !['role', 'name', 'nameFrom', 'description', 'ignored'].includes(k) && v !== undefined && v !== false && v !== '')
    .map(([k, v]) => (v === true ? k : `${k}=${v}`));
  return `role=${ax.role || '—'} name=${JSON.stringify(ax.name || '')}${ax.nameFrom ? ` (from ${ax.nameFrom})` : ''}${ax.description ? ` description=${JSON.stringify(ax.description)}` : ''}${ax.ignored ? ' IGNORED' : ''}${states.length ? ' ' + states.join(' ') : ''}`;
}

function buildBatchMessage(criterion, page, candidates, context = []) {
  const blocks = [];
  let imageNo = 0;
  const text = [];
  text.push(`# Success criterion ${criterion.sc} ${criterion.title}\n`);
  text.push(render(criterion.sc, CONFIG.judge.rubric, { tools: CONFIG.judge.tools }));
  text.push(`\n# Page\nURL: ${page.doc.url}\nTitle: ${JSON.stringify(page.doc.title || '')}\nViewport: 1280×900 CSS px. Document: ${page.doc.width}×${page.doc.height}.`);
  const markupOnly = candidates.some((c) => c.markupOnly);
  if (page.doc.text && !markupOnly) text.push(`Visible text of the page${page.doc.textLength > page.doc.text.length ? ` (first ${page.doc.text.length} of ${page.doc.textLength} characters)` : ''}:\n"""\n${page.doc.text}\n"""`);
  if (criterion.pageContext && !markupOnly) text.push(criterion.pageContext);
  text.push(`\n# Candidates (${candidates.length})`);
  blocks.push({ type: 'text', text: text.join('\n') });
  for (const c of context.filter(c=>!candidates.some(x=>x.path===c.path))) {
    blocks.push({ type:'text', text:`\n# SC-wide context (not an additional verdict): ${c.path}\nObserved: ${compact(c.facts)}` });
    for (const im of (c.images || []).filter(x=>x?.data)) {
      blocks.push({type:'text',text:`Context image #${++imageNo}: ${im.label}`});
      blocks.push({type:'image',data:im.data,mime:im.mime||'image/png'});
    }
  }
  candidates.forEach((c, i) => {
    const lines = [`\n## Candidate ${i + 1} [path: ${c.path}]${c.id ? `\nCandidate ID: ${c.id}` : ''}`];
    if (c.element) {
      lines.push(`Markup: ${c.element.openTag}${c.element.text ? ` text=${JSON.stringify(c.element.text)}` : ''}`);

      if (!c.markupOnly) lines.push(`Accessibility: ${axLine(c.element.ax)}`);
    }
    if (c.facts) lines.push(`Observed: ${compact(c.facts)}`);
    if (c.requiredEvidence?.length) lines.push(`Evidence still required before PASS or FAIL: ${compact(c.requiredEvidence)}. Issue the actual tool call for these paths; otherwise use UNDETERMINED.`);
    const imgs = (c.images || []).filter((x) => x && x.data);
    if (imgs.length) lines.push(`Images: ${imgs.map((x) => `#${++imageNo} ${x.label}`).join('; ')}`);
    blocks.push({ type: 'text', text: lines.join('\n') });
    for (const x of imgs) blocks.push({ type: 'image', data: x.data, mime: x.mime || 'image/png' });
  });
  return blocks;
}

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    candidates: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, path: { type: 'string' }, verdict: { type: 'string', enum: ['FAIL', 'PASS', 'NOT_APPLICABLE', 'UNDETERMINED'] },
      evidence: { type: 'string' }, reason: { type: 'string' },
    }, required: ['id', 'path', 'verdict', 'evidence', 'reason'], additionalProperties: false } },
    pageFindings: { type: 'array', items: { type: 'object', properties: {
      path: { type: ['string', 'null'] }, verdict: { type: 'string', enum: ['FAIL', 'PASS', 'NOT_APPLICABLE', 'UNDETERMINED'] }, evidence: { type: 'string' }, reason: { type: 'string' },
    }, required: ['path', 'verdict', 'evidence', 'reason'], additionalProperties: false } },
  },
  required: ['candidates', 'pageFindings'],
  additionalProperties: false,
};

module.exports = { SYSTEM, ANSWER_SCHEMA, buildBatchMessage };
