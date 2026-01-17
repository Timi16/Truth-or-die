import { type VolatilityData } from '../types.js';

/**
 * Select a random pair from high-volatility pairs
 */
export function selectRandomPair(volatilityData: VolatilityData[]): string | null {
  if (volatilityData.length === 0) {
    return null;
  }

  // Sort by volatility (highest first)
  const sorted = [...volatilityData].sort((a, b) => b.volatility - a.volatility);

  // Take top 30% most volatile pairs
  const topCount = Math.max(1, Math.ceil(sorted.length * 0.3));
  const topPairs = sorted.slice(0, topCount);

  // Randomly select one from the top volatile pairs
  const randomIndex = Math.floor(Math.random() * topPairs.length);
  return topPairs[randomIndex]?.pair ?? null;
}

/**
 * Assign random LONG/SHORT positions to players (50/50 distribution)
 */
export function assignRandomPositions(playerIds: string[]): Map<string, 'LONG' | 'SHORT'> {
  const positions = new Map<string, 'LONG' | 'SHORT'>();

  // Shuffle player IDs
  const shuffled = [...playerIds].sort(() => Math.random() - 0.5);

  // Split 50/50
  const halfPoint = Math.floor(shuffled.length / 2);

  shuffled.forEach((playerId, index) => {
    positions.set(playerId, index < halfPoint ? 'LONG' : 'SHORT');
  });

  return positions;
}

/**
 * Generate random round duration based on leverage
 * Higher leverage = shorter max duration
 */
export function generateRandomDuration(
  leverage: number,
  minSeconds: number,
  maxSeconds: number
): number {
  // Adjust max duration based on leverage
  // 500X leverage -> maxSeconds
  // 100X leverage -> maxSeconds * 2
  // 50X leverage -> maxSeconds * 4
  const leverageFactor = 500 / leverage;
  const adjustedMax = Math.min(maxSeconds * leverageFactor, maxSeconds * 5);

  // Generate random duration between min and adjusted max
  const duration = minSeconds + Math.random() * (adjustedMax - minSeconds);

  return Math.round(duration * 100) / 100; // Round to 2 decimals
}

/**
 * Random selection with weighted probability
 */
export function weightedRandomSelection<T>(
  items: T[],
  weights: number[]
): T | null {
  if (items.length === 0 || items.length !== weights.length) {
    return null;
  }

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let random = Math.random() * totalWeight;

  for (let i = 0; i < items.length; i++) {
    const weight = weights[i];
    if (weight === undefined) {
      continue;
    }
    random -= weight;
    if (random <= 0) {
      return items[i] ?? null;
    }
  }

  return items[items.length - 1] ?? null;
}