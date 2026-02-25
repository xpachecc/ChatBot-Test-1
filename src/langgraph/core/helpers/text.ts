export function TimeframeSanitizer(raw: string | null | undefined): string {
  if (!raw) return "this timeframe";
  let t = raw.trim();
  t = t.replace(/^for\s+/i, "");
  t = t.replace(/^in\s+/i, "");
  t = t.replace(/^a\s+/i, "");
  t = t.replace(/^an\s+/i, "");
  if (!/^(in|within|by|over|during|throughout)\b/i.test(t)) t = `in ${t}`;
  return t;
}

export function SpanSanitizer(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  return trimmed.replace(/[.?!]+$/g, "") || fallback;
}

export function sanitizeDiscoveryAnswer(raw: string): string {
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 600);
}

export function truncateTextToWordLimit(text: string, maxWords = 12): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ");
}
