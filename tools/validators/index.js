// Validators — the third element type.
//
//   auditor    finds a defect in the page
//   adapter    changes the page
//   validator  surfaces a verification question to the PERSON and captures
//              their answer
//
// A validator never touches the page. It reads what the reader observed,
// compares it against the person's contract, and — when something is worth
// their attention — says so and offers a choice. Adapters act on the DOM;
// validators act on the human.
//
// Every validator names the `signal` it verifies and the `breakdown` it exists
// for, so each one traces back to a specific observed failure rather than a
// general worry about agents.

/**
 * @typedef {'state'|'constraint'|'magnitude'|'provenance'|'freshness'|'consequence'} InfoType
 *   The six kinds of verification-relevant information. A validator handles one.
 *
 * @typedef {'ambient'|'aside'|'stop'} Insistence
 *   ambient — silent unless it conflicts with the contract. Most live here.
 *   aside   — one line spoken; the agent continues unless the person cuts in.
 *   stop    — blocks. The agent waits for an answer.
 *
 * @typedef {'S'|'B'|'SA'|'BA'} Persona
 *   Sighted, BVI, Sighted+agent, BVI+agent — the four in the signal map.
 *
 * @typedef {Object} Finding
 * @property {string}  signal      Which signal in the task map this concerns.
 * @property {*}       observed    What the reader actually saw on the page.
 * @property {*}       [expected]  What the contract said, when there is one.
 * @property {boolean} reversible  Can this still be undone at this moment?
 * @property {number}  seenAt      Timestamp from the clock port.
 *
 * @typedef {Object} Choice
 * @property {string} label   What the person picks, in their words.
 * @property {string} tell    What the agent is told when they pick it.
 * @property {boolean} [rule] Offer to make this a standing rule afterwards.
 *
 * @typedef {Object} Validator
 * @property {string}   id
 * @property {string}   name
 * @property {string}   signal        Signal from the map this verifies.
 * @property {string}   breakdown     The observed breakdown it exists for.
 * @property {InfoType} infoType
 * @property {Persona[]} personas     Who actually needs this one.
 * @property {(f: Finding) => boolean} triggers  Does this finding concern me?
 * @property {(f: Finding) => string}  say        The first sentence spoken.
 *                                                Written to sound like a person.
 * @property {(f: Finding) => Choice[]} choices
 * @property {Insistence} [floor]     Never quieter than this, whatever the
 *                                    policy computes. Used for the airlock.
 */

export { CountFirst } from './count-first.js';
