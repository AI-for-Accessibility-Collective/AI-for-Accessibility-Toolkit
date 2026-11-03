'use strict';

const path = require('path');

const RUBRIC_DIR = path.join(__dirname, '..', '..', 'rubrics');
const load = (sc) => require(path.join(RUBRIC_DIR, `${sc}.js`));

function render(sc, variant, { tools = true } = {}) {
  const r = load(sc);

  const lines = [`Analyze compliance with WCAG SC ${r.sc} (${r.title}).`, ...(r.preamble ? [r.preamble] : []), 'Test rules:'];
  r.rules.forEach((rule, i) => {
    lines.push(`${i + 1}. ${rule.text}`);
    if (variant === 'rules' || !rule.tools || !rule.tools.length) return;
    if (tools) lines.push(`   Tools: ${rule.tools.join(', ')}`);
    if (variant === 'v2' && rule.rubric) lines.push(`   Rubric: ${rule.rubric}`);
  });
  return withoutActIds(lines.join('\n'));
}

const ACT_ID = /ACT [0-9a-z]{6}/;
function withoutActIds(text) {
  const out = text
    .replace(/ACT [0-9a-z]{6}, whose test target is/g, 'the element that fails is')
    .replace(/ACT [0-9a-z]{6}; /g, '')
    .replace(/; ACT [0-9a-z]{6}\)/g, ')')
    .replace(/ \(ACT [0-9a-z]{6}\)/g, '');
  if (ACT_ID.test(out)) throw new Error(`an ACT rule id is left in rendered rules: ${out.match(ACT_ID)[0]}`);
  return out;
}

const toolsOf = (sc) => [...new Set(load(sc).rules.flatMap((r) => r.tools || []))];

module.exports = { render, toolsOf, load };
