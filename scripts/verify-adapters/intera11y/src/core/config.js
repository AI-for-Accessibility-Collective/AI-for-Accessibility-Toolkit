'use strict';
// Not InterA11y's: the part of its config that the vendored rubric and
// prompt read (src/judge/prompt.js). The original also loads its own .env
// and chooses a browser and a model, which the verifier does itself.
const CONFIG = {
  viewport: { width: 1280, height: 900, deviceScaleFactor: 1 },
  judge: { rubric: 'v2', tools: true },
};
module.exports = { CONFIG };
