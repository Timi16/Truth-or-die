import WebSocket from 'ws';
import { CONFIG } from '../config.js';
import { logger } from '../utils/logger.js';
import { type PriceData, type PriceFeedMessage } from '../types.js';

type PriceCallback = (priceData: PriceData) => void;

/**
 * Client to connect to YOUR existing price feed server
 */
export class PriceFeedClient {
  private ws: WebSocket | null = null;
  private subscriptions: Map<string, Set<PriceCallback>> = new Map();
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private connected = false;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        logger.info(`Connecting to price feed server: ${CONFIG.PRICE_FEED_WS_URL}`);
        
        this.ws = new WebSocket(CONFIG.PRICE_FEED_WS_URL);

        this.ws.on('open', () => {
          logger.info('✅ Connected to price feed server');
          this.connected = true;
          this.reconnectAttempts = 0;
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('close', () => {
          logger.warn('Price feed WebSocket closed');
          this.connected = false;
          this.attemptReconnect();
        });

        this.ws.on('error', (error) => {
          logger.error('Price feed WebSocket error:', error);
          if (!this.connected) {
            reject(error);
          }
        });
      } catch (error) {
        logger.error('Failed to connect to price feed:', error);
        reject(error);
      }
    });
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const message: PriceFeedMessage = JSON.parse(data.toString());

      if (message.type === 'price_update' && message.pair && message.data) {
        const callbacks = this.subscriptions.get(message.pair);
        if (callbacks && callbacks.size > 0) {
          callbacks.forEach(cb => {
            try {
              cb(message.data!);
            } catch (error) {
              logger.error(`Error in price callback for ${message.pair}:`, error);
            }
          });
        }
      }
    } catch (error) {
      logger.error('Error parsing price feed message:', error);
    }
  }

  subscribeToPair(pair: string, callback: PriceCallback): () => void {
    if (!this.ws || !this.connected) {
      throw new Error('Not connected to price feed server');
    }

    if (!this.subscriptions.has(pair)) {
      this.subscriptions.set(pair, new Set());
      
      // Send subscribe message to YOUR price feed server
      this.ws.send(JSON.stringify({
        type: 'subscribe',
        pair: pair
      }));

      logger.info(`Subscribed to price feed for ${pair}`);
    }

    this.subscriptions.get(pair)!.add(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.subscriptions.get(pair);
      if (callbacks) {
        callbacks.delete(callback);
        
        if (callbacks.size === 0) {
          this.subscriptions.delete(pair);
          
          if (this.ws && this.connected) {
            this.ws.send(JSON.stringify({
              type: 'unsubscribe',
              pair: pair
            }));
          }
          
          logger.info(`Unsubscribed from price feed for ${pair}`);
        }
      }
    };
  }

  private attemptReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      logger.error('Max reconnection attempts reached. Giving up.');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    logger.info(`Reconnecting to price feed in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      this.connect().catch(error => {
        logger.error('Reconnection failed:', error);
      });
    }, delay);
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  close(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.connected = false;
    this.subscriptions.clear();
    logger.info('Price feed client closed');
  }
}

export const priceFeedClient = new PriceFeedClient();