# Team Projects

> Canonical list of collective projects. README and architecture.md summarize this file.

Contributions from teams across the AI for Accessibility collective.

> Canonical list of collective projects. README and architecture.md summarize this file.

---

## Google — Natively Adaptive Interfaces (NAI)

**Code:** https://github.com/paradigms-of-intelligence/ai-for-accessibility
**Team:** Google (Anoop Sinha, Liz Jenkins, Shruti Sheth, Shaun Kane, Philip Nelson, Renelito Delos Santos, Sam Sepah, Alexander Hauerslev Jensen)
**Contact:** anoopsinha@google.com
**Status:** Demo app

### What it does

Embeds multimodal AI agents directly into the application stack so digital experiences adapt in real-time to each user's accessibility needs. The demo creates a recipes website with an adaptive agent that helps users navigate via voice commands.

### Who it helps

All profiles — BLV, DHH, motor, cognitive, speech, aging.

### How it works

- **Input:** Voice commands triggered by shortkey
- **Output:** Adapted interface, captions, text-to-speech
- **Latency:** <2 seconds per command
- **Dependencies:** Gemini API

### Limitations

Custom demo site only — does not generalize yet. Does not handle screen readers.

---

## Stanford — Accessible Interactive Simulations

**Code:** TBD
**Team:** Stanford (Sean Follmer, Hari Subramonyam, Lakshmi Balasubramanian, David Chuan-En Lin)
**Contact:** dcelin@stanford.edu
**Status:** Prototype

### What it does

Generates interactive STEM simulations that BLV learners can explore through audio, text, and symbolic modalities. Educators describe a concept in natural language and the system builds a screen-reader compatible simulation with sonification and narration.

### Who it helps

- BLV (blind / low vision)
- Cognitive (dyslexia / learning differences)
- STEM educators

### How it works

- **Input:** Natural-language description of a STEM concept, or existing web simulation (SVG/Canvas)
- **Output:** Interactive simulation with sonification, narration, equations, keyboard controls
- **Transform:** Visual → audio, text, symbolic
- **Latency:** Real-time
- **Dependencies:** JavaScript, Claude/Gemini, Tone.js, Paper.js

### Limitations

2D simulations only. Audio gets cluttered with too many variables. Some sonification mappings are intuitive (pitch = height), others take practice.

### Demo

5 physics concepts prototyped: spring motion, Doppler effect, electromagnetic spectrum, radioactive decay, orbital mechanics.

---

## MIT Media Lab — Universal Memory Assistant

**Code:** https://github.com/wazeerzulfikar/memoro/tree/main
**Team:** MIT Media Lab (Yasith Samaradivakara, Wazeer Zulfikar, Pattie Maes)
**Contact:** yasith@media.mit.edu / wazeer@media.mit.edu
**Status:** TBD

### What it does

A wearable memory assistant for older adults. Models the user's behavior from first-person data and supports real-time memory needs during everyday tasks.

### Who it helps

- Aging
- Cognitive

### How it works

- **Input:** First-person data from wearable sensors (camera, microphone)
- **Output:** Real-time memory assistance (audio in ear)
- **Module type:** Memory — tracks user context across sessions

### Limitations

Human behavior, memory needs, age, and social context vary widely. Designing for that range is the main open problem.

---

## UW — AI-Augmented Storytelling

**Code:** TBD
**Team:** University of Washington (Arnavi Chheda-Kothary, Jon Froehlich, Jacob Wobbrock)
**Contact:** chheda@cs.washington.edu
**Status:** In development

### What it does

AI-augmented storytelling and creative-artifact production with blind and low-vision children. Gives BLV kids accessible ways to express themselves through image generation and verification, sharing creative work with sighted family, friends, and teachers.

### Who it helps

- BLV (blind / low vision)
- Mixed-ability families and classrooms

### How it works

- **Input:** Audio narration, story text, possible sketches/drawings
- **Output:** Generated stories, illustrations, audio narratives with accompanying image descriptions
- **Transform:** Voice + text + drawings → generated images + descriptions
- **Dependencies:** VLM for image + text interpretation and generation; STT for children's narrations

### Human involvement

BLV children, families, and teachers as co-designers

---

## UW — AI-Powered Artwork Interpretation (ArtInsight)

**Code:** https://github.com/makeabilitylab/ArtInsight/blob/main/README.md
**Team:** University of Washington (Arnavi Chheda-Kothary, Jon Froehlich, Jacob Wobbrock)
**Contact:** chheda@cs.washington.edu
**Status:** Published

### What it does

ArtInsight is an iOS app to support parents who are blind or have low-vision (BLV) to engage with their sighted children's artwork. Uses GPT to generate accessible descriptions of artwork, with a human-in-the-loop system for editing.

### Who it helps

- BLV (blind / low vision)
- Mixed-ability families and classrooms

### How it works

- **Input:** Child-created 2D visual artwork (drawing, painting), optional audio context
- **Output:** Blind-accessible descriptions of artwork
- **Transform:** Visual + voice → text descriptions
- **Latency:** ~20 seconds to generate descriptions

### Demo

https://www.youtube.com/watch?v=pahmaPzoPgo

---

## UCL GDI Hub — Non-Standard Speech AI

**Code:** https://huggingface.co/cdli
**Team:** UCL GDI Hub (Katrin Tomanek, Cathy Holloway, Richard Cave, Benen Cahill, Chintan Ghate, Elizabeth Mwangi)
**Website:** cdl-inclusion.com
**Status:** 13 models published

