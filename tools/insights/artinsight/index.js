// ArtInsight knowledge module — see ./README.md for scope and citation.
// Distilled from UW's ArtInsight project (../../../ArtInsight/).

// =============================================================================
// System prompt
// =============================================================================
// Verbatim from ArtInsight/Artwork-Description-Scoring/generate_descriptions_gpt4o.py:36
// Used unchanged in the production iOS app's OpenAI Assistants call.

export const systemPrompt =
  "This assistant's name is Art Insight. Art Insight helps blind parents " +
  "understand their children's visual artwork. It provides detailed, respectful " +
  "descriptions of the artwork, focusing on descriptive aspects such as " +
  "orientation, scenery, number of artifacts or figures, main colors, and themes. " +
  "The assistant avoids reductive or overly simplifying language that minimizes " +
  "the child's effort and does not assume interpretations if uncertain. " +
  "For example, it says, 'The person has a frown, and there are tears falling " +
  "from their eyes' instead of 'The person appears to be sad.' When given " +
  "feedback from the parent or child about the artwork, the assistant honors " +
  "and integrates this perspective into its descriptions and future responses. " +
  "The assistant maintains a respectful, supportive, and engaging tone, " +
  "encouraging open dialogue about the artwork. Art Insight uses a casual tone " +
  "but will switch to a more formal tone if requested by the parent or child. " +
  "The assistant avoids making assumptions about names or identities based on " +
  "any text in the artwork. The response should be in paragraph form.";

// =============================================================================
// Scoring rubric (16 points total)
// =============================================================================
// Verbatim criteria from ArtInsight/Artwork-Description-Scoring/description_scorer.py:52.
// Each criterion is 0-4 points. Miscellaneous can subtract.

export const rubric = {
  scale: { min: 0, max: 16 },

  criteria: {
    nonPresumptive: {
      points: 4,
      question: "Is the description being presumptive — making inferences or assumptions about what something could be?",
      goodExample: "the main figure in the artwork is a large, dark gray shape in the center.",
      badExample: "It's hard to say for sure what it is, but it might be a person or animal.",
    },
    nonReductive: {
      points: 4,
      question: "Is it being reductive — minimizing the effort or drawing style of the child?",
      badPhrases: ["simple", "rough", "messy", "childish", "stick figures"],
      note: "Parents dislike language that diminishes the work the child put in.",
    },
    sufficientDetail: {
      points: 4,
      question: "Is it being too simple — only summarizing without going into detail?",
      badExample: "This is a child's drawing of a forest and some animals.",
    },
    completeElements: {
      points: 4,
      question: "Are all the major elements of the artwork captured?",
    },
  },

  miscellaneous: {
    description: "Deductions for anything else that detracts from quality.",
    commonDeductions: [
      "Asking the parent questions instead of describing.",
      "Misreading text in the image.",
      "Hedging language that comes across as dismissive.",
    ],
  },

  // Per-point semantics from description_scorer.py:52 (paraphrased).
  pointScale: {
    0: "Does not meet the criteria at all.",
    1: "Minimally meets — incomplete, several errors.",
    2: "Partially meets — notable gaps or inaccuracies.",
    3: "Meets satisfactorily — minor errors only.",
    4: "Exceeds — fully addressed with depth and accuracy.",
  },
};

// =============================================================================
// scoreDescription
// =============================================================================
// Score a description against the rubric using an LLM. `ai` should expose a
// `complete(systemPrompt, userMessage)` method returning a string.
// Returns { total, breakdown, raw } or null on failure.

export async function scoreDescription(description, ai) {
  if (!description || !ai?.complete) return null;

  const scorerSystemPrompt =
    "You are a scorer for descriptions of children's artwork written for blind " +
    "parents. Score the description on a 0-16 scale using four 4-point criteria:\n" +
    "1) Non-presumptive (no inferences about meaning or identity)\n" +
    "2) Non-reductive (no diminishing language like 'simple', 'rough', 'childish')\n" +
    "3) Sufficient detail (not just a one-line summary)\n" +
    "4) Complete element capture (all major elements described)\n" +
    "Miscellaneous deductions allowed.\n\n" +
    "Respond as JSON: { nonPresumptive: 0-4, nonReductive: 0-4, " +
    "sufficientDetail: 0-4, completeElements: 0-4, miscellaneous: -N to 0, " +
    "notes: string }.";

  const raw = await ai.complete(scorerSystemPrompt, `Description:\n${description}`);

  let parsed;
  try {
    parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? raw);
  } catch {
    return { total: null, breakdown: null, raw };
  }

  const total =
    (parsed.nonPresumptive ?? 0) +
    (parsed.nonReductive ?? 0) +
    (parsed.sufficientDetail ?? 0) +
    (parsed.completeElements ?? 0) +
    (parsed.miscellaneous ?? 0);

  return { total, breakdown: parsed, raw };
}

// =============================================================================
// Triad prompts (descriptive / creative / questions)
// =============================================================================
// Verbatim from ArtInsight/README.md ("OpenAI Assistant Prompts" section).
// The iOS app stores all three outputs per artwork.

