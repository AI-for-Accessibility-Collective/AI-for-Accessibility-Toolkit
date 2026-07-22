# Contribution Card

Describe what your team is contributing to the toolkit. Takes ~15 min.

## Template

Copy and fill in when proposing a new capability.

---

```markdown
# Contribution: [Name]

**Code:** [repo URL or TBD]
**Team:** [institution, names]
**Contact:** [email]
**Status:** Idea / Prototype / Ready

## What it does

[2-3 sentences]

## Who it helps

- [ ] BLV (blind / low vision)
- [ ] DHH (deaf / hard of hearing)
- [ ] Motor (limited mobility / tremor)
- [ ] Cognitive (dyslexia / IDD / autism)
- [ ] Speech (atypical speech)
- [ ] Aging
- [ ] Photosensitive
- [ ] Anxiety
- [ ] Other: ___

## How it works

**Input:** [what it takes in]
> Examples: DOM elements, images, video, audio, text content, user speech...

**Output:** [what it produces]
> Examples: modified DOM, alt text, captions, simplified text, audio...

**Modality transform:** [if applicable]
> Examples: visual → audio, image → text, audio → captions, text → plain language

**Module type:**
- [ ] Transform — converts content across modalities (e.g. Adapter — fixes issues or provides visual/interaction presets)
- [ ] Analysis — detects issues or extracts information (e.g. Auditor)
- [ ] Memory — tracks user context across sessions
- [ ] Validation — human review of adaptations
- [ ] Knowledge — contributes to the shared corpus
- [ ] Other: ___ (e.g. Profile — tool configuration for a disability group)

## Technical

**Runs in browser?** Yes / Partially / No
**Latency:** Real-time / <1s / Processing time: ___
**Dependencies:** [libraries, APIs, models]

## How it fits in the toolkit

[How does this become an auditor, adapter, or profile? What existing components does it extend or replace?]

## What it pairs with

[Other team projects this connects to]

## Limitations

[Where does it break? What can't it handle?]

## Human involvement

[Does the user control it? Does output need review? How are PWD involved?]

## Data & Privacy

[Does it collect, store, or transmit user data? On-device vs. cloud?]

## Demo *(optional)*

[Link to demo, video, or screenshot]

## What the team needs

[Feedback, collaborators, resources?]
```

---

## Example

```markdown
# Contribution: Accessible Interactive Simulations

**Code:** TBD
**Team:** Stanford (Sean Follmer, Hari Subramonyam, Lakshmi Balasubramanian, David Lin)
**Contact:** dcelin@stanford.edu
**Status:** Prototype

## What it does

Generates interactive STEM simulations that BLV learners can explore through audio, text, and symbolic modalities. Educators describe a concept and the system builds a screen-reader compatible simulation with sonification and narration.

## Who it helps

- [x] BLV (blind / low vision)
- [x] Cognitive (dyslexia / learning differences)
- [x] Other: STEM educators

## How it works

**Input:** Natural-language description of STEM concept, or existing SVG/Canvas simulation
**Output:** Interactive simulation with sonification, narration, equations, keyboard controls
**Modality transform:** Visual → audio, text, symbolic

**Module type:**
- [x] Transform — converts inaccessible simulations to audio, text, and symbolic modalities
- [x] Knowledge — contributes sonification mappings and BLV benchmarks to the corpus

## Technical

**Runs in browser?** Yes
**Latency:** Real-time
**Dependencies:** Tone.js, Paper.js, Claude/Gemini (one-time generation)

## How it fits in the toolkit

Contributes a visual-to-audio adapter for dynamic STEM content that screen readers can't reach. Could feed the corpus with sonification mappings and BLV evaluation benchmarks.

## What it pairs with

- UCL Non-Standard Speech — for BLV learners with atypical speech
- The Arc — for plain-language narration
- Google NAI — as the orchestrator

## Limitations

2D simulations only. Audio gets cluttered with too many variables. Some sonification mappings are intuitive (pitch = height), others take practice (pitch = density).

## Human involvement

Learner drives exploration via keyboard. Educators review generated simulations before classroom use. No AI in the interaction loop at runtime.

## Data & Privacy

Runs entirely in-browser. No user data leaves the device. Initial LLM call sends only the educator's concept description.

## Demo

5 physics concepts prototyped: spring motion, Doppler effect, electromagnetic spectrum, radioactive decay, orbital mechanics.

## What the team needs

Connecting with educators, learners, and accessibility researchers. Understanding real classroom constraints in accessible STEM education.
```

---

Submit via PR or email dcelin@stanford.edu.
