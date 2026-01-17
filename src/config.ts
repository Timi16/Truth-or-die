import dotenv from 'dotenv';

dotenv.config();

export const CONFIG = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '4000', 10),

  // Database
  DATABASE_URL: process.env.DATABASE_URL || '',

  // Price Feed Server (YOUR existing server)
  PRICE_FEED_WS_URL: process.env.PRICE_FEED_WS_URL || 'ws://localhost:3000/prices',

  // Game Settings
  GAME: {
    DEFAULT_LEVERAGE: parseInt(process.env.DEFAULT_LEVERAGE || '500', 10),
    LOBBY_DURATION_SECONDS: parseInt(process.env.LOBBY_DURATION_SECONDS || '20', 10),
    MIN_ROUND_DURATION_SECONDS: parseInt(process.env.MIN_ROUND_DURATION_SECONDS || '10', 10),  // ← Changed to 10
    MAX_ROUND_DURATION_SECONDS: parseInt(process.env.MAX_ROUND_DURATION_SECONDS || '120', 10), // ← Changed to 120
  },

  // Player Settings
  PLAYER: {
    DEFAULT_DEMO_BALANCE: parseFloat(process.env.DEFAULT_DEMO_BALANCE || '100'),
    MIN_BET_AMOUNT: parseFloat(process.env.MIN_BET_AMOUNT || '0.01'),
  },

  // Volatility Settings
  VOLATILITY: {
    WINDOW_SECONDS: parseInt(process.env.VOLATILITY_WINDOW_SECONDS || '300', 10),
    MIN_THRESHOLD: parseFloat(process.env.MIN_VOLATILITY_THRESHOLD || '0.001'),
  },
} as const;