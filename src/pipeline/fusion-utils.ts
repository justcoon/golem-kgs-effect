/**
 * Bayesian confidence score fusion formula:
 * Combines two independent observations: C = 1 - (1 - C1) * (1 - C2)
 */
export function fuseConfidence(c1: number, c2: number): number {
  const fused = 1 - (1 - Math.min(0.99, c1)) * (1 - Math.min(0.99, c2));
  return Number(Math.min(0.999, Math.max(0.01, fused)).toFixed(4));
}

/**
 * Generic Reciprocal Rank Fusion (RRF) algorithm:
 * RRF(d) = \sum_{r \in R} \frac{1}{k + rank(r, d)}
 */
export interface Identifiable {
  readonly id: string;
}

export function reciprocalRankFusion<T extends Identifiable>(
  rankings: ReadonlyArray<ReadonlyArray<T>>,
  k = 60,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((item, index) => {
      const rank = index + 1;
      const rrfScore = 1 / (k + rank);
      scores.set(item.id, (scores.get(item.id) ?? 0) + rrfScore);
    });
  }
  return scores;
}

/**
 * Merges ranked lists using RRF, returning the items sorted by descending fused score.
 */
export function fuseRankings<T extends Identifiable>(
  rankings: ReadonlyArray<ReadonlyArray<T>>,
  k = 60,
  limit?: number,
): Array<{ item: T; score: number }> {
  const itemMap = new Map<string, T>();
  const scores = new Map<string, number>();

  for (const ranking of rankings) {
    ranking.forEach((item, index) => {
      if (!itemMap.has(item.id)) {
        itemMap.set(item.id, item);
      }
      const rank = index + 1;
      const rrfScore = 1 / (k + rank);
      scores.set(item.id, (scores.get(item.id) ?? 0) + rrfScore);
    });
  }

  const sorted = Array.from(scores.entries())
    .map(([id, score]) => ({ item: itemMap.get(id)!, score }))
    .sort((a, b) => b.score - a.score);

  return limit !== undefined ? sorted.slice(0, limit) : sorted;
}
