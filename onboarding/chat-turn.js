// chat-turn.js — the routing decision behind every chat turn, lifted out of
// chat.js so it can be tested without a browser.
//
// chat.js still owns the turn's EFFECTS (drawing messages, speaking, focus,
// the busy latch). What lives here is the part that decides WHAT a turn is,
// which is the behavior worth pinning: the precedence between a controller
// command, a self-description, and everything else.
//
// Precedence:
//   1. a reset phrase ("back to my profile") — a PROFILE operation, so it runs
//      before the grammar, or "reset my settings" would read as a settings
//      command.
//   2. a self-description ("I'm blind", "I have dyslexia") → onboarding. What
//      someone tells us about themselves is durable, and outranks reading the
//      same words as a one-off command.
//   3. otherwise a deterministic controller command ("bigger text", "read
//      this") — an action, not a profile edit.
//   4. otherwise hand it to the controller, which may answer, run a task, or
//      report that it recognized nothing.
//
// Steps 2 and 3 used to be the other way round, which meant a disclosure whose
// condition is ALSO a settings keyword never reached the profile: "I have
// dyslexia" parsed as a dyslexia-font command and changed the page for the
// session only, while "I'm blind" and "I have ADHD" (no matching keyword)
// onboarded normally. "I am deaf and I have dyslexia" lost the hearing half
// entirely. Nobody loses the adaptation by onboarding instead: the reading area
// derives dyslexiaFont along with lineSpacing and simplify, so the person gets
// the same font, two more adaptations, and a profile that outlives the tab.
//
// Putting onboarding first is safe because detectOnboarding is deliberately
// conservative, and that is where the protection belongs: its keywords are
// self-DESCRIPTION words with command words ("captions", "magnify", bare
// "reading") excluded on purpose, and it additionally requires first-person
// phrasing or a bare condition. So "bigger text", "hide distractions" and even
// "I need bigger text" never reach it. Across the 599 distinct utterances in
// this repo's controller and chat test corpora, exactly four are claimed by
// both matchers, and all four are dyslexia disclosures.

/**
 * Decide what a turn is. Pure: both matchers are passed in, and nothing here
 * touches the DOM, the network, or module state.
 *
 * The grammar is not among them. Once a self-description takes precedence, a
 * command and an unrecognized utterance have the same answer — hand it to the
 * controller — so the ladder no longer needs to ask what the grammar claims.
 *
 * @returns {{kind: 'reset'|'onboard'|'controller', onboarding?: object}}
 */
export function routeTurn(text, { isResetToProfile, detectOnboarding }) {
  const u = String(text || '').trim();
  if (!u) return { kind: 'controller' };

  if (isResetToProfile(u)) return { kind: 'reset' };

  // A self-description is checked first: what someone tells us about themselves
  // should be recorded, even when the same words would also parse as a command.
  const onboarding = detectOnboarding(u);
  if (onboarding) return { kind: 'onboard', onboarding };

  return { kind: 'controller' };
}

/**
 * What the controller's answer means for the turn. Kept next to routeTurn
 * because together they are the whole ladder.
 *
 *   'task'         — accepted and running; the real result arrives later as a
 *                    note, so the caller shows a waiting state.
 *   'unrecognized' — nothing deterministic matched; fall through to a general
 *                    answer.
 *   'say'          — the controller has a reply to deliver as-is.
 */
export function classifyControllerResult(res) {
  if (!res || !res.intent) return 'say';
  if (res.intent.action === 'task' && res.ok) return 'task';
  if (res.intent.type === 'unrecognized') return 'unrecognized';
  return 'say';
}

const CAN_DO = 'I can adapt this page — try “bigger text”, “dark mode”, “high contrast”, or “read this” — and I’ll set up your profile if you tell me about your needs (“I’m blind”).';

/**
 * Nothing deterministic matched and there was nowhere to pass it. Say WHY —
 * usually "no app is connected", which is the actual reason a request like
 * "play a podcast from spotify" goes nowhere.
 */
export function fallbackHelp({ connected }) {
  if (!connected) {
    return 'Nothing is connected that could do that. I can only adapt this page and your profile right now — to run a request like that, connect an app first: Settings → Connect browser-harness. ' + CAN_DO;
  }
  return CAN_DO;
}

/**
 * The prompt the general-answer lane sends. Extracted so a change to the
 * assistant's framing is visible in a diff and in a test, rather than buried
 * in a template literal mid-function.
 */
export function generalAnswerPrompt(u) {
  return `You are the accessibility assistant inside a control surface. Answer the user's question briefly and plainly (2-3 sentences, no markdown). If it's about changing the page, remind them they can say things like "bigger text", "dark mode", "high contrast", "read this", or describe their needs like "I'm blind".\n\nUser: ${String(u).replace(/"/g, "'")}\nAnswer:`;
}
