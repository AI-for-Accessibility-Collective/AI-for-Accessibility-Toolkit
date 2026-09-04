// chat-turn.js — the routing decision behind every chat turn, lifted out of
// chat.js so it can be tested without a browser.
//
// chat.js still owns the turn's EFFECTS (drawing messages, speaking, focus,
// the busy latch). What lives here is the part that decides WHAT a turn is,
// which is the behavior worth pinning: the precedence between a controller
// command, a self-description, and everything else.
//
// Precedence, unchanged from the original inline ladder:
//   1. a reset phrase ("back to my profile") — a PROFILE operation, so it runs
//      before the grammar, or "reset my settings" would read as a settings
//      command.
//   2. a deterministic controller command ("bigger text", "read this") — these
//      are actions, never a profile edit, even though a word like
//      "distractions" also appears in the onboarding vocabulary.
//   3. otherwise a self-description ("I'm blind") → onboarding.
//   4. otherwise hand it to the controller, which may answer, run a task, or
//      report that it recognized nothing.

/**
 * Decide what a turn is. Pure: the three matchers are passed in, and nothing
 * here touches the DOM, the network, or module state.
 *
 * @returns {{kind: 'reset'|'onboard'|'controller', onboarding?: object}}
 */
export function routeTurn(text, { isResetToProfile, parse, detectOnboarding }) {
  const u = String(text || '').trim();
  if (!u) return { kind: 'controller' };

  if (isResetToProfile(u)) return { kind: 'reset' };

  // The grammar is checked only to see whether it claims the utterance. A hit
  // means "this is a command", which suppresses the onboarding heuristic.
  //
  // FLAG(review): this also swallows first-person disclosures whose condition is
  // itself a settings keyword. "I have dyslexia" parses as a dyslexia-font
  // command, so it changes the page for the session and never reaches the
  // profile, while "I'm blind" and "I have ADHD" (no matching keyword) do. The
  // asymmetry predates this file; see onboarding/test/chat-turn.test.mjs.
  if (!parse(u)) {
    const onboarding = detectOnboarding(u);
    if (onboarding) return { kind: 'onboard', onboarding };
  }
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
