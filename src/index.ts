import http from 'http';
import { CONFIG } from './config.js';
import { logger } from './utils/logger.js';
import { prisma } from './services/prisma.js';
import { priceFeedClient } from './services/priceFeedClient.js';
import { volatilityService } from './services/volatilityService.js';
import { gameStateManager } from './services/gameStateManager.js';
import { createWebSocketServer } from './websocket/wsServer.js';

/**
 * Main entry point for Debonk Game Server
 */
async function start() {
  try {
    logger.info('🚀 Starting Debonk Game Server...');
    logger.info(`Environment: ${CONFIG.NODE_ENV}`);
    logger.info(`Port: ${CONFIG.PORT}`);

    // Step 1: Test database connection
    logger.info('Step 1: Testing database connection...');
    await prisma.$connect();
    logger.info('✅ Database connected');

    // Step 2: Connect to price feed server
    logger.info('Step 2: Connecting to price feed server...');
    logger.info(`Price feed URL: ${CONFIG.PRICE_FEED_WS_URL}`);
    await priceFeedClient.connect();
    logger.info('✅ Connected to price feed server');

    // Step 3: Initialize volatility service
    logger.info('Step 3: Initializing volatility tracking...');
    
    // Get all available pairs from price feed server
    // For now, we'll use a hardcoded list from common pairs
    const monitoredPairs = [
      'BTC/USD', 'ETH/USD', 'SOL/USD', 'DOGE/USD', 'PEPE/USD',
      'XRP/USD', 'BNB/USD', 'LINK/USD', 'AVAX/USD', 'SHIB/USD'
    ];
    
    await volatilityService.initialize(monitoredPairs);
    logger.info(`✅ Monitoring volatility for ${monitoredPairs.length} pairs`);

    // Step 4: Initialize game state manager
    logger.info('Step 4: Initializing game state manager...');
    await gameStateManager.initialize();
    logger.info('✅ Game state manager initialized');

    // Step 5: Create HTTP server
    logger.info('Step 5: Creating HTTP server...');
    const httpServer = http.createServer((req, res) => {
      if (req.url === '/health') {
        const gameState = gameStateManager.getGameState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          timestamp: Date.now(),
          uptime: process.uptime(),
          priceFeedConnected: priceFeedClient.isConnected(),
          gamePhase: gameState.phase,
          currentRound: gameState.currentRound ? {
            id: gameState.currentRound.id,
            pair: gameState.currentRound.pair,
            playersCount: gameState.currentRound.positions.size,
          } : null,
        }));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    httpServer.listen(CONFIG.PORT, () => {
      logger.info('\n═══════════════════════════════════════════');
      logger.info('🎉 Debonk Game Server is RUNNING!');
      logger.info('═══════════════════════════════════════════');
      logger.info(`📍 HTTP:      http://localhost:${CONFIG.PORT}`);
      logger.info(`🔌 WebSocket: ws://localhost:${CONFIG.PORT}/game`);
      logger.info(`🎮 Game Loop: ${CONFIG.GAME.LOBBY_DURATION_SECONDS}s lobby → random round`);
      logger.info(`⚡ Leverage:  ${CONFIG.GAME.DEFAULT_LEVERAGE}X`);
      logger.info('═══════════════════════════════════════════');
      logger.info('\nAvailable endpoints:');
      logger.info('  GET  /health    - Health check');
      logger.info('  WS   /game      - Game WebSocket');
      logger.info('\nWebSocket Events (Client → Server):');
      logger.info('  JOIN_LOBBY  { playerId, username, betAmount }');
      logger.info('  SHOOT       { playerId, roundId }');
      logger.info('  PING        { }');
      logger.info('\nWebSocket Events (Server → Client):');
      logger.info('  LOBBY_UPDATE     { secondsRemaining, playersInLobby, players }');
      logger.info('  ROUND_START      { roundId, pair, entryPrice, leverage, myPosition }');
      logger.info('  PRICE_UPDATE     { currentPrice, pnl, pnlPercentage, liquidationPrice }');
      logger.info('  LIQUIDATED       { finalPrice, loss }');
      logger.info('  SHOOT_SUCCESS    { exitPrice, pnl, payout }');
      logger.info('  ROUND_END        { finalPrice, myPnl, payout, didShoot, reason }');
    });

    // Step 6: Create WebSocket server
    logger.info('Step 6: Creating WebSocket server...');
    createWebSocketServer(httpServer);
    logger.info('✅ WebSocket server created');

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down gracefully...');
      
      gameStateManager.close();
      volatilityService.close();
      priceFeedClient.close();
      await prisma.$disconnect();
      
      httpServer.close(() => {
        logger.info('Server closed');
        process.exit(0);
      });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();