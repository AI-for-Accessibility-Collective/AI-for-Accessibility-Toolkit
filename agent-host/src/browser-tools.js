// The agent's tools for the person's browser, served to its sandbox over MCP
// (streamable HTTP, JSON replies). Each call goes to the sidebar of the
// account the sandbox token names, and waits for the person:
//
//   browser_page            see the page the chat works on (the sidebar pins
//                           one tab per chat), as much as the person agrees
//                           to share (URL, source, screenshot)
//   browser_preview         run an adapter file on that page as a preview,
//                           with the agent's checks and an axe-core WCAG
//                           check before and after, and how far it moved
//                           the page (layout shift)
//   browser_remove_preview  take the preview off again
//   adapter_ready           offer a finished adapter to the person: they can
//                           export it or add it to their account. Only once
//                           its latest preview applied and passed every
//                           check, on the file as it is now. axe-core does not
//                           block it: the person is told about any problem it
//                           added, or that axe-core did not check it.
//
// The host, not opencode's event stream, writes the sidebar's line for each,
// so the person sees "Previewing … on your page" while it waits for them.
// When a run ends with an adapter that was not checked that way, the person
// is told so (afterRun).

import { readFileSync, writeFileSync, mkdirSync, statSync, realpathSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { lintWebModule, urlPatternError, SUPPORT_AREAS, MAX_PACKAGE_CODE, PAGE_TYPES, PAGE_TYPE_IDS } from '../../toolkit/protocol/adapter/index.js';

const MAX_OUTLINE = 40_000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_CHECKS = 8;
const MAX_CHECK_CODE = 3000;
const MAX_AXE_RULES = 20;
const AsyncFunction = (async () => {}).constructor;
const hashOf = (code) => createHash('sha256').update(code).digest('hex');
const problems = (rules) => (rules || []).reduce((n, r) => n + (r.count || 0), 0);
const cut = (v, n) => String(v ?? '').slice(0, n);

/** The sidebar's axe result, kept to what the agent and the record need. */
function axeOf(a) {
  if (!a || typeof a !== 'object') return undefined;
  if (a.error) return { error: cut(a.error, 160) };
  const rule = (r) => ({ id: cut(r?.id, 60), impact: r?.impact ? cut(r.impact, 20) : null, help: cut(r?.help, 200),
    wcag: (Array.isArray(r?.wcag) ? r.wcag : []).slice(0, 6).map(w => cut(w, 10)), count: Math.max(0, Number(r?.count) || 0),
    ...(Array.isArray(r?.targets) ? { targets: r.targets.slice(0, 3).map(t => cut(t, 160)) } : {}),
    ...(r?.summary ? { summary: cut(r.summary, 300) } : {}) });
  const list = (l) => (Array.isArray(l) ? l.slice(0, MAX_AXE_RULES).map(rule) : []);
  return { version: cut(a.version, 20), added: list(a.added), ...(Array.isArray(a.advice) && a.advice.length ? { advice: list(a.advice).map(({ id, help, count }) => ({ id, help, count })) } : {}),
    fixed: list(a.fixed).map(({ id, help, wcag, count }) => ({ id, help, wcag, count })), remaining: Math.max(0, Number(a.remaining) || 0) };
}

/** Text the adapter draws below the toolkit's minimum, or page text it made smaller, in a few lines; '' when none. */
export function smallTextText(t) {
  if (!t || typeof t !== 'object') return '';
  const lines = [];
  for (const d of (Array.isArray(t.drawn) ? t.drawn : []).slice(0, 5)) lines.push(`- It draws text at ${Number(d.px) || 0}px, below the ${Number(t.min) || 16}px (12pt) minimum: "${cut(d.text, 40)}".`);
  for (const d of (Array.isArray(t.shrunk) ? t.shrunk : []).slice(0, 5)) lines.push(`- It makes the page's text smaller, ${Number(d.from) || 0} → ${Number(d.px) || 0}px: "${cut(d.text, 40)}".`);
  return lines.length ? ['Text size: fix these (text the adapter shows is at least 16px, scaled up by the person\'s text size, and it never makes the page\'s text smaller):', ...lines].join('\n') : '';
}

/** What the agent reads about the axe-core check. */
export function axeText(axe) {
  if (!axe) return 'Accessibility check: axe-core did not run on this preview (the sidebar may be an older version). Ask the person to reload the extension.';
  if (axe.error) return `Accessibility check: axe-core could not run (${axe.error}).`;
  const wcag = (r) => (r.wcag.length ? ` (WCAG ${r.wcag.join(', ')})` : '');
  const lines = [`Accessibility check (axe-core ${axe.version || ''}, WCAG 2.0-2.2 A and AA rules), the page after enable() compared with before:`];
  if (axe.added.length) {
    lines.push(`- The adapter added ${problems(axe.added)} problems. Fix them unless that would undo what the person asked for:`);
    for (const r of axe.added) {
      lines.push(`  - ${r.impact ? `[${r.impact}] ` : ''}${r.id}: ${r.help}${wcag(r)}, on ${r.count} element${r.count === 1 ? '' : 's'}${r.targets?.length ? `: ${r.targets.join('; ')}` : ''}`);
      if (r.summary) lines.push(`    ${r.summary.replace(/\s+/g, ' ')}`);
    }
  } else lines.push('- The adapter added no problems axe-core finds.');
  if (axe.fixed.length) lines.push(`- It fixed: ${axe.fixed.map(r => `${r.id}${wcag(r)} on ${r.count} element${r.count === 1 ? '' : 's'}`).join('; ')}.`);
  if (axe.remaining) lines.push(`- ${axe.remaining} problems were on the page before and still are: the site's, not the adapter's. Leave them unless the person asked about them.`);
  if (axe.advice?.length) lines.push(`- Advice, not counted (axe-core's best practices and WCAG AAA; some are wrong about pages an adapter makes): it added ${axe.advice.map(r => `${r.id} on ${r.count}`).join('; ')}. Look at each; fix it when it is real.`);
  lines.push('axe-core finds only some WCAG failures. For what the adapter adds or changes, also check what it cannot: keyboard use and visible focus, name, role and state, target size, and contrast you chose (the intopia-web-accessibility skill).');
  return lines.join('\n');
}

/**
 * What the person is told about an adapter axe-core did not pass, in plain
 * words, or null. Advice, not a gate: the adapter can still be offered.
 */
function axeConcern(axe) {
  if (!axe) return 'was not checked for accessibility problems with axe-core';
  if (axe.error) return 'could not be checked for accessibility problems with axe-core';
  const added = problems(axe.added);
  if (!added) return null;
  const rules = axe.added.slice(0, 3).map(r => `${r.help.replace(/\.$/, '')}${r.wcag.length ? ` (WCAG ${r.wcag.join(', ')})` : ''}`);
  return `adds ${added} accessibility problem${added === 1 ? '' : 's'} that axe-core finds: ${rules.join('; ')}${axe.added.length > 3 ? '; and more' : ''}`;
}

/** What the agent reads about how far the page moved. */
export function shiftText(shift) {
  if (!Number.isFinite(shift)) return '';
  if (shift < 0.01) return 'Layout shift: 0 (nothing on screen moved).';
  return `Layout shift: ${shift} (0 is steady; 0.1 or more is a lot). ${shift >= 0.1 ? 'Unless the person asked for things to change size or place, the page moved more than it should: see "Keep the page steady and familiar" in your instructions.' : 'Make sure only what the person asked to change moved.'}`;
}

const MAX_QUESTIONS = 4, MAX_OPTIONS = 5;

/**
 * The agent's questions, checked and trimmed for the sidebar. Two kinds the
 * sidebar lays out itself: `pages` (this type of page, this website with its
 * address, all websites) and `areas` (the support areas, the agent's picks
 * first, the rest under "Other").
 */
export function questionsOf(list) {
  const optionsOf = (q) => (Array.isArray(q?.options) ? q.options : []).slice(0, MAX_OPTIONS)
    .map(o => ({ label: String(o?.label ?? o ?? '').trim().slice(0, 80), ...(o?.description ? { description: String(o.description).trim().slice(0, 200) } : {}) }))
    .filter(o => o.label && !/^other\b/i.test(o.label));
  const questions = (Array.isArray(list) ? list : []).slice(0, MAX_QUESTIONS).map((q) => {
    // The sidebar fills it in: this type of page (as the toolkit sorts this one), this website, all websites.
    if (q?.kind === 'pages') return { kind: 'pages', question: String(q.question || 'Which pages should this apply to?').trim().slice(0, 300), options: [], multiSelect: false };
    if (q?.kind === 'areas') {
      const picks = optionsOf(q).map(o => o.label.toLowerCase().replace(/\s*\(recommended\)$/, '')).filter((a, i, all) => SUPPORT_AREAS.includes(a) && all.indexOf(a) === i);
      if (!picks.length) throw new Error(`An areas question's options are among: ${SUPPORT_AREAS.join(', ')}.`);
      return { kind: 'areas', question: String(q.question || 'Who does this change help most?').trim().slice(0, 300), options: picks.map(label => ({ label })), multiSelect: true };
    }
    return { question: String(q?.question || '').trim().slice(0, 300), options: optionsOf(q), multiSelect: q?.multi_select === true };
  });
  if (!questions.length) throw new Error('Give at least one question.');
  for (const q of questions) {
    if (!q.question) throw new Error('Each question needs its words.');
    if (!q.kind && q.options.length < 2) throw new Error(`"${q.question}" needs at least two options besides "Other".`);
  }
  return questions;
}

const TOOLS = [
  {
    name: 'ask_questions',
    description: 'Ask the person what you need to know, as multiple choice: the sidebar shows each question with your options, and always adds "Other" where they can type their own answer. Put the option you would choose first, ending its label with "(Recommended)". Two kinds of question the sidebar lays out itself: kind "pages" (which pages it runs on: this type of page, as the toolkit sorts this one, on this website; this website, with its address; or all websites) and kind "areas" (who it helps most, more than one allowed: your options are support areas, the most likely first; the rest are under Other). After calling this, end your turn with one short sentence: the person\'s answers come as their next message.',
    inputSchema: { type: 'object', properties: {
      questions: { type: 'array', minItems: 1, maxItems: MAX_QUESTIONS, items: { type: 'object', properties: {
        kind: { type: 'string', enum: ['pages', 'areas'], description: 'pages or areas for those two questions; leave out for any other.' },
        question: { type: 'string', description: 'The whole question in plain words, ending with a question mark. Optional for pages and areas.' },
        options: { type: 'array', maxItems: MAX_OPTIONS, description: 'The choices (at least two; none for pages; for areas, one or more of ' + SUPPORT_AREAS.join(', ') + '). Do not add "Other": the sidebar does.',
          items: { type: 'object', properties: {
            label: { type: 'string', description: 'The choice, in 1 to 6 words.' },
            description: { type: 'string', description: 'Optional: what choosing it means, in one short sentence.' },
          }, required: ['label'], additionalProperties: false } },
        multi_select: { type: 'boolean', description: 'true when the person may choose more than one.' },
      }, additionalProperties: false } },
    }, required: ['questions'], additionalProperties: false },
  },
  {
    name: 'browser_page',
    description: 'See the web page the person has the sidebar open on. The person chooses what to share: the address only, the page source (structure, text and some styles), or also a screenshot. They decide once per site per chat; pass screenshot: true to ask for a screenshot again. Returns what they shared, or that they chose not to.',
    inputSchema: { type: 'object', properties: {
      reason: { type: 'string', description: 'One plain sentence the person reads: why you want to see the page.' },
      screenshot: { type: 'boolean', description: 'Ask for a screenshot this time, even if they shared less before.' },
    }, required: ['reason'], additionalProperties: false },
  },
  {
    name: 'browser_preview',
    description: 'Preview an adapter on the person\'s page: runs the adapter file (a web module under /work) on the page this chat works on, without installing it, with your checks. The person may be asked first. Returns whether enable() applied, failed (with the error) or skipped; how many changes it made in the page and how far it moved what was on screen (layout shift); each check before and after enable(); the accessibility problems axe-core (WCAG 2.0-2.2 A and AA rules) finds that the adapter added or fixed; and the page afterwards at the level the person shares. A new preview replaces the last one.',
    inputSchema: { type: 'object', properties: {
      file: { type: 'string', description: 'The adapter file, e.g. adapters/bigger-buttons.js (relative to /work).' },
      name: { type: 'string', description: 'The adapter\'s name, as the person will see it.' },
      runs_on: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'URL patterns for the pages the person chose, e.g. https://example.com/* or https://example.com/products/*. Every site (*://*/*) only when they chose All websites.' },
      checks: { type: 'array', minItems: 1, maxItems: MAX_CHECKS, description: 'How you know it works. Each check is the body of an async function run in the page, before enable() and again after it, that returns true when the page is as it should be: for example that the elements the adapter changes exist, that they changed, and that using what it adds (type into its box, click its button, then wait a moment) has the effect it should. Put the page back at the end of a check that uses the page. Only pass or fail comes back, never page content.',
        items: { type: 'object', properties: {
          name: { type: 'string', description: 'What it checks, in a few plain words.' },
          code: { type: 'string', description: 'The function body, e.g. return document.querySelectorAll("button").length > 0 && [...document.querySelectorAll("button")].every(b => b.getBoundingClientRect().height >= 44);' },
        }, required: ['name', 'code'], additionalProperties: false } },
      parameters: { type: 'object', description: 'Parameters passed to enable(), if any.' },
    }, required: ['file', 'name', 'runs_on', 'checks'], additionalProperties: false },
  },
  {
    name: 'browser_remove_preview',
    description: 'Take the current preview off the person\'s page (calls its disable()).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'adapter_ready',
    description: 'Offer a finished adapter to the person. The sidebar then shows it with "Add to my account" and "Export". Refused unless the latest preview of this file, as it is now, applied and passed every check; review it first. If that preview added accessibility problems axe-core finds, or axe-core did not check it, the sidebar tells the person.',
    inputSchema: { type: 'object', properties: {
      file: { type: 'string', description: 'The adapter file under /work, e.g. adapters/bigger-buttons.js' },
      id: { type: 'string', description: 'Short id: lowercase letters, digits and dashes, e.g. bigger-buttons' },
      name: { type: 'string' },
      about: { type: 'string', description: 'One or two plain sentences: what it changes, and for whom.' },
      runs_on: { type: 'array', items: { type: 'string' }, minItems: 1 },
      support_areas: { type: 'array', items: { type: 'string', enum: [...SUPPORT_AREAS] } },
      page_types: { type: 'array', items: { type: 'string', enum: [...PAGE_TYPE_IDS] }, description: 'When the person chose a type of page: the kinds of page it runs on, among those runs_on matches (' + PAGE_TYPES.map(t => `${t.id}: ${t.name}`).join('; ') + '). The browser runs it only where the page is one of them.' },
    }, required: ['file', 'id', 'name', 'about', 'runs_on'], additionalProperties: false },
  },
];

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const NO_ANSWER = 'The person has not answered in the sidebar (it may be closed, or they are away). Stop here: tell them in one sentence what is waiting for them, and wait for their reply.';
const fail = (t) => ({ content: [{ type: 'text', text: t }], isError: true });

