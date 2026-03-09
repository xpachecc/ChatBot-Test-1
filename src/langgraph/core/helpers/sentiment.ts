import { SENTIMENT_LEXICON } from "./sentiment-lexicon.js";

const NEGATION_WORDS = new Set([
  "not", "no", "never", "neither",
  "don't", "doesn't", "won't", "can't", "isn't", "wasn't", "weren't", "haven't", "hasn't", "wouldn't", "couldn't", "shouldn't",
  "dont", "doesnt", "wont", "cant", "isnt", "wasnt", "werent", "havent", "hasnt", "wouldnt", "couldnt", "shouldnt",
]);

/**
 * Compute continuous valence from -1 to +1 using lexicon and negation handling.
 */
export function computeValence(text: string): number {
  const lower = text.toLowerCase().trim();
  if (!lower) return 0;

  const tokens = lower.split(/\s+/).filter(Boolean);
  const scores: number[] = [];
  let negateNext = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].replace(/[^a-z']/g, "");
    if (NEGATION_WORDS.has(token) || NEGATION_WORDS.has(tokens[i])) {
      negateNext = 2;
      continue;
    }
    const raw = SENTIMENT_LEXICON[token];
    if (raw !== undefined) {
      const score = negateNext > 0 ? -raw : raw;
      scores.push(Math.max(-5, Math.min(5, score)));
    }
    if (negateNext > 0) negateNext--;
  }

  if (scores.length === 0) return 0;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.max(-1, Math.min(1, avg / 5));
}

/**
 * Map to 3-bucket: positive (> 0.2), concerned (< -0.2), neutral (between).
 */
export function detectSentiment(answer: string): "positive" | "neutral" | "concerned" {
  const v = computeValence(answer);
  if (v > 0.2) return "positive";
  if (v < -0.2) return "concerned";
  return "neutral";
}

export function isAffirmativeAnswer(answer: string): boolean {
  const lower = answer.trim().toLowerCase();
  return /\b(yes|yeah|yep|correct|right|affirmative|sure|sounds good|exactly|that's right|that's right)\b/.test(lower);
}
