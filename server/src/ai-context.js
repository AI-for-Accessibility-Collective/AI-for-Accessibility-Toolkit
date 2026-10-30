// Who an AI model call is for and why: {uid, purpose}. The Librarian calls
// the model through one caller (gemini.js) that only sees the prompt, so the
// service sets this around each Librarian call (app.js: the route name;
// learning.js: the learning step) and the caller's log line reads it.

import { AsyncLocalStorage } from 'node:async_hooks';

export const aiContext = new AsyncLocalStorage();

/** Run `fn` with the account and purpose any AI call inside it is logged under. */
export const withAiContext = (uid, purpose, fn) => aiContext.run({ uid, purpose }, fn);
