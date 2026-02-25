export function detectSentiment(answer: string): "positive" | "neutral" | "concerned" {
  const lower = answer.toLowerCase();
  if (/\b(stressed|blocked|stuck|frustrated|urgent|risk|concerned|worried)\b/.test(lower)) return "concerned";
  if (/\b(great|good|perfect|exactly|yes)\b/.test(lower)) return "positive";
  return "neutral";
}

export function isAffirmativeAnswer(answer: string): boolean {
  const lower = answer.trim().toLowerCase();
  return /\b(yes|yeah|yep|correct|right|affirmative|sure|sounds good|exactly|that's right|that's right)\b/.test(lower);
}
