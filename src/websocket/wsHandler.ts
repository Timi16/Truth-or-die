import WebSocket from 'ws';
import {type GameClient, type ClientMessage, type ServerMessage } from '../types.js';
import { logger } from '../utils/logger.js';
import { gameStateManager } from '../services/gameStateManager.js';

export class WebSocketHandler {
  private clients: Map<WebSocket, GameClient> = new Map();

  constructor() {
    this.setupGameStateListeners();
  }

  /**
   * Setup listeners for game state events
   */
  private setupGameStateListeners(): void {
    // Lobby events
    gameStateManager.on('lobby:start', (data) => {
      this.broadcastToAll({
        type: 'LOBBY_UPDATE',
        secondsRemaining: Math.ceil((data.lobbyEndTime - Date.now()) / 1000),
        playersInLobby: 0,
        totalWagered: 0,
        players: [],
      });
    });

    gameStateManager.on('lobby:update', (data) => {
      this.broadcastToAll({
        type: 'LOBBY_UPDATE',
        secondsRemaining: data.secondsRemaining,
        playersInLobby: data.playersInLobby,
        totalWagered: data.totalWagered,
        players: data.players,
      });
    });

    // Round events
    gameStateManager.on('round:start', (data) => {
      // Send personalized round start to each player
      for (const assignment of data.positions) {
        this.sendToPlayer(assignment.playerId, {
          type: 'ROUND_START',
          roundId: data.roundId,
          pair: data.pair,
          entryPrice: data.entryPrice,
          leverage: data.leverage,
          myPosition: assignment.positionType,
          myBetAmount: assignment.betAmount,
        });
      }
    });

    gameStateManager.on('price:update', (data) => {
      // Send personalized price updates to each player
      for (const positionData of data.positions) {
        const round = gameStateManager.getGameState().currentRound;
        if (!round) continue;

        const position = round.positions.get(positionData.playerId);
        if (!position) continue;

        const liquidationPrice = require('../utils/calculations').calculateLiquidationPrice(
          position.positionType,
          position.entryPrice,
          round.leverage
        );

        this.sendToPlayer(positionData.playerId, {
          type: 'PRICE_UPDATE',
          currentPrice: data.currentPrice,
          pnl: positionData.pnl,
          pnlPercentage: positionData.pnlPercentage,
          liquidationPrice,
        });
      }
    });

    gameStateManager.on('player:liquidated', (data) => {
      this.sendToPlayer(data.playerId, {
        type: 'LIQUIDATED',
        finalPrice: data.finalPrice,
        loss: data.loss,
      });
    });

    gameStateManager.on('player:shoot', (data) => {
      this.sendToPlayer(data.playerId, {
        type: 'SHOOT_SUCCESS',
        exitPrice: data.exitPrice,
        pnl: data.pnl,
        payout: data.payout,
      });

      // Also send updated balance
      this.sendBalanceUpdate(data.playerId);
    });

    gameStateManager.on('round:end', async (data) => {
      // Send personalized round end to each player
      for (const payout of data.payouts) {
        // Get updated balance
        const balanceData = await gameStateManager.getPlayerBalance(payout.playerId);
        
        this.sendToPlayer(payout.playerId, {
          type: 'ROUND_END',
          finalPrice: data.finalPrice,
          myPnl: payout.pnl,
          payout: payout.payout,
          didShoot: payout.didShoot,
          reason: data.reason,
          newBalance: balanceData?.balance || 0,
        });
      }
    });
  }

  /**
   * Send balance update to player
   */
  private async sendBalanceUpdate(playerId: string): Promise<void> {
    const balanceData = await gameStateManager.getPlayerBalance(playerId);
    
    if (balanceData) {
      this.sendToPlayer(playerId, {
        type: 'BALANCE_UPDATE',
        balance: balanceData.balance,
        totalPnl: balanceData.totalPnl,
        gamesPlayed: balanceData.gamesPlayed,
      });
    }
  }

