# Spec for Signal Rich Sentiment Model

feature_slug: signal-rich-sentiment

## Intent and Desired Outcomes
- Business intent: Replace the coarse 3-bucket sentiment classifier (`positive`/`neutral`/`concerned`) with a graduated valence model that produces continuous scores and handles negation, enabling more nuanced detection of user emotional state throughout the conversation.
- User problem: The current `detectSentiment()` uses ~15 keywords bucketed into three categories. It cannot distinguish enthusiasm from polite acknowledgment, misses negation ("not happy" scores as positive due to "happy"), and produces only three discrete values (1.0, 0.5, 0.2) for `baseValence`.
- Desired outcomes:
  - Sentiment baseValence is a continuous score reflecting graduated emotional tone
  - Negated positive expressions ("not great", "don't like") are correctly scored as negative
  - The existing `detectSentiment()` function remains available as a backward-compatible wrapper
- Success metrics (observable):
  - "This is excellent, exactly what we need" scores higher valence than "This is okay"
  - "I'm not happy with this approach" scores negative valence, not positive
  - "We're frustrated but see potential" scores moderate (mixed), not purely negative

## Summary
This phase introduces a sentiment lexicon — an AFINN-style word-score map with ~200 common words scored from -5 to +5 — and a `computeValence` function that tokenizes text, looks up word scores, applies a negation window (negation words invert the next 1–2 tokens), and produces a continuous valence score from -1 to +1. The existing `detectSentiment()` is preserved as a wrapper that maps the continuous valence to the original three buckets. The sentiment feature extractor is updated to use `computeValence` for `baseValence`, mapping the -1..+1 range to 0..1.

## Scenario Coverage

### Primary Success Scenario
- Given a user writes "This is really excellent, we're very excited about the potential"
- When `computeValence` processes the text
- Then it returns a high positive valence (e.g., 0.7–0.9) reflecting strong positive sentiment

### Variation Scenarios
- Scenario A: "I'm not happy with this direction" -> negative valence due to "not" inverting "happy".
- Scenario B: "It's okay, nothing special" -> slightly positive or neutral valence (weak positive word, no strong signals).
- Scenario C: "We're frustrated with the timeline but excited about the features" -> moderate valence reflecting mixed signals.
- Scenario D: "absolutely terrible experience" -> strongly negative valence (intensifier + negative word).

### Failure / Edge Scenarios
- Scenario E1: Text with no words in the lexicon -> valence defaults to 0 (neutral).
- Scenario E2: Double negation ("not unhappy") -> ideally positive, but acceptable to score as neutral if double negation handling is deferred.
- Scenario E3: Sarcasm ("oh great, another meeting") -> scored as positive; sarcasm detection is explicitly out of scope.

## Functional Requirements
- FR-1: The system should provide a sentiment lexicon as a `Record<string, number>` with approximately 200 common English words scored from -5 to +5 in `sentiment-lexicon.ts`.
- FR-2: The system should provide `computeValence(text: string): number` returning a value in [-1, +1].
- FR-3: `computeValence` should tokenize text into words, look up each word in the lexicon, and compute a normalized average score.
- FR-4: `computeValence` should detect negation words ("not", "no", "don't", "doesn't", "won't", "can't", "never", "neither") and invert the valence of the next 1–2 tokens within a negation window.
- FR-5: `detectSentiment()` should be refactored to call `computeValence` and map the continuous score to the existing three buckets: positive (> 0.2), concerned (< -0.2), neutral (between).
- FR-6: `extractSentimentFeatures` should use `computeValence` for `baseValence`, mapping [-1, +1] to [0, 1] via `(valence + 1) / 2`.
- FR-7: All existing callers of `detectSentiment()` should continue to work without modification.
- FR-8: The lexicon should include words relevant to business/sales conversations (e.g., "risk", "opportunity", "deadline", "impressed", "disappointed").

## Possible Edge Cases
- Text entirely in uppercase ("NOT HAPPY") — tokenization should be case-insensitive
- Contractions ("can't", "won't", "isn't") — should be recognized as negation
- Hyphenated words ("well-designed") — may need splitting or whole-word lookup
- Empty text or single punctuation — valence returns 0
- Very long text with many lexicon hits — normalization prevents extreme scores

## Acceptance Criteria
- AC-1: "not happy" produces negative valence, "happy" alone produces positive valence -> pass
- AC-2: "excellent" produces higher valence than "okay" -> pass
- AC-3: Mixed sentiment text produces a moderate valence, not extreme -> pass
- AC-4: `detectSentiment("great job")` still returns "positive" (backward compatible) -> pass
- AC-5: `detectSentiment("I'm worried about risks")` still returns "concerned" -> pass
- AC-6: Valence is always in [-1, +1] and mapped baseValence is always in [0, 1] -> pass

## Testing Guidelines
- Scenario coverage map:
  - Primary success -> "strong positive text produces high valence"
  - Variation A -> "negated positive produces negative valence"
  - Variation C -> "mixed text produces moderate valence"
  - Failure E1 -> "no lexicon words produces zero valence"
- Acceptance traceability:
  - AC-1 -> Unit test: `computeValence("not happy")` < 0 AND `computeValence("happy")` > 0
  - AC-2 -> Unit test: `computeValence("excellent")` > `computeValence("okay")`
  - AC-3 -> Unit test: mixed text valence is between -0.5 and 0.5
  - AC-4, AC-5 -> Regression: `detectSentiment` returns same buckets for existing test cases
  - AC-6 -> Boundary test: extreme inputs stay within range
- Regression checks:
  - `detectSentiment()` callers produce same behavior (search codebase for all callers)
  - `extractSentimentFeatures` produces valid bounded scores
  - Sentiment agent scores remain in [0, 1]
  - Overall orchestrator output is unaffected in structure

## Dependencies and Constraints
- Dependencies:
  - No hard dependency on other phases, but best implemented after Phase 2 (conversation context) so sentiment features can benefit from context
  - Must verify all callers of `detectSentiment()` before refactoring
- Constraints:
  - Lexicon must be a static data structure — no API calls or file I/O at runtime
  - `computeValence` must be deterministic and fast (tokenize + lookup, no LLM)
  - Backward compatibility with `detectSentiment()` is mandatory

## Out of Scope
- Sarcasm detection
- Double negation handling (treat as edge case, score as neutral)
- Emoji or emoticon sentiment analysis
- Non-English language support
- LLM-based sentiment analysis (covered by Phase 7)

## Open Questions
- Should the lexicon be sourced from an established list (AFINN-165) or curated specifically for sales/business conversations?
- Should intensifier words (very, extremely) multiply the adjacent word's score, or should they be handled only by the existing `intensifierMagnitude` feature?
