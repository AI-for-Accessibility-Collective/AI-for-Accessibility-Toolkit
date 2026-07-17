> Internal design document — describes a proposal/point-in-time snapshot, not necessarily current behavior.

# Generative Ephemeral UI for Accessibility

Research direction brainstorm — May 2026

## Core Insight

The strongest accessible ephemeral UI isn't about **fixing broken widgets**. It's about **AI understanding content and generating new representations** personalized to user needs.

Three levels of transformation:
- **Component**: Swap widget (date picker → native input) — *weakest, just fixing dev mistakes*
- **Page**: Restructure layout — *medium*
- **Content**: Re-represent information — *strongest, requires AI understanding*

---

## Strongest Examples

### 1. Data Dashboard → Narrative
**Original**: Complex visual dashboard with charts, KPIs, trends scattered across screen  
**Generated**: "Your portfolio is up 3% this week. Tesla drove most gains. Alert: bond allocation below target."  
**Why strong**: AI synthesizes, prioritizes, personalizes. Not describing charts — *explaining what matters*.

### 2. Canvas App/Simulation → Parallel Text UI
**Original**: PhET simulation, game, interactive canvas with no screen reader access  
**Generated**: Real-time state narration: "Ball at position (3,5), velocity 2m/s right, approaching wall"  
**Why strong**: AI observes dynamic state and creates live accessible representation. Ties to David's postdoc work on sonification.

### 3. Complex Form → Conversational Flow
**Original**: 50-field government form with conditional logic, jargon, validation  
**Generated**: "Let's start simple. What's your name?" → guided wizard with plain language  
**Why strong**: AI understands form *purpose*, not just structure. Reduces cognitive load dramatically.

### 4. Video → Multi-modal Experience  
**Original**: Video with no captions  
**Generated**: Captions + audio descriptions + chapters + searchable transcript + "key moments" summary  
**Why strong**: AI adds multiple accessibility layers. User chooses modality.

### 5. Map/Directions → Narrative Navigation
**Original**: Google Maps visual interface, pins, routes  
**Generated**: "Walk 2 blocks past the coffee shop, turn left at the red building, destination is 3rd door on right"  
**Why strong**: Spatial → sequential. AI adds landmarks, context. Not "turn left in 200 feet" but meaningful descriptions.

### 6. Dense Article → Personalized Summary
**Original**: 5000-word research paper, legal document, policy  
**Generated**: "This paper claims X. Evidence: Y. Limitations: Z. Relevant to your work because: W."  
**Why strong**: AI understands content AND user context. Different summary for different users.

### 7. E-commerce Page → Decision Support
**Original**: Cluttered product page — specs, reviews, related items, ads  
**Generated**: "This laptop: $999, 16GB RAM, fits your needs. 4.2 stars, main complaint: battery. Better option exists at +$50."  
**Why strong**: AI synthesizes and *advises*, not just describes.

### 8. Image-Heavy Page → Structured Content
**Original**: Pinterest grid, infographics, memes, screenshots of text  
**Generated**: Categorized, described, searchable. Key images expanded, decorative images hidden.  
**Why strong**: AI extracts meaning from visual chaos.

### 9. Social Feed → Curated Digest
**Original**: Infinite scroll, algorithmic chaos  
**Generated**: "3 posts from close friends, 1 breaking news, 2 posts on topics you follow"  
**Why strong**: AI filters and prioritizes. Reduces overwhelm.

### 10. Dynamic Web App → Intelligent Announcer
**Original**: React SPA with constant DOM updates, no ARIA live regions  
**Generated**: Smart announcements: "New message from Sarah" not "3 DOM elements updated"  
**Why strong**: AI knows what's *meaningful* to announce.

---

## Common Patterns in Strongest Examples

1. **Understanding over fixing** — AI comprehends content, not just patches code
2. **Synthesis** — AI combines, summarizes, prioritizes (not 1:1 translation)
3. **Personalization** — Output adapts to user context, needs, preferences
4. **Modality translation** — Visual/spatial → text/audio/sequential
5. **Proactive assistance** — AI anticipates needs, doesn't wait for user to struggle

---

## What Makes It "Ephemeral"

- No source code changes — works on any site
- Generated at runtime — adapts to current state
- User-steerable — can request adjustments
- Session-scoped — doesn't persist (unless user saves)

---

## Research Angles

### Steerable Abstractions Connection
The generated UI *is* a steerable abstraction. User can:
- Request more/less detail
- Change modality (text → audio → simplified)
- Adjust personalization ("assume I'm an expert" vs "explain like I'm new")

### Evaluation Questions
- How do we measure quality of generated alternatives?
- What's the latency tolerance for ephemeral generation?
- How do we handle errors/hallucinations in accessibility-critical context?
- How do users discover and steer the generated UI?

---

## Hackathon Target (May 2026)

**Primary**: Canvas simulation → parallel text UI (most aligned with postdoc, impressive demo)  
**Backup**: Data visualization → narrative summary (easier, still compelling)  
**Simple**: Date picker → accessible input (achievable but less "generative")

---

## Related Work

- Screen readers (assistive, not generative)
- Auto-alt-text (generative but narrow)
- Simplification tools (generative but text-only)
- Browser reader modes (structural, not semantic)
- **Gap**: No tool generates *personalized, semantic, multi-modal* alternatives at page/content level