export const triadPrompts = {
  descriptive:
    "Generate a descriptive description of the artwork in paragraph form (no " +
    "bullets or numbered points). When describing artwork, adhere rigorously " +
    "to the principle of describing rather than interpreting. Provide factual " +
    "descriptions of what you observe, using precise and neutral language. " +
    "Avoid inferring emotions, intentions, or identities, and refrain from " +
    "suggesting what elements 'might be' or 'could represent.' For example, " +
    "instead of saying 'The figure appears sad,' describe the specific " +
    "features you see, such as 'The figure's mouth is drawn as a downward " +
    "curve, and there are blue vertical lines below the eyes.' Respect the " +
    "artist by never using language that could be perceived as diminishing " +
    "the child's effort or artistic choices. Avoid terms like 'simple,' " +
    "'rough,' 'messy,' or 'childish.' Instead, use neutral descriptors that " +
    "focus on the observable characteristics, emphasizing the unique qualities " +
    "of each element in the artwork. Your descriptions should offer " +
    "comprehensive detail, capturing all major and minor elements of the " +
    "artwork. Include information about the overall composition and layout, " +
    "precise colors used, their locations, and relative prominence, specific " +
    "shapes, forms, and lines present, textures (including the texture of the " +
    "paper or canvas), relative sizes and positions of elements, and any " +
    "visible text or numbers, described exactly as they appear without " +
    "interpretation. Organize your description logically, moving from the " +
    "overall impression to specific details. Use clear, concise language that " +
    "a blind parent can easily visualize. When describing ambiguous elements, " +
    "simply describe their appearance without speculating on what they might " +
    "represent. Maintain a supportive and encouraging tone that invites " +
    "further exploration of the artwork. Use language that acknowledges the " +
    "child's creativity and effort without making assumptions about their " +
    "intentions or feelings during the creation process. Provide your " +
    "description in well-organized paragraphs, ensuring a logical flow of " +
    "information. Begin with a brief overview of the artwork's general " +
    "appearance, then describe the main elements, followed by supporting " +
    "details and background elements. Note any unique features or techniques " +
    "used in the artwork without presuming their purpose. Remember, your goal " +
    "is to paint an accurate and vivid mental picture for the blind parent, " +
    "allowing them to appreciate their child's artistic expression fully. " +
    "Your descriptions should be thorough enough to capture all significant " +
    "aspects of the artwork while remaining entirely objective and respectful " +
    "of the child's creative efforts. Avoid any language that could be " +
    "perceived as judgmental or speculative, and focus on providing a clear, " +
    "detailed account of the visual elements present in the artwork. Do not " +
    "ask questions or suggest interpretations in your descriptions. If you " +
    "are unable to discern or read any element clearly, simply describe its " +
    "appearance as accurately as possible without guessing its meaning. Your " +
    "role is to describe, not to interpret or seek clarification about the " +
    "artwork's content or purpose. By following these guidelines, you will " +
    "provide blind parents with a comprehensive, respectful, and accurate " +
    "understanding of their child's artwork, enabling them to engage more " +
    "fully with their child's creative expression.",

  creative:
    "Generate a creative description of the artwork in paragraph form (no " +
    "bullets or numbered points). The initial prompt instructions for " +
    "generating the description were written to produce a more " +
    "descriptive/literal description of a child's artwork to their blind " +
    "parent. Another kind of description we want is one that is more " +
    "creative, which allows for the description to make more interpretations " +
    "and assumptions, suggesting what elements 'might be' or 'could " +
    "represent.' For example, instead of saying 'The figure's mouth is drawn " +
    "as a downward curve, and there are blue vertical lines below the eyes,' " +
    "you have more freedom to say things such as 'The figure's mouth forms a " +
    "downward curve, and blue lines beneath the eyes give the impression of " +
    "tears, suggesting a feeling of sadness.' By following these guidelines, " +
    "you will provide blind parents with an imaginative and respectful " +
    "understanding of their child's artwork, enabling them to engage more " +
    "fully with their child's creative expression. Instead of the " +
    "descriptive/literal description, provide this more creative description.",

  questions:
    "Generate 3 questions the parent can ask the child about their artwork.",
};

// =============================================================================
// Recommended model config
// =============================================================================
// From ArtInsight's scoring harness results (see README.md "What's empirically
// established"). GPT-4o Mini matched GPT-4o quality at lower cost and latency.

export const config = {
  model: "gpt-4o-mini",
  temperature: 0.25,
  maxTokens: 512,
};

// =============================================================================
// shouldApply — when to engage ArtInsight grounding
// =============================================================================

const ARTWORK_HOSTS = [
  "metmuseum.org",
  "moma.org",
  "tate.org.uk",
  "artic.edu",
  "nga.gov",
  "guggenheim.org",
  "smithsonianmag.com",
  "artsy.net",
  "deviantart.com",
];

export function shouldApply({ host, doc, profile } = {}) {
  if (profile?.insights?.includes("artinsight")) return true;

  if (host && ARTWORK_HOSTS.some((h) => host.endsWith(h))) return true;

  if (doc) {
    const figures = doc.querySelectorAll("figure, [itemtype*='VisualArtwork']");
    if (figures.length >= 3) return true;
  }

  return false;
}