### What it does

Makes AI speech systems work for people with non-standard speech by combining inclusive data, adapted models, and community-led deployment. Fine-tunes Whisper on community-collected data from speakers with speech impairments across multiple underrepresented language communities.

### Who it helps

- Speech (nonverbal / atypical speech)
- Developers, researchers, clinicians building inclusive speech tech

### How it works

- **Input:** Audio from speakers with non-standard speech
- **Output:** Transcribed text via fine-tuned Whisper ASR models
- **Transform:** Non-standard speech → text
- **Dependencies:** Whisper (whisper-large-v3, whisper-small, whisper-tiny variants)

### Published resources

- 13 Whisper fine-tunes across language communities
- Datasets: Ugandan Luganda (8.1k samples), Ugandan English (7.3k), Kenyan Swahili (5.5k), Kenyan English (6k), Ghanaian Ga (12.2k)

### Limitations

Coverage specific to collected speaker groups. Extending to new languages requires community-led data collection.

---

## UCL GDI Hub — Founders Think

**Code:** TBD
**Team:** UCL GDI Hub (Cathy Holloway, Justin Jesudas, Katrin Tomanek, Noah Bernstein, Richard Cave, Tigmanshu Bhatnagar)
**Status:** TBD

### What it does

An AI "tool for thought" for founders building disability innovations. Translates dense disability-innovation theory into simple workflows that founders can apply when creating, funding, or scaling assistive ventures.

### Who it helps

- Disabled founders
- Disability-innovation ecosystem actors
- Downstream: all disability communities through shipped ventures

### How it works

- **Input:** Founder's problem framing, venture stage, context
- **Output:** Reflection prompts, next-step recommendations, framework-grounded workflows

---

## RNID — Videoconferencing Agent

**Code:** https://github.com/Action-on-Hearing-Loss/rnid-meeting-agent
**Team:** RNID (Alastair Moore, Lauren Ward, Chris Baume, Ruari Molyneux)
**Contact:** Alastair Moore
**Status:** Zoom app, refactoring to modular architecture

### What it does

A real-time AI agent that advocates for DHH participants in videoconferencing meetings. Analyzes video and audio and suggests practical accessibility changes to other participants (turn camera on, take turns speaking).

### Who it helps

- DHH (deaf / hard of hearing)
- Hearing participants (behavior nudges)

### How it works

- **Input:** Live video, audio, text streams from Zoom (Meet/Teams planned)
- **Output:** Real-time accessibility suggestions to participants
- **Module type:** Analysis + Platform adapter

### Limitations

Currently analyzes speaker accessibility only (face on screen, lips visible). Does not infer listener state. Zoom-only today.

---

## NTID — AI-Powered Tutoring Agent (GrammarLab)

**Code:** TBD
**Team:** NTID (Pamela Francis, Justin Mahar, Becca Dingman)
**Contact:** pggncp@rit.edu
**Status:** In development

### What it does

A course-driven tutoring system that lets instructors design personalized, AI-guided learning experiences using structured content, prompts, and multimedia (including ASL videos). Students interact with a chat-based tutor that adapts instruction, pacing, and feedback to their progress and preferences. The flagship course, GrammarLab, focuses on teaching English articles to DHH learners, combining ASL-based instruction with targeted writing feedback.

### Who it helps

- DHH (deaf / hard of hearing)
- ASL-first learners

### How it works

- **Input:** Student text input via chat, uploaded student writing
- **Output:** Instructional text, grammar corrections, guided exercises, quizzes, embedded ASL videos, interactive UI components
- **Platform:** Progressive Web App (React, Gatsby, Firebase, Netlify)
- **Dependencies:** Gemini API, Firebase Authentication, video hosting (YouTube/Vimeo) for ASL content
- **Latency:** Several seconds per response

### Limitations

Response latency can be several seconds. Current implementation focused on English articles. Relies on pre-recorded ASL videos (no real-time ASL generation). AI may produce incorrect or oversimplified explanations for nuanced grammar.

---

## The Arc — AI for Cognitive Accessibility

**Code:** TBD
**Team:** The Arc of the United States (Ben Freda, Katy Schmid)
**Status:** TBD

### What it does

Uses AI to make content more cognitively accessible for people with intellectual and developmental disabilities. Goals: greater independence and autonomy through clearer, simpler content.

### Who it helps

- Cognitive (dyslexia / IDD / autism)
- Broader population via curb-cut effect

### How it works

- **Input:** Web content, documents, or media with cognitive barriers
- **Output:** Simplified content
- **Transform:** Complex text → plain language, dense content → simpler structure

---

## How Projects Connect

```
┌─────────────────────────────────────────────────────────────────┐
│                     Chrome Extension                             │
│  (auditors, adapters, profiles)                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Stanford ──────► Sonification adapters for STEM content       │
│   The Arc ───────► Text simplification adapters                 │
│   UCL Speech ────► ASR for non-standard speech input            │
│   RNID ──────────► Meeting accessibility patterns               │
│   MIT Memory ────► User context tracking                        │
│   UW Stories ────► Creative expression for BLV kids             │
│   NTID Tutoring ─► Grammar scaffolds for DHH                    │
│   Google NAI ────► Orchestration patterns                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

Projects contribute as auditors, adapters, or profiles — or inform the design of these components through research.
