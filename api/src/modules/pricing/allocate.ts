/**
 * Splits `total` across `weights` proportionally using the largest-remainder
 * method, so the parts always sum to exactly `total` and no part exceeds its
 * weight when total <= sum(weights). Ties resolve by index for determinism.
 * BigInt avoids overflow in total * weight.
 */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);

  const t = BigInt(total);
  const s = BigInt(sum);
  const parts = weights.map((w) => (t * BigInt(w)) / s);
  const remainders = weights.map((w) => (t * BigInt(w)) % s);
  let left = Number(t - parts.reduce((a, b) => a + b, 0n));

  const order = weights.map((_, i) => i).sort((a, b) => (remainders[b]! > remainders[a]! ? 1 : remainders[b]! < remainders[a]! ? -1 : a - b));
  for (const i of order) {
    if (left === 0) break;
    parts[i] = parts[i]! + 1n;
    left--;
  }
  return parts.map(Number);
}
