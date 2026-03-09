/**
 * Compute confidence from features and text length.
 * Higher text length, pattern density, and feature agreement = higher confidence.
 */
export function computeConfidence(features: Record<string, number>, textLength: number): number {
  const values = Object.values(features);
  if (values.length === 0) return textLength > 0 ? 0.3 : 0.2;

  const nonZero = values.filter((v) => v > 0).length;
  const density = nonZero / values.length;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const agreement = Math.max(0, 1 - Math.sqrt(variance) * 2);

  const lengthFactor = Math.min(1, Math.log1p(textLength) / 5);

  const raw = 0.4 * density + 0.3 * agreement + 0.3 * lengthFactor;
  return Math.max(0.2, Math.min(1, raw));
}
