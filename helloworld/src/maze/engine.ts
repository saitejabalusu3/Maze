/**
 * Finds the first index where playerMoves diverge from solutionMoves.
 * Returns -1 when the playerPath is still on track (prefix of the solution).
 */
export function firstDivergence(playerMoves: number[], solutionMoves: number[]): number {
  const len = Math.min(playerMoves.length, solutionMoves.length);
  for (let i = 0; i < len; i += 1) {
    if (playerMoves[i] !== solutionMoves[i]) {
      return i;
    }
  }

  if (playerMoves.length > solutionMoves.length) {
    return solutionMoves.length;
  }

  return -1;
}

/**
 * Returns a forward-looking slice of the solution for hinting.
 * Shows up to 20 moves; if fewer than 20 remain, show at most 10.
 */
export function hintSegment(
  solutionMoves: number[],
  progress: number,
  divergence: number,
  L: number
): number[] {
  const cappedSolution = solutionMoves.slice(0, L);
  const clampedProgress = Math.max(0, Math.min(Math.floor(progress), cappedSolution.length));
  const clampedDivergence = divergence >= 0 ? Math.min(divergence, cappedSolution.length) : -1;
  const start = Math.max(clampedProgress, clampedDivergence >= 0 ? clampedDivergence : clampedProgress);

  const remaining = Math.max(0, cappedSolution.length - start);
  if (remaining === 0) {
    return [];
  }

  const takeCount = remaining >= 20 ? 20 : Math.min(10, remaining);
  return cappedSolution.slice(start, start + takeCount);
}
