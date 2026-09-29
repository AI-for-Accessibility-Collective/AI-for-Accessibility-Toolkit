import { decisionContext, decisionChoices, decisionPayload } from './verification-decisions.js';

// A comparison and a commitment need different structures. Both surfaces use
// the same reviewed values and the same choice IDs; the view invents no actions.
export function decisionView(state) {
  const decision = decisionContext(state).finding?.runtime?.decision;
  const choices = decisionChoices(state);
  const candidates = (decision?.choices || []).filter(c => c.action === 'select');
  const fields = [...new Set(candidates.flatMap(c => (c.facts || []).map(f => f.name)))].filter(name =>
    !candidates.every(c => c.facts?.find(f => f.name === name)?.value.trim() === c.label.trim()));
  const shared = candidates.length > 1 ? (candidates[0].facts || []).filter(f => fields.includes(f.name) && candidates.every(c =>
    c.facts?.some(other => other.name === f.name && other.value === f.value))) : [];
  const differing = fields.filter(name => !shared.some(f => f.name === name));
  const comparison = candidates.length > 1 && differing.length > 0;
  return { kind: decision?.kind === 'commit' ? 'commitment' : comparison ? 'comparison' : 'choice',
    fields: differing, shared,
    choices: choices.map(choice => ({ ...choice,
      detail: decision?.choices?.find(c => c.id === choice.choiceId) || null,
    })) };
}

const css = `
.vd-options{display:grid;gap:10px;width:100%;min-width:0}
.vd-options button{min-height:44px!important;padding:9px 12px!important;white-space:normal;overflow-wrap:anywhere}
.vd-candidates{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(180px,100%),1fr));gap:10px;min-width:0}
.vd-option{display:flex;flex-direction:column;gap:10px;min-width:0;container-type:inline-size;border:1px solid #d4d4d8;border-radius:10px;padding:12px;background:#fff;color:#18181b}
.vd-option dl,.vd-shared dl{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.5fr);gap:6px 10px;margin:0;font-size:inherit;line-height:1.5}
.vd-option dt,.vd-shared dt{color:#52525b;font-weight:400;overflow-wrap:anywhere}
.vd-option dd,.vd-shared dd{margin:0;font-weight:500;overflow-wrap:anywhere}
.vd-shared{padding:0 2px 8px;min-width:0}.vd-shared h3{font-size:inherit;margin:0 0 6px;font-weight:500}
.vd-option button{margin-top:auto!important;white-space:normal;overflow-wrap:anywhere;width:100%}
.vd-other{display:flex;gap:8px;flex-wrap:wrap}
.vd-source{font-size:.9em;overflow-wrap:anywhere;color:#52525b}
.vd-source summary{cursor:pointer;padding:4px 0}
.vd-source blockquote{margin:8px 0;padding-left:10px;border-left:2px solid #d4d4d8}
.vd-options[data-view=commitment] .vd-candidates{grid-template-columns:1fr}
@container(max-width:240px){.vd-option dl{grid-template-columns:minmax(0,1fr);gap:2px}.vd-option dt{font-size:.9em}.vd-option dd{margin-bottom:6px}}
@media(forced-colors:active){.vd-option{border-color:CanvasText;background:Canvas;color:CanvasText}}
`;
const viewIdSequence = Symbol.for('ai4a11y.verificationDecisionViewSequence');

export function renderDecisionChoices(state, { document: doc = document, buttonClass, keyAttribute, onChoice }) {
  if (!doc.getElementById('verification-decision-view-style')) {
    const style = doc.createElement('style');
    style.id = 'verification-decision-view-style'; style.textContent = css;
    doc.head.append(style);
  }
  const el = (tag, cls, text) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  // Reserve IDs across bundled surfaces even before their nodes are attached.
  // Every ARIA target is checked against the host page, not just the root.
  const identify = node => {
    do {
      doc[viewIdSequence] = (doc[viewIdSequence] || 0) + 1;
      node.id = `verification-options-${doc[viewIdSequence]}`;
    } while (doc.getElementById(node.id));
    return node.id;
  };
  const view = decisionView(state);
  const root = el('div', 'vd-options'); root.dataset.view = view.kind;
  identify(root);
  const cards = el('div', 'vd-candidates'), other = el('div', 'vd-other');
  if (view.shared.length) {
    const shared = el('section', 'vd-shared');
    shared.setAttribute('aria-label', 'Shared details');
    shared.append(el('h3', '', 'Shared details'));
    const list = el('dl');
    identify(list);
    for (const fact of view.shared) list.append(el('dt', '', fact.name), el('dd', '', fact.value));
    shared.append(list); root.append(shared);
  }
  for (const [index, choice] of view.choices.entries()) {
    const button = el('button', buttonClass, choice.label);
    button.type = 'button';
    button.setAttribute(keyAttribute, `answer:${decisionContext(state).decisionKey}:${choice.kind}:${index}`);
    button.addEventListener('click', () => onChoice(decisionPayload(state, choice)));
    const detail = choice.detail;
    // Shared details sit once before the options. Referencing the same list
    // from every button makes screen readers repeat it on every focus change.
    // Keep each option's own facts attached to its button instead.
    const descriptions = [];
    if (detail && (detail.action === 'approve' || (view.kind === 'comparison' && detail.action === 'select'))) {
      const card = el('section', 'vd-option');
      card.setAttribute('aria-label', choice.label);
      const facts = detail.facts || [];
      const shownFacts = view.kind === 'comparison'
        ? view.fields.map(name => ({name, value:facts.find(f => f.name === name)?.value || 'Not stated'})) : facts;
      if (shownFacts.length) {
        const list = el('dl');
        identify(list);
        descriptions.push(list.id);
        for (const fact of shownFacts) {
          list.append(el('dt', '', fact.name), el('dd', '', fact.value));
        }
        card.append(list);
      }
      // The commitment's actual reviewed page evidence remains inspectable.
      // Never route these presses through the older unbound shape handlers.
      if (view.kind === 'commitment' && detail.quote) {
        const source = el('details', 'vd-source');
        // Older reviewed actions may have no structured details. Keep their
        // source visible so approval does not hide the only review evidence.
        source.open = facts.length === 0;
        const summary = el('summary', '', 'What the page says');
        const sourceKey = `source:${decisionContext(state).decisionKey}:${detail.id}`;
        summary.setAttribute(keyAttribute, sourceKey);
        source.dataset.decisionDisclosure = sourceKey;
        const quotation = el('blockquote', '', detail.quote);
        identify(quotation);
        if (!shownFacts.length) descriptions.push(quotation.id);
        source.append(summary, quotation);
        card.append(source);
      }
      card.append(button); cards.append(card);
    } else other.append(button);
    if (descriptions.length) button.setAttribute('aria-describedby', descriptions.join(' '));
  }
  if (cards.childElementCount) root.append(cards);
  if (other.childElementCount) root.append(other);
  return root;
}
