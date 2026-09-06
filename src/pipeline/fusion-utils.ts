/**
 * Bayesian confidence score fusion formula:
 * Combines two independent observations: C = 1 - (1 - C1) * (1 - C2)
 */
export function fuseConfidence(c1: number, c2: number): number {
  const fused = 1 - (1 - Math.min(0.99, c1)) * (1 - Math.min(0.99, c2));
  return Number(Math.min(0.999, Math.max(0.01, fused)).toFixed(4));
}
