# Agent Card

Describe what your project does as an adaptation agent. Takes ~15 min.

## Template

Copy into `projects/your-project/AGENT_CARD.md` and fill in.

---

```markdown
# Agent Card: [Project Name]

**Team:** 
**Contact:** 
**Status:** Idea / Prototype / Production

## What it does

[2-3 sentences — what does the agent do?]

## Who it helps

Check all that apply:

- [ ] BLV (blind / low vision)
- [ ] DHH (deaf / hard of hearing)
- [ ] Motor (limited mobility / tremor)
- [ ] Cognitive (dyslexia / IDD / autism)
- [ ] Speech (nonverbal / atypical speech)
- [ ] Aging
- [ ] Other: ___

## How it works

**Input:** [what it takes in]
> Examples: web page DOM, video/audio stream, camera feed, image file, design artifact (Figma/wireframe), user speech, text content, ...

**Output:** [what it produces]
> Examples: modified HTML, audio stream, text description, accessibility report, captions, ...

**Modality transform:** [if applicable]
> Examples: visual → audio, image → text description, audio → captions, text → plain language, or N/A

**Module type:**
- [ ] Transform — converts content across modalities (e.g., sonification, image descriptions, captioning)
- [ ] Analysis — detects issues or extracts information (e.g., WCAG violations, face visibility, missing alt text)
- [ ] Memory — tracks user context across sessions (e.g., browsing history, past preferences, "you were here before")
- [ ] Validation — human review of adaptations (e.g., PWD testers verify the output works)
- [ ] Knowledge — contributes to the shared corpus (e.g., guidelines, benchmarks, evaluation criteria)
- [ ] Other: ___

## Technical

**Runs in web browser?** Yes / Partially / No — if not, what would it take to get there?
**Latency:** Real-time / Processing Time: ___
**Dependencies:** [libraries, models, APIs, hardware]
> Examples: TensorFlow, MediaPipe, microphone, camera, ...

**Code:** [repo URL, language]
**Timeline to contribute:** Ready now / Weeks / Months / Needs discussion

## Limitations

[Where does it break? What can't it handle?]
> Examples: "Only works on English-language sites." "Can't handle Canvas/WebGL content." "Captions degrade on accented speech." "Needs internet — no offline mode." This helps other teams know it's limitations and how to support it.

## Human involvement

[Does the user control it? Does output need review? How are people with disabilities involved?]
> Examples: "User adjusts font size and contrast via a settings panel." "AI suggestions reviewed by a human before applying." "PWD reviewers validate output."

## Data & Privacy

[Does the agent collect, store, or transmit user data?]
> Examples: "Stores user preferences locally." "Audio processed on-device." "Requires user profile with encrypted storage, user controls deletion."

## Demo *(optional)*

[Link to a live demo, video, or screenshot so others can see it in action.]

## Evaluation *(optional)*

[How to tell if it's working? What does success look like?]
> Examples: "Task completion rate ≥80% for BLV users." "Caption accuracy ≥95%." "Users find items 2x faster with memory aid."
```

---

## Example

```markdown
# Agent Card: Generative Accessible Simulations

**Team:** Stanford (Sean Follmer, Hari Subramonyam, David Lin)
**Contact:** David Lin, dcelin@stanford.edu
**Status:** Prototype

## What it does

Sonifies dynamic and interactive web content so blind and low-vision users can experience it through audio. The user explores by adjusting parameters with keyboard and hearing what happens. Works for simulations, interactive visualizations, and other dynamic media where the visual content changes in real-time.

## Who it helps

- [x] BLV (blind / low vision) — real-time sonification of dynamic content, keyboard controls
- [x] Cognitive (dyslexia / IDD / autism) — simplified representations, scaffolded exploration

## How it works

**Input:** Dynamic web content (SVG/Canvas simulations, interactive visualizations) or a description of a concept to generate a simulation for.
**Output:** Real-time audio (sonification), text narration, equations — all linked to the visual, all updating together as the user explores.
**Modality transform:** visual → audio, visual → text, visual → symbolic
**Module type:**
- [x] Transform — sonifies dynamic/interactive media that screen readers can't access

## Technical

**Runs in web browser?** Yes — all audio and rendering runs in-browser.
**Latency:** Real-time
**Dependencies:** Tone.js, Paper.js, LLM API, Next.js
**Code:** github.com/chuanenlin/generative-accessible-simulations
**Timeline to contribute:** Weeks

## Limitations

2D simulations only (no 3D yet). Audio gets cluttered with too many variables at once. Some audio mappings are intuitive (pitch = height), others take practice to learn (pitch = density).

## Human involvement

User controls exploration — adjusts parameters via keyboard, chooses what maps to pitch vs. volume. No AI in the loop at runtime (sonification is deterministic). User studies with blind students and teachers of the visually impaired planned.

## Data & Privacy

Everything runs in-browser, no data sent anywhere. The one-time LLM call sends the concept description, not user info.

## Demo

5 physics concepts prototyped (spring motion, Doppler, spectrum, decay, orbital mechanics). Link TBD.

## Evaluation

Can a blind user answer "what happens when you double the mass?" using only audio? Target: ≥80% correct, learning gap within 15% of sighted users.
```

---

Submit via PR to `projects/your-project/AGENT_CARD.md`, or email dcelin@stanford.edu / yasith@mit.edu.
