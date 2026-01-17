import WebSocket from 'ws';

// Price Feed Types (from YOUR price feed server)
export interface PriceData {
  pair: string;
  price: number;
  confidence: number;
  expo: number;
  publishTime: number;
}

export interface PriceFeedMessage {
  type: 'connected' | 'subscribed' | 'price_update' | 'error';
  pair?: string;
  data?: PriceData;
  message?: string;
  timestamp: number;
}

// Game State Types
export type GamePhase = 'LOBBY' | 'ROUND';

export interface GameState {
  phase: GamePhase;
  currentRound: RoundState | null;
  lobbyStartTime: number | null;
  lobbyEndTime: number | null;
}

export interface RoundState {
  id: string;
  pair: string;
  entryPrice: number;
  currentPrice: number;
  leverage: number;
  startTime: number;
  endTime: number | null;
  duration: number; // Random duration in seconds
  totalWagered: number;
  positions: Map<string, PlayerPosition>;
}

export interface PlayerPosition {
  playerId: string;
  positionType: 'LONG' | 'SHORT';
  betAmount: number; // Amount player wagered this round
  entryPrice: number;
  currentPnl: number;
  liquidated: boolean;
  didShoot: boolean;
  shotAt: number | null;
}

export interface LobbyPlayer {
  playerId: string;
  username: string;
  betAmount: number; // Amount player wants to bet
  balance: number; // Current balance
  joinedAt: number;
}

// WebSocket Client State
export interface GameClient {
  id: string;
  ws: WebSocket;
  playerId: string | null;
  connectedAt: number;
}

// WebSocket Messages - Client to Server
export type ClientMessage =
  | { type: 'JOIN_LOBBY'; playerId: string; username: string; betAmount: number }
  | { type: 'LEAVE_LOBBY'; playerId: string }
  | { type: 'SHOOT'; playerId: string; roundId: string }
  | { type: 'GET_BALANCE'; playerId: string }
  | { type: 'PING' };

// WebSocket Messages - Server to Client
export type ServerMessage =
  | { type: 'CONNECTED'; clientId: string; timestamp: number }
  | { type: 'BALANCE_UPDATE'; balance: number; totalPnl: number; gamesPlayed: number }
  | { type: 'LOBBY_UPDATE'; secondsRemaining: number; playersInLobby: number; totalWagered: number; players: LobbyPlayer[] }
  | { type: 'ROUND_START'; roundId: string; pair: string; entryPrice: number; leverage: number; myPosition: 'LONG' | 'SHORT'; myBetAmount: number }
  | { type: 'PRICE_UPDATE'; currentPrice: number; pnl: number; pnlPercentage: number; liquidationPrice: number }
  | { type: 'LIQUIDATED'; finalPrice: number; loss: number }
  | { type: 'SHOOT_SUCCESS'; exitPrice: number; pnl: number; payout: number }
  | { type: 'ROUND_END'; finalPrice: number; myPnl: number; payout: number; didShoot: boolean; reason: string; newBalance: number }
  | { type: 'ERROR'; message: string; code?: string }
  | { type: 'PONG' };

// Volatility Data
export interface VolatilityData {
  pair: string;
  volatility: number; // Standard deviation
  priceHistory: number[];
  lastUpdated: number;
}