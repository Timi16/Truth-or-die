/**
 * Calculate P&L for a position
 */
export function calculatePnL(
  positionType: 'LONG' | 'SHORT',
  entryPrice: number,
  currentPrice: number,
  entryAmount: number,
  leverage: number
): number {
  const priceChange = currentPrice - entryPrice;
  const priceChangePercent = priceChange / entryPrice;

  let pnl: number;
  if (positionType === 'LONG') {
    pnl = entryAmount * priceChangePercent * leverage;
  } else {
    // SHORT
    pnl = entryAmount * -priceChangePercent * leverage;
  }

  return pnl;
}

/**
 * Calculate P&L percentage
 */
export function calculatePnLPercentage(pnl: number, entryAmount: number): number {
  return (pnl / entryAmount) * 100;
}

/**
 * Calculate liquidation price for a position
 */
export function calculateLiquidationPrice(
  positionType: 'LONG' | 'SHORT',
  entryPrice: number,
  leverage: number
): number {
  // Liquidation occurs at -100% loss
  // For LONG: liquidation price = entryPrice * (1 - 1/leverage)
  // For SHORT: liquidation price = entryPrice * (1 + 1/leverage)

  const liquidationPercentage = 1 / leverage;

  if (positionType === 'LONG') {
    return entryPrice * (1 - liquidationPercentage);
  } else {
    // SHORT
    return entryPrice * (1 + liquidationPercentage);
  }
}

/**
 * Check if position is liquidated
 */
export function isLiquidated(
  positionType: 'LONG' | 'SHORT',
  entryPrice: number,
  currentPrice: number,
  leverage: number
): boolean {
  const liquidationPrice = calculateLiquidationPrice(positionType, entryPrice, leverage);

  if (positionType === 'LONG') {
    return currentPrice <= liquidationPrice;
  } else {
    // SHORT
    return currentPrice >= liquidationPrice;
  }
}

/**
 * Calculate final payout for a position
 */
/**
 * Calculate final payout for a position
 */
export function calculatePayout(
  entryAmount: number,
  pnl: number,
  didShoot: boolean,
  liquidated: boolean
): number {
  if (liquidated) {
    // Liquidated = total loss
    return 0;
  }

  // Whether they shot or not, they get their entry + P&L
  // The only difference is shooting early locks in the current P&L
  // Time expiry should settle at the final P&L
  return Math.max(0, entryAmount + pnl);
}

/**
 * Calculate standard deviation (for volatility)
 */
export function calculateStandardDeviation(values: number[]): number {
  if (values.length === 0) return 0;

  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;

  return Math.sqrt(variance);
}

/**
 * Calculate percentage change
 */
export function calculatePercentageChange(oldValue: number, newValue: number): number {
  if (oldValue === 0) return 0;
  return ((newValue - oldValue) / oldValue) * 100;
}