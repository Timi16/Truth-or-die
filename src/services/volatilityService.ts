import { CONFIG } from '../config.js';
import { logger } from '../utils/logger.js';
import { calculateStandardDeviation } from '../utils/calculation.js';
import { type VolatilityData, type PriceData } from '../types.js';
import { priceFeedClient } from './priceFeedClient.js';

/**
 * Track price history and calculate volatility for all pairs
 */
export class VolatilityService {
  private priceHistories: Map<string, number[]> = new Map();
  private volatilityData: Map<string, VolatilityData> = new Map();
  private unsubscribeFunctions: Map<string, () => void> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;

  async initialize(pairs: string[]): Promise<void> {
    logger.info(`Initializing volatility tracking for ${pairs.length} pairs...`);

    // Subscribe to all pairs
    for (const pair of pairs) {
      this.priceHistories.set(pair, []);
      
      const unsubscribe = priceFeedClient.subscribeToPair(pair, (priceData: PriceData) => {
        this.handlePriceUpdate(pair, priceData.price);
      });
      
      this.unsubscribeFunctions.set(pair, unsubscribe);
    }

    // Calculate volatility every 30 seconds
    this.updateInterval = setInterval(() => {
      this.calculateAllVolatility();
    }, 30000);

    logger.info('✅ Volatility service initialized');
  }

  private handlePriceUpdate(pair: string, price: number): void {
    const history = this.priceHistories.get(pair);
    if (!history) return;

    history.push(price);

    // Keep only last N data points (based on volatility window)
    // Assuming ~1 price update per second, keep last 5 minutes worth
    const maxDataPoints = CONFIG.VOLATILITY.WINDOW_SECONDS;
    if (history.length > maxDataPoints) {
      history.shift();
    }
  }

  private calculateAllVolatility(): void {
    logger.debug('Calculating volatility for all pairs...');

    for (const [pair, history] of this.priceHistories.entries()) {
      if (history.length < 10) {
        // Not enough data yet
        continue;
      }

      const volatility = calculateStandardDeviation(history);
      
      this.volatilityData.set(pair, {
        pair,
        volatility,
        priceHistory: [...history],
        lastUpdated: Date.now(),
      });
    }

    logger.debug(`Volatility calculated for ${this.volatilityData.size} pairs`);
  }

  /**
   * Get all pairs that meet minimum volatility threshold
   */
  getHighVolatilityPairs(): VolatilityData[] {
    const threshold = CONFIG.VOLATILITY.MIN_THRESHOLD;
    
    return Array.from(this.volatilityData.values())
      .filter(data => data.volatility >= threshold)
      .sort((a, b) => b.volatility - a.volatility);
  }

  /**
   * Get volatility data for a specific pair
   */
  getVolatility(pair: string): VolatilityData | undefined {
    return this.volatilityData.get(pair);
  }

  /**
   * Get all volatility data
   */
  getAllVolatilityData(): VolatilityData[] {
    return Array.from(this.volatilityData.values());
  }

  close(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    // Unsubscribe from all pairs
    for (const unsubscribe of this.unsubscribeFunctions.values()) {
      unsubscribe();
    }

    this.priceHistories.clear();
    this.volatilityData.clear();
    this.unsubscribeFunctions.clear();

    logger.info('Volatility service closed');
  }
}

export const volatilityService = new VolatilityService();