  /**
   * Handle new client connection
   */
  handleConnection(ws: WebSocket): void {
    const clientId = this.generateClientId();
    
    const client: GameClient = {
      id: clientId,
      ws,
      playerId: null,
      connectedAt: Date.now(),
    };

    this.clients.set(ws, client);
    logger.info(`Client ${clientId} connected (total: ${this.clients.size})`);

    // Send welcome message
    this.sendMessage(ws, {
      type: 'CONNECTED',
      clientId,
      timestamp: Date.now(),
    });

    // Handle messages
    ws.on('message', (data: WebSocket.Data) => {
      this.handleMessage(ws, data, client);
    });

    // Handle disconnect
    ws.on('close', () => {
      this.handleDisconnect(ws, client);
    });

    ws.on('error', (error) => {
      logger.error(`WebSocket error for client ${clientId}:`, error);
    });
  }

  /**
   * Handle incoming message from client
   */
  private async handleMessage(ws: WebSocket, data: WebSocket.Data, client: GameClient): Promise<void> {
    try {
      const message: ClientMessage = JSON.parse(data.toString());

      switch (message.type) {
        case 'JOIN_LOBBY':
          await this.handleJoinLobby(ws, message, client);
          break;

        case 'LEAVE_LOBBY':
          await this.handleLeaveLobby(ws, message, client);
          break;

        case 'SHOOT':
          await this.handleShoot(ws, message, client);
          break;

        case 'GET_BALANCE':
          await this.handleGetBalance(ws, message, client);
          break;

        case 'PING':
          this.sendMessage(ws, { type: 'PONG' });
          break;

        default:
          this.sendError(ws, 'Unknown message type', 'UNKNOWN_MESSAGE');
      }
    } catch (error: any) {
      logger.error('Error handling message:', error);
      this.sendError(ws, error.message || 'Internal server error', 'INTERNAL_ERROR');
    }
  }

  /**
   * Handle JOIN_LOBBY
   */
  private async handleJoinLobby(ws: WebSocket, message: Extract<ClientMessage, { type: 'JOIN_LOBBY' }>, client: GameClient): Promise<void> {
    try {
      await gameStateManager.joinLobby(message.playerId, message.username, message.betAmount);
      
      client.playerId = message.playerId;
      
      // Send balance update
      await this.sendBalanceUpdate(message.playerId);
      
      logger.info(`Player ${message.username} (${message.playerId}) joined lobby with bet $${message.betAmount}`);
    } catch (error: any) {
      this.sendError(ws, error.message, 'JOIN_LOBBY_FAILED');
    }
  }

  /**
   * Handle LEAVE_LOBBY
   */
  private async handleLeaveLobby(ws: WebSocket, message: Extract<ClientMessage, { type: 'LEAVE_LOBBY' }>, client: GameClient): Promise<void> {
    // TODO: Implement leave lobby logic
    logger.info(`Player ${message.playerId} left lobby`);
  }

  /**
   * Handle SHOOT
   */
  private async handleShoot(ws: WebSocket, message: Extract<ClientMessage, { type: 'SHOOT' }>, client: GameClient): Promise<void> {
    try {
      await gameStateManager.shoot(message.playerId, message.roundId);
    } catch (error: any) {
      this.sendError(ws, error.message, 'SHOOT_FAILED');
    }
  }

  /**
   * Handle GET_BALANCE
   */
  private async handleGetBalance(ws: WebSocket, message: Extract<ClientMessage, { type: 'GET_BALANCE' }>, client: GameClient): Promise<void> {
    try {
      await this.sendBalanceUpdate(message.playerId);
    } catch (error: any) {
      this.sendError(ws, error.message, 'GET_BALANCE_FAILED');
    }
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(ws: WebSocket, client: GameClient): void {
    this.clients.delete(ws);
    logger.info(`Client ${client.id} disconnected (total: ${this.clients.size})`);
  }

  /**
   * Send message to specific client
   */
  private sendMessage(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send message to all clients
   */
  private broadcastToAll(message: ServerMessage): void {
    for (const [ws] of this.clients) {
      this.sendMessage(ws, message);
    }
  }

  /**
   * Send message to specific player
   */
  private sendToPlayer(playerId: string, message: ServerMessage): void {
    for (const [ws, client] of this.clients) {
      if (client.playerId === playerId) {
        this.sendMessage(ws, message);
      }
    }
  }

  /**
   * Send error message
   */
  private sendError(ws: WebSocket, message: string, code?: string): void {
    const errorMessage: ServerMessage = {
      type: 'ERROR',
      message,
      ...(code !== undefined && { code }),
    };
    this.sendMessage(ws, errorMessage);
  }

  /**
   * Generate unique client ID
   */
  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }
}