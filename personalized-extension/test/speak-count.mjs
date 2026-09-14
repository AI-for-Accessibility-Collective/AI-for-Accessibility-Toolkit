/**
 * How many questions stop the run under the old rule and under speak.
 *
 * Not a test: a measurement over the shipped models in
 * extension/validation/htas, run by hand when the corpus changes.
 *
 *   old rule   moment == "Now" and speak != DROP   (what the layer routed on)
 *   new rule   speak == "gate"                     (what the audit asks for)
 *   never      moment == "Now" and speak == "never" - questions the old rule
 *              would have spoken that the audit marked silent
 *
 * Run: node test/speak-count.mjs [--csv]
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = new URL('../extension/validation/htas/', import.meta.url).pathname;
const csv = process.argv.includes('--csv');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();

const rows = [];
const speak = {};
for (const f of files) {
  const m = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const r = { model: f.replace(/\.json$/, ''), q: 0, old: 0, gate: 0, never: 0,
              drop: 0, noSpeak: 0, money: 0, moneyBelowGate: 0 };
  const walk = (n) => {
    for (const q of n.questions || []) {
      const s = q.speak;
      speak[String(s)] = (speak[String(s)] || 0) + 1;
      r.q += 1;
      if (s == null) r.noSpeak += 1;
      if (s === 'DROP') r.drop += 1;
      if (q.moment === 'Now' && s !== 'DROP') r.old += 1;
      if (s === 'gate') r.gate += 1;
      if (q.moment === 'Now' && s === 'never') r.never += 1;
      if (q.moneyMoving === true) { r.money += 1; if (s !== 'gate') r.moneyBelowGate += 1; }
    }
    for (const c of n.children || []) walk(c);
  };
  walk(m.tree || m);
  rows.push(r);
}
const total = rows.reduce((a, r) => {
  for (const k of Object.keys(r)) if (k !== 'model') a[k] = (a[k] || 0) + r[k];
  return a;
}, { model: 'TOTAL' });

const cols = ['model', 'q', 'old', 'gate', 'never', 'drop', 'noSpeak', 'money', 'moneyBelowGate'];
if (csv) {
  console.log(cols.join(','));
  for (const r of [...rows, total]) console.log(cols.map((c) => r[c]).join(','));
} else {
  console.log(`${files.length} models, ${total.q} questions`);
  console.log(`speak values: ${JSON.stringify(speak)}`);
  console.log(`stop the run, old rule (moment Now, not DROP): ${total.old}`);
  console.log(`stop the run, new rule (speak gate):           ${total.gate}`);
  console.log(`never questions the old rule would speak:      ${total.never}`);
  console.log(`money-moving questions audited below gate:     ${total.moneyBelowGate} of ${total.money}`);
  console.log(`questions with no speak: ${total.noSpeak}; DROP: ${total.drop}`);
}
