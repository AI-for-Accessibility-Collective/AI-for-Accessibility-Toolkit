# ArtInsight

Distilled knowledge from the **ArtInsight** project (UW Makeability Lab + ACE Lab,
IUI 2025) — an iOS app and evaluation harness that produces respectful,
observation-first descriptions of visual artwork for blind and low-vision (BLV)
parents engaging with their sighted children's work.

Source: `../../../ArtInsight/` (sibling repo). Primary references:
- Canonical system prompt: `Artwork-Description-Scoring/generate_descriptions_gpt4o.py:36`
- 16-point scoring rubric: `Artwork-Description-Scoring/description_scorer.py:52`
- iOS pipeline: `Mixed-Ability-Artwork/Mixed-Ability-Artwork/Services/Open AI/`

## Scope

Apply when the consumer is generating descriptions of **images that are themselves
artwork** — child drawings, paintings, museum/gallery works, illustrations — where
generic alt-text prompts tend to produce reductive or presumptive output.

Do *not* apply to UI screenshots, photos of documents, charts, or product images;
the prompt's anti-reductive guardrails are tuned for creative work, not utility
imagery.

## What's empirically established

From the ArtInsight scoring harness (30 artwork samples, 16-point rubric):

| Model              | Avg score |
|--------------------|-----------|
| GPT-4o Mini        | 15.97     |
| GPT-4o             | 15.73     |
| Claude 3.5 Sonnet  | 14.87     |
| GPT-4 Turbo        | 14.70     |
| Gemini 1.5 Flash   | 11.50     |

GPT-4o Mini is the recommended default — comparable quality at ~2x speed and ~1/3
the cost of GPT-4o. Temperature 0.25 produced the best results.

## Exports

All exports live in [`index.js`](./index.js):

- **`systemPrompt`** ([index.js:11](./index.js#L11)) — the canonical system prompt
  used by ArtInsight's production iOS app and scoring harness. Observation-first,
  forbids reductive language, forbids identity inference from text in the image.

- **`rubric`** ([index.js:35](./index.js#L35)) — the four 4-point criteria as
  structured data: `nonPresumptive`, `nonReductive`, `sufficientDetail`,
  `completeElements`, plus a `miscellaneous` deduction bucket.

- **`scoreDescription(description, ai)`** ([index.js:74](./index.js#L74)) — async
  function that asks an LLM to score a description against the rubric.
  `ai` should expose a `complete(systemPrompt, userMessage)` method matching the
  toolkit's [utils/ai.js](../../utils/ai.js) provider shape.

- **`triadPrompts`** ([index.js:108](./index.js#L108)) — user-message prompts for
  the three output modes ArtInsight surfaces to the parent: *descriptive*
  (observation-only), *creative* (interpretive), and *questions* (dialogue
  starters). The iOS app stores these as three separate files per artwork.

- **`config`** ([index.js:130](./index.js#L130)) — recommended model
  (`gpt-4o-mini`), temperature (0.25), max tokens (512).

- **`shouldApply(context)`** ([index.js:140](./index.js#L140)) — heuristic for
  when to swap the default `describeImage()` prompt for ArtInsight's. Currently:
  museum/gallery host allowlist, `<figure>` density, or an explicit profile flag.

## How consumers use it

```js
// Skill: route artwork images through the ArtInsight prompt
import { systemPrompt, config, shouldApply } from '../../tools/insights/artinsight/index.js';
import { describeImage } from '../../tools/utils/ai.js';

if (shouldApply({ host: location.host, doc: document })) {
  const alt = await describeImage(dataUrl, { systemPrompt, ...config });
  img.alt = alt;
}
```

```js
// Auditor: score generated alt text against the rubric, regardless of source
import { scoreDescription } from '../../tools/insights/artinsight/index.js';

const { total, breakdown } = await scoreDescription(img.alt, ai);
if (total < 12) flagLowQualityAlt(img, breakdown);
```

## Provenance and citation

ArtInsight is research from the [Makeability Lab](https://makeabilitylab.cs.washington.edu/)
and [ACE Lab](https://depts.washington.edu/acelab/) at the University of
Washington. Licensed MIT, Copyright (c) 2024 UW Makeability Lab. Supported in
part by NSF grant 2125087 and The Mani Charitable Foundation.

If this knowledge informs published work or production features, cite:

> Arnavi Chheda-Kothary, Ritesh Kanchi, Chris Sanders, Kevin Xiao, Aditya
> Sengupta, Melanie Kneitmix, Jacob O. Wobbrock, and Jon E. Froehlich. 2025.
> ArtInsight: Enabling AI-Powered Artwork Engagement for Mixed Visual-Ability
> Families. In *30th International Conference on Intelligent User Interfaces
> (IUI '25)*, March 24–27, 2025, Cagliari, Italy. ACM.
> https://doi.org/10.1145/3708359.3712082

The system prompt, rubric, and triad prompts reproduced here are copied verbatim
from the source repo — keep them in sync if upstream changes.

## Known gaps

- The rubric is currently used as an **evaluator** (post-hoc scoring). Whether
  feeding the rubric criteria *into* the generation prompt as guardrails improves
  output is untested upstream — worth measuring before rolling out.