export function createBrowserTools({ chats, requests, pageData, workDir, log, verification }) {
  /** Read an adapter file from the account's /work, refusing anything outside it. */
  function readAdapter(uid, file) {
    const root = realpathSync(workDir(uid));
    const rel = String(file || '').replace(/^\/work\/?/, '');
    if (!/\.m?js$/.test(rel)) throw new Error('The adapter must be a .js file under /work.');
    let full;
    try { full = realpathSync(path.resolve(root, rel)); } catch { throw new Error(`There is no file ${rel} under /work.`); }
    if (!full.startsWith(root + path.sep)) throw new Error('The adapter must be a file under /work.');
    if (statSync(full).size > MAX_PACKAGE_CODE) throw new Error(`The adapter is over ${MAX_PACKAGE_CODE} characters.`);
    const code = readFileSync(full, 'utf8');
    const errors = lintWebModule(code).filter(f => f.level === 'error');
    if (errors.length) throw new Error(`The adapter has problems to fix first:\n${errors.map(e => `- ${e.line ? `line ${e.line}: ` : ''}${e.message}`).join('\n')}`);
    return { code, file: path.relative(root, full) };
  }

  function patternsOf(list, { allSites = false } = {}) {
    const patterns = (Array.isArray(list) ? list : []).map(String).filter(Boolean);
    if (!patterns.length) throw new Error('Give at least one URL pattern in runs_on.');
    for (const p of patterns) {
      const e = urlPatternError(p);
      if (e) throw new Error(`runs_on "${p}": ${e}`);
      // An adapter is for a site: one that runs everywhere is never what was asked.
      if (!allSites && (p === '*' || /^[^:]+:\/\/\*(\/|:|$)/.test(p))) throw new Error(`runs_on "${p}" covers every site. Name the site the adapter is for, such as https://example.com/*. If a preview was skipped, the page this chat works on is another site: ask the person.`);
    }
    return patterns;
  }

  /** The agent's checks: named function bodies that compile on their own and pass the adapter lint. */
  function checksOf(list) {
    const checks = (Array.isArray(list) ? list : []).slice(0, MAX_CHECKS).map((c, i) => ({ name: String(c?.name || `Check ${i + 1}`).slice(0, 100), code: String(c?.code || '') }));
    if (!checks.length) throw new Error('Give at least one check: how you will know the adapter works on this page.');
    for (const c of checks) {
      if (!c.code.trim()) throw new Error(`Check "${c.name}" has no code.`);
      if (c.code.length > MAX_CHECK_CODE) throw new Error(`Check "${c.name}" is over ${MAX_CHECK_CODE} characters.`);
      // Compiled, never called: a body that does not stand on its own as a
      // function body cannot be spliced into the preview script.
      try { new AsyncFunction(c.code); } catch (e) { throw new Error(`Check "${c.name}" does not compile as a function body: ${e.message}`); }
      const errors = lintWebModule(`export const Check = { async enable() {\n${c.code}\n}, disable() {} };`).filter(f => f.level === 'error');
      if (errors.length) throw new Error(`Check "${c.name}": ${errors.map(e => e.message).join('; ')}.`);
    }
    return checks;
  }

  function keepChecks(uid, chatId, hash, checks) {
    try {
      const dir = path.join(workDir(uid), '..', 'previews', chatId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${hash}.checks.json`), JSON.stringify(checks));
    } catch (e) { log?.warn('preview.checks-not-kept', { uid, chatId, error: e.message }); }
  }

  /** Whether a preview record shows the adapter working, and if not, why (plain words for the person). */
  function verdict(rec, code) {
    if (!rec) return { ok: false, why: 'has not been previewed on your page' };
    if (rec.hash !== hashOf(code)) return { ok: false, why: 'changed after its last preview' };
    if (rec.status === 'no-answer' || rec.status === 'declined') return { ok: false, why: 'was not previewed: the preview did not run' };
    if (rec.status !== 'applied') return { ok: false, why: `did not apply in its last preview (${rec.status})` };
    const failed = (rec.checks || []).filter(c => !c.after).length;
    if (!rec.checks?.length) return { ok: false, why: 'was previewed without checks' };
    if (failed) return { ok: false, why: `failed ${failed} of its ${rec.checks.length} checks` };
    return { ok: true, concern: axeConcern(rec.axe) };
  }

  function pageContent(intro, shared) {
    const lines = [intro];
    if (shared?.url) lines.push(`Address: ${shared.url}`);
    if (shared?.title) lines.push(`Title: ${shared.title}`);
    if (shared?.outline) lines.push('', 'Page source (outline):', String(shared.outline).slice(0, MAX_OUTLINE));
    const content = [{ type: 'text', text: lines.join('\n') }];
    const m = /^data:(image\/(?:jpeg|png));base64,(.+)$/.exec(String(shared?.screenshot || ''));
    if (m) content.push({ type: 'image', mimeType: m[1], data: m[2] });
    return content;
  }

  const handlers = {
    async ask_questions(uid, chatId, args) {
      const questions = questionsOf(args.questions);
      chats.addEntry(uid, chatId, { kind: 'questions', questions });
      return text(`The sidebar shows your ${questions.length === 1 ? 'question' : `${questions.length} questions`} with your options and "Other". End your turn now with one short sentence; do not answer for the person or go on building. Their answers come as their next message.`);
    },

    async browser_page(uid, chatId, args) {
      const step = chats.addEntry(uid, chatId, { kind: 'step', text: 'Asking to see your page', state: 'running' });
      const a = await requests.ask(uid, chatId, { kind: 'page', reason: String(args.reason || '').slice(0, 300), screenshot: args.screenshot === true });
      if (a.cancelled || a.timedOut) {
        chats.addEntry(uid, chatId, { id: step.id, text: 'Asked to see your page: no answer', state: 'failed' });
        return text(a.timedOut ? NO_ANSWER : 'The chat was stopped.');
      }
      if (a.unavailable) {
        chats.addEntry(uid, chatId, { id: step.id, text: 'The page could not be shared', state: 'failed' });
        return text(`The page cannot be shared: ${String(a.unavailable).slice(0, 200)}. Ask the person to choose the page they mean in the sidebar.`);
      }
      if (a.remember && a.origin && a.level) chats.setConsent(uid, chatId, a.origin, a.level);
      if (!a.level || a.level === 'none') {
        chats.addEntry(uid, chatId, { id: step.id, text: 'You chose not to share the page', state: 'done' });
        return text('The person chose not to share this page. Work from what they tell you, and do not ask again in this chat unless they bring it up.');
      }
      pageData(uid, chatId, 'page', a);
      chats.addEntry(uid, chatId, { id: step.id, text: a.level === 'url' ? 'Got the page’s address' : 'Looking at the page', state: 'done' });
      const what = { url: 'only the address', source: 'the address and the page source', screenshot: 'the address, the page source and a screenshot' }[a.level] || 'part of the page';
      const skipped = a.level === 'screenshot' && !a.screenshot ? ' The screenshot was left out: the page is not the tab on screen right now.' : '';
      const kind = PAGE_TYPES.find(t => t.id === a.pageType?.type);
      const sorted = kind ? ` The toolkit sorts this page as: ${kind.name} (${a.pageType.source === 'page' ? 'its own markup says so' : 'as its model judged'}).` : '';
      return { content: pageContent(`The person shared ${what}.${skipped}${sorted}`, a) };
    },

    async browser_preview(uid, chatId, args) {
      let adapter, patterns, checks;
      try { adapter = readAdapter(uid, args.file); patterns = patternsOf(args.runs_on, { allSites: chats.get(uid, chatId).allSites }); checks = checksOf(args.checks); } catch (e) { return fail(e.message); }
      const taken = chats.claimFile(uid, chatId, adapter.file);
      if (taken) return fail(fileTaken(adapter.file, taken));
      const name = String(args.name || adapter.file).slice(0, 80);
      const record = (fields) => chats.recordPreview(uid, chatId, { file: adapter.file, name, hash: hashOf(adapter.code), runsOn: patterns, ...fields });
      // Changed code: the agent is rebuilding, so the background checks of the old code stop.
      verification?.codeChanged(uid, chatId, adapter.file, hashOf(adapter.code));
      const step = chats.addEntry(uid, chatId, { kind: 'step', text: `Previewing “${name}” on your page`, state: 'running' });
      const a = await requests.ask(uid, chatId, { kind: 'preview', name, file: adapter.file, code: adapter.code, runsOn: patterns, checks,
        parameters: args.parameters && typeof args.parameters === 'object' ? args.parameters : {} });
      if (a.cancelled || a.timedOut) {
        record({ status: 'no-answer' });
        chats.addEntry(uid, chatId, { id: step.id, text: `Preview of “${name}”: no answer`, state: 'failed' });
        return text(a.timedOut ? `${NO_ANSWER} The preview did not run, so you do not know whether the adapter works: do not say it does.` : 'The chat was stopped.');
      }
      if (a.unavailable) {
        record({ status: 'no-answer' });
        chats.addEntry(uid, chatId, { id: step.id, text: `Could not preview “${name}”: no page to preview on`, state: 'failed' });
        return text(`The preview did not run: ${String(a.unavailable).slice(0, 200)}. Ask the person to choose the page in the sidebar, and do not say the adapter works.`);
      }
      if (a.status === 'declined') {
        record({ status: 'declined' });
        chats.addEntry(uid, chatId, { id: step.id, text: `You chose not to preview “${name}”`, state: 'done' });
        return text('The person chose not to preview it now. Ask them in your reply what they would like.');
      }
      if (a.after) pageData(uid, chatId, 'after-preview', a.after);
      const results = Array.isArray(a.checks) ? checks.map((c, i) => ({ name: c.name, before: !!a.checks[i]?.before, after: !!a.checks[i]?.after, ...(a.checks[i]?.error ? { error: String(a.checks[i].error).slice(0, 160) } : {}) })) : [];
      const changes = Number.isFinite(a.changes) ? a.changes : null;
      const shift = Number.isFinite(a.shift) ? Math.max(0, Math.round(a.shift * 1000) / 1000) : null;
      const axe = a.status === 'applied' ? axeOf(a.axe) : undefined;
      const rec = record({ status: a.status || 'failed', changes, shift, checks: results, ...(axe ? { axe } : {}) });
      // The checks themselves, by the code they checked: the background check runs them again on the copy of this page.
      keepChecks(uid, chatId, rec.hash, checks);
      const passed = results.filter(c => c.after).length;
      const added = problems(axe?.added);
      const tally = (results.length ? ` · ${passed} of ${results.length} checks pass` : '')
        + (axe && !axe.error ? (added ? ` · ${added} new accessibility problem${added === 1 ? '' : 's'}` : ' · no new accessibility problems') : '');
      const label = { applied: `“${name}” is previewing on your page${tally}`, skipped: `“${name}” did not apply on this page`, failed: `“${name}” failed on your page` }[a.status] || `Preview of “${name}” finished`;
      const v = verdict(rec, adapter.code);
      const good = v.ok;
      // What the person can open under the line: each check, and each new problem axe-core found.
      const details = a.status === 'applied' && (results.length || axe?.added?.length)
        ? { checks: results.map(({ name, after, error }) => ({ name, pass: after, ...(error ? { error } : {}) })),
            issues: (axe?.added || []).map(({ help, impact, count }) => ({ help, impact, count })) }
        : undefined;
      chats.addEntry(uid, chatId, { id: step.id, text: label, state: a.status === 'failed' || (a.status === 'applied' && !good) ? 'failed' : 'done', ...(details ? { details } : {}) });
      const intro = [
        `Preview result: ${a.status}${a.message ? ` (${String(a.message).slice(0, 1000)})` : ''}.`,
        a.status === 'skipped' && /pattern|scope|match/i.test(a.message || '')
          ? `Its runs_on patterns do not match the page this chat works on${a.site ? ` (${a.site})` : ''}. Do not widen them to other sites: if that is not the site the adapter is for, ask the person to choose the right page in the sidebar.` : '',
        a.status === 'applied' && changes !== null ? (changes ? `enable() made ${changes} changes in the page.` : 'enable() changed nothing in the page: what it looks for is probably not there.') : '',
        a.status === 'applied' ? shiftText(shift) : '',
        results.length ? ['Checks (before enable → after):', ...results.map(c => `- ${c.name}: ${c.before ? 'pass' : 'fail'} → ${c.after ? 'pass' : 'fail'}${c.error ? ` (${c.error})` : ''}`)].join('\n') : '',
        a.status === 'applied' ? axeText(axe) : '',
        a.status === 'applied' ? smallTextText(a.smallText) : '',
        a.status === 'applied' ? (!good
          ? `It is not ready: it ${v.why}. Fix the adapter (or a check that is wrong) and preview again. Do not tell the person it works.`
          : !v.concern
            ? 'Every check passes and it added no problem axe-core finds. Review the page afterwards too (against WCAG, and that it stays steady and looks like the site), then tell the person what changed and ask them to try it.'
            : `Every check passes, but it ${v.concern}. Fix that and preview again if you can without undoing what the person asked for. If a problem stays, tell the person which one and why. You can still offer it: the sidebar tells the person about it. Review the page afterwards too (against WCAG, and that it stays steady and looks like the site).`) : '',
        a.after ? 'The page with the preview on, as the person shares it:' : 'The person shares less than the page source, so you cannot see the page afterwards: rely on your checks, and ask them how it looks.',
      ].filter(Boolean).join('\n');
      return { content: pageContent(intro, a.after) };
    },

    async browser_remove_preview(uid, chatId) {
      const a = await requests.ask(uid, chatId, { kind: 'remove-preview' });
      if (a.cancelled || a.timedOut) return text('The sidebar did not answer.');
      chats.addEntry(uid, chatId, { kind: 'step', text: 'Took the preview off your page', state: 'done' });
      return text(a.removed ? 'The preview is off the page.' : 'There was no preview on the page.');
    },

    async adapter_ready(uid, chatId, args) {
      let adapter, patterns;
      try { adapter = readAdapter(uid, args.file); patterns = patternsOf(args.runs_on, { allSites: chats.get(uid, chatId).allSites }); } catch (e) { return fail(e.message); }
      const taken = chats.claimFile(uid, chatId, adapter.file);
      if (taken) return fail(fileTaken(adapter.file, taken));
      const v = verdict(chats.previewOf(uid, chatId, adapter.file), adapter.code);
      if (!v.ok) return fail(`Not ready: the adapter ${v.why}. Preview it with browser_preview and checks that show it works, fix what fails, and offer it once every check passes.`);
      const id = String(args.id || '');
      if (!SLUG.test(id)) return fail('id must be lowercase letters, digits and dashes, starting with a letter or digit.');
      const kinds = (args.page_types || []).filter(k => PAGE_TYPE_IDS.includes(k));
      offer(uid, chatId, adapter, v, { id, name: String(args.name || id).slice(0, 80), about: String(args.about || '').slice(0, 600), runsOn: patterns,
        supportAreas: (args.support_areas || []).filter(a => SUPPORT_AREAS.includes(a)), pageTypes: kinds.length ? kinds : chats.get(uid, chatId).pageTypes });
      return text('The sidebar now offers it to the person with "Add to my account" and "Export". Tell them in one or two sentences what it does; do not publish it yourself. A fuller check of this version, and until one has finished a full review by independent reviewers, now run in the background; if they find problems, they come to you as a message to fix. The first time you offer it, tell the person these checks run in the background and that they can try it and ask for changes in the meantime.'
        + (v.concern ? ` The sidebar also told them it ${v.concern}: say in a sentence why that is left.` : ''));
    },
  };

  /** Offer a version the latest preview showed working: kept, then checked in the background. */
  function offer(uid, chatId, adapter, v, { id, name, about, runsOn, supportAreas, pageTypes }) {
    // The version offered, as it is now: what "Add to my account" and Export get, whatever the agent writes next.
    const kept = path.join(workDir(uid), '..', 'offered', chatId);
    mkdirSync(kept, { recursive: true });
    writeFileSync(path.join(kept, `${id}.js`), adapter.code);
    const rec = chats.markReady(uid, chatId, { id, file: adapter.file, hash: hashOf(adapter.code), name, about, runsOn, supportAreas,
      ...(pageTypes?.length ? { pageTypes } : {}) });
    try { verification?.start(uid, chatId, rec.id); } catch (e) { log?.warn('verify.start-failed', { uid, chatId, error: e.message }); }
    // Until a full review has finished for it, the full review starts too (it waits for the background check).
    const review = !rec.reviewed;
    if (review) try { verification?.start(uid, chatId, rec.id, { review: true, auto: true }); } catch (e) { log?.warn('verify.review-not-started', { uid, chatId, error: e.message }); }
    chats.addEntry(uid, chatId, { kind: 'notice', text: rec.version === 1
      ? `“${name}” is ready: you can add it to your account or export it. We are running more checks on it in the background. Try it on your page and ask for changes in the meantime.`
      : `“${name}” version ${rec.version} is ready.` });
    if (v.concern) chats.addEntry(uid, chatId, { kind: 'warning', text: `“${name}” ${v.concern}. Check it on your page before you rely on it.` });
    return rec;
  }

  /**
   * After a run: an adapter whose latest preview, of the file as it is now,
   * passed every check is the person's to use, so one the agent did not
   * offer is offered here. The adapters the run wrote or previewed that are
   * not shown to work (verdict) get a warning. Never says one works.
   */
  function afterRun(uid, chatId, since) {
    const dir = path.join(workDir(uid), 'adapters');
    const touched = new Set(Object.values(chats.previews(uid, chatId)).filter(p => p.at >= since).map(p => p.file));
    try {
      for (const f of readdirSync(dir)) if (/\.m?js$/.test(f) && statSync(path.join(dir, f)).mtime.toISOString() >= since) touched.add(`adapters/${f}`);
    } catch { /* no adapters yet */ }
    for (const file of touched) {
      let code;
      try { code = readFileSync(path.join(workDir(uid), file), 'utf8'); } catch { continue; }
      const rec = chats.previewOf(uid, chatId, file);
      const v = verdict(rec, code);
      if (v.ok) { offerPassing(uid, chatId, file, code, rec, v); continue; }
      const name = rec?.name || path.basename(file).replace(/\.m?js$/, '');
      chats.addEntry(uid, chatId, { kind: 'warning', text: `Not checked: “${name}” ${v.why}. Try it on your page yourself before you rely on it.` });
    }
  }

  /** The website the chat's page was shared from (its page data), as a pattern, or null. */
  function sharedSite(uid, chatId) {
    const dir = path.join(workDir(uid), '..', 'page-data', chatId);
    let names = [];
    try { names = readdirSync(dir).filter(n => n.endsWith('-page.json')).sort().reverse(); } catch { return null; }
    for (const n of names) {
      try {
        const d = JSON.parse(readFileSync(path.join(dir, n), 'utf8'));
        const origin = d.origin || (d.url ? new URL(d.url).origin : null);
        if (/^https?:\/\//.test(origin || '')) return `${origin}/*`;
      } catch { /* the next one */ }
    }
    return null;
  }

  /** Offer an adapter whose latest preview of this code passed, unless it is offered already. */
  function offerPassing(uid, chatId, file, code, rec, v) {
    const chat = chats.get(uid, chatId);
    if (chat.adapters.some(a => a.file === file && a.hash === rec.hash)) return false;
    // A preview from before previews kept their pages: the website it was previewed on.
    const runsOn = rec.runsOn?.length ? rec.runsOn : [sharedSite(uid, chatId)].filter(Boolean);
    if (!runsOn.length) return false;
    const id = (chat.adapters.find(a => a.file === file)?.id) || path.basename(file).replace(/\.m?js$/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'adapter';
    offer(uid, chatId, { file, code }, v, { id, name: rec.name || id, about: '', runsOn, supportAreas: chat.supportAreas || [], pageTypes: chat.pageTypes });
    log?.info('adapter.offered-after-run', { uid, chatId });
    return true;
  }

  /**
   * A chat that ended before the host offered passing previews itself (or
   * while it was down): offer what passed now. Not while it runs; afterRun
   * does that when the run ends.
   */
  function offerFinished(uid, chatId) {
    if (chats.isBusy(uid, chatId)) return;
    for (const rec of Object.values(chats.previews(uid, chatId))) {
      let code;
      try { code = readFileSync(path.join(workDir(uid), rec.file), 'utf8'); } catch { continue; }
      const v = verdict(rec, code);
      if (v.ok) offerPassing(uid, chatId, rec.file, code, rec, v);
    }
  }

  // The person's other chats may run at the same time, in the same /work.
  const fileTaken = (file, title) => `${file} is being worked on in the person's other chat “${title}”, which is running now. Write this chat's adapter to a file of its own (another name under /work/adapters/), preview that one, and offer it.`;

  async function call(uid, chatId, name, args) {
    if (!handlers[name]) return fail(`Unknown tool ${name}.`);
    log?.info('tool.call', { uid, chatId, tool: name });
    try { return await handlers[name](uid, chatId, args || {}); } catch (e) { log?.warn('tool.error', { uid, tool: name, error: e.message }); return fail(e.message); }
  }

  handle.afterRun = afterRun;
  handle.offerFinished = offerFinished;
  return handle;

  async function handle(req, res) {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); return res.end(); }
    // A run's token (runner.js): the account, and the chat the call is for.
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const run = chats.runForToken(token);
    if (!run) return json(res, 401, { error: 'unknown run' });
    let msg;
    try {
      const chunks = []; for await (const c of req) chunks.push(c);
      msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
    if (msg.id === undefined || msg.id === null) { res.writeHead(202); return res.end(); }
    const reply = (result) => json(res, 200, { jsonrpc: '2.0', id: msg.id, result });
    switch (msg.method) {
      case 'initialize':
        return reply({ protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'ai4a11y-browser', version: '0.1.0' } });
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: TOOLS });
      case 'tools/call': return reply(await call(run.uid, run.chatId, msg.params?.name, msg.params?.arguments));
      default: return json(res, 200, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `no method ${msg.method}` } });
    }
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export const BROWSER_TOOLS = TOOLS;
