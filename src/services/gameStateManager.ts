import { EventEmitter } from "events";
import { CONFIG } from "../config.js";
import { logger } from "../utils/logger.js";
import {
  type GameState,
  type GamePhase,
  type RoundState,
  type PlayerPosition,
  type LobbyPlayer,
  type PriceData,
} from "../types.js";
import { prisma } from "./prisma.js";
import { priceFeedClient } from "./priceFeedClient.js";
import { volatilityService } from "./volatilityService.js";
import {
  selectRandomPair,
  assignRandomPositions,
  generateRandomDuration,
} from "../utils/randomizer.js";
import {
  calculatePnL,
  calculatePnLPercentage,
  calculateLiquidationPrice,
  isLiquidated,
  calculatePayout,
} from "../utils/calculation.js";

/**
 * Core Game State Manager
 * Handles the game loop: LOBBY → ROUND → LOBBY → ROUND ...
 */
export class GameStateManager extends EventEmitter {
  private gameState: GameState;
  private lobbyPlayers: Map<string, LobbyPlayer> = new Map();
  private lobbyTimer: NodeJS.Timeout | null = null;
  private roundTimer: NodeJS.Timeout | null = null;
  private priceUnsubscribe: (() => void) | null = null;

  constructor() {
    super();

    this.gameState = {
      phase: "LOBBY",
      currentRound: null,
      lobbyStartTime: Date.now(),
      lobbyEndTime: Date.now() + CONFIG.GAME.LOBBY_DURATION_SECONDS * 1000,
    };
  }

  async initialize(): Promise<void> {
    logger.info("Initializing Game State Manager...");

    // Start first lobby
    this.startLobby();

    logger.info("✅ Game State Manager initialized");
  }

  /**
   * Start lobby phase
   */
  private startLobby(): void {
    logger.info("🚪 LOBBY PHASE STARTED");

    const now = Date.now();
    this.gameState.phase = "LOBBY";
    this.gameState.currentRound = null;
    this.gameState.lobbyStartTime = now;
    this.gameState.lobbyEndTime =
      now + CONFIG.GAME.LOBBY_DURATION_SECONDS * 1000;

    this.lobbyPlayers.clear();

    // Emit lobby start event
    this.emit("lobby:start", {
      lobbyEndTime: this.gameState.lobbyEndTime,
      duration: CONFIG.GAME.LOBBY_DURATION_SECONDS,
    });

    // Set timer to end lobby
    this.lobbyTimer = setTimeout(() => {
      this.endLobby();
    }, CONFIG.GAME.LOBBY_DURATION_SECONDS * 1000);

    // Broadcast lobby updates every second (start after 1 second, not immediately)
    const lobbyUpdateInterval = setInterval(() => {
      if (this.gameState.phase !== "LOBBY") {
        clearInterval(lobbyUpdateInterval);
        return;
      }

      const secondsRemaining = Math.max(
        0,
        Math.ceil((this.gameState.lobbyEndTime! - Date.now()) / 1000),
      );
      const totalWagered = Array.from(this.lobbyPlayers.values()).reduce(
        (sum, p) => sum + p.betAmount,
        0,
      );

      this.emit("lobby:update", {
        secondsRemaining,
        playersInLobby: this.lobbyPlayers.size,
        totalWagered,
        players: Array.from(this.lobbyPlayers.values()),
      });
    }, 1000); // ← This is correct, but remove the duplicate lobby:start broadcast
  }
  /**
   * End lobby and start round
   */
  private async endLobby(): Promise<void> {
    logger.info("🚪 LOBBY PHASE ENDED");

    if (this.lobbyPlayers.size === 0) {
      logger.warn("No players in lobby. Starting new lobby...");
      this.startLobby();
      return;
    }

    // Select random high-volatility pair
    const volatilePairs = volatilityService.getHighVolatilityPairs();
    const selectedPair = selectRandomPair(volatilePairs);

    if (!selectedPair) {
      logger.error("No volatile pairs available. Starting new lobby...");
      this.startLobby();
      return;
    }

    await this.startRound(selectedPair);
  }

  /**
   * Start trading round
   */
  private async startRound(pair: string): Promise<void> {
    logger.info(`🎮 ROUND STARTED - Pair: ${pair}`);

    const now = Date.now();
    const leverage = CONFIG.GAME.DEFAULT_LEVERAGE;
    const duration = generateRandomDuration(
      leverage,
      CONFIG.GAME.MIN_ROUND_DURATION_SECONDS,
      CONFIG.GAME.MAX_ROUND_DURATION_SECONDS,
    );

    // Get current price as entry price
    let entryPrice: number;
    try {
      const priceData = await this.getCurrentPrice(pair);
      entryPrice = priceData.price;
    } catch (error) {
      logger.error(`Failed to get entry price for ${pair}:`, error);
      this.startLobby();
      return;
    }

    // Calculate total wagered
    const totalWagered = Array.from(this.lobbyPlayers.values()).reduce(
      (sum, p) => sum + p.betAmount,
      0,
    );

    // Create round in database
    const round = await prisma.round.create({
      data: {
        pair,
        entryPrice,
        leverage,
        durationSeconds: duration,
        startedAt: new Date(now),
        status: "active",
      },
    });

    // Assign random positions to players
    const playerIds = Array.from(this.lobbyPlayers.keys());
    const positionAssignments = assignRandomPositions(playerIds);

    // Create positions map
    const positions = new Map<string, PlayerPosition>();

    for (const [playerId, positionType] of positionAssignments.entries()) {
      const lobbyPlayer = this.lobbyPlayers.get(playerId)!;

      positions.set(playerId, {
        playerId,
        positionType,
        betAmount: lobbyPlayer.betAmount,
        entryPrice,
        currentPnl: 0,
        liquidated: false,
        didShoot: false,
        shotAt: null,
      });

      // Save position to database
      await prisma.position.create({
        data: {
          roundId: round.id,
          playerId,
          positionType,
          entryAmount: lobbyPlayer.betAmount,
        },
      });

      // Deduct bet amount from player balance
      await prisma.player.update({
        where: { id: playerId },
        data: {
          demoBalance: { decrement: lobbyPlayer.betAmount },
        },
      });

      logger.info(
        `Player ${playerId} bet $${lobbyPlayer.betAmount} - Position: ${positionType}`,
      );
    }

    // Delete lobby entries from database
    await prisma.lobbyEntry.deleteMany({
      where: {
        playerId: { in: playerIds },
      },
    });

    // Update game state
    this.gameState.phase = "ROUND";
    this.gameState.currentRound = {
      id: round.id,
      pair,
      entryPrice,
      currentPrice: entryPrice,
      leverage,
      startTime: now,
      endTime: null,
      duration,
      totalWagered,
      positions,
    };

    // Clear lobby players
    this.lobbyPlayers.clear();

    // Emit round start event
    this.emit("round:start", {
      roundId: round.id,
      pair,
      entryPrice,
      leverage,
      duration,
      totalWagered,
      positions: Array.from(positions.entries()).map(([playerId, pos]) => ({
        playerId,
        positionType: pos.positionType,
        betAmount: pos.betAmount,
      })),
    });

    // Subscribe to price updates
    this.priceUnsubscribe = priceFeedClient.subscribeToPair(
      pair,
      (priceData: PriceData) => {
        this.handlePriceUpdate(priceData);
      },
    );

    // Set timer to end round
    this.roundTimer = setTimeout(() => {
      this.endRound("time_expired");
    }, duration * 1000);

    logger.info(
      `Round will end in ${duration}s - Total wagered: $${totalWagered}`,
    );
  }

  /**
   * Handle price updates during round
   */
  private handlePriceUpdate(priceData: PriceData): void {
    if (this.gameState.phase !== "ROUND" || !this.gameState.currentRound) {
      return;
    }

    const round = this.gameState.currentRound;
    round.currentPrice = priceData.price;

    // Update all positions
    for (const [playerId, position] of round.positions.entries()) {
      if (position.liquidated || position.didShoot) {
        continue; // Skip already closed positions
      }

      // Calculate current P&L
      const pnl = calculatePnL(
        position.positionType,
        position.entryPrice,
        priceData.price,
        position.betAmount,
        round.leverage,
      );

      position.currentPnl = pnl;

      // Check for liquidation
      if (
        isLiquidated(
          position.positionType,
          position.entryPrice,
          priceData.price,
          round.leverage,
        )
      ) {
        position.liquidated = true;

        logger.warn(
          `Player ${playerId} LIQUIDATED at $${priceData.price} - Lost $${position.betAmount}`,
        );

        this.emit("player:liquidated", {
          playerId,
          roundId: round.id,
          finalPrice: priceData.price,
          loss: position.betAmount,
        });

        // Update database
        prisma.position
          .updateMany({
            where: {
              roundId: round.id,
              playerId: playerId,
            },
            data: {
              liquidated: true,
              pnl: -position.betAmount,
              exitPrice: priceData.price,
            },
          })
          .catch((error) =>
            logger.error("Error updating liquidated position:", error),
          );

        // Update player stats
        prisma.player
          .update({
            where: { id: playerId },
            data: {
              totalPnl: { decrement: position.betAmount },
              gamesLost: { increment: 1 },
            },
          })
          .catch((error) =>
            logger.error("Error updating player stats:", error),
          );
      }
    }

    // Emit price update
    this.emit("price:update", {
      roundId: round.id,
      pair: round.pair,
      currentPrice: priceData.price,
      positions: Array.from(round.positions.entries()).map(
        ([playerId, pos]) => ({
          playerId,
          pnl: pos.currentPnl,
          pnlPercentage: calculatePnLPercentage(pos.currentPnl, pos.betAmount),
          liquidated: pos.liquidated,
        }),
      ),
    });
  }

  /**
   * End trading round
   */
  /**
   * End trading round
   */
  private async endRound(reason: string): Promise<void> {
    if (this.gameState.phase !== "ROUND" || !this.gameState.currentRound) {
      return;
    }

    logger.info(`🎮 ROUND ENDED - Reason: ${reason}`);

    const round = this.gameState.currentRound;
    const finalPrice = round.currentPrice;

    // Unsubscribe from price updates
    if (this.priceUnsubscribe) {
      this.priceUnsubscribe();
      this.priceUnsubscribe = null;
    }

    // Calculate final payouts
    const payouts: Array<{
      playerId: string;
      payout: number;
      pnl: number;
      didShoot: boolean;
    }> = [];

    for (const [playerId, position] of round.positions.entries()) {
      const pnl =
        position.didShoot || position.liquidated
          ? position.currentPnl
          : calculatePnL(
              position.positionType,
              position.entryPrice,
              finalPrice,
              position.betAmount,
              round.leverage,
            );

      const payout = calculatePayout(
        position.betAmount,
        pnl,
        position.didShoot,
        position.liquidated,
      );

      payouts.push({ playerId, payout, pnl, didShoot: position.didShoot });

      // Update position in database
      await prisma.position.updateMany({
        where: {
          roundId: round.id,
          playerId: playerId,
        },
        data: {
          exitPrice: finalPrice,
          pnl,
        },
      });

      // Update player balance and stats
      const balanceChange = payout; // Payout is what they get back
      const pnlChange = pnl; // P&L is profit/loss

      // Build update data conditionally to avoid undefined values
      const updateData: any = {
        demoBalance: { increment: balanceChange },
        totalPnl: { increment: pnlChange },
        gamesPlayed: { increment: 1 },
      };

      // Only add gamesWon/gamesLost if the condition is true
      if (pnl > 0) {
        updateData.gamesWon = { increment: 1 };
      } else if (pnl < 0) {
        updateData.gamesLost = { increment: 1 };
      }

      await prisma.player.update({
        where: { id: playerId },
        data: updateData,
      });

      logger.info(
        `Player ${playerId} - Bet: $${position.betAmount}, P&L: $${pnl.toFixed(2)}, Payout: $${payout.toFixed(2)}`,
      );
    }

    // Update round in database
    await prisma.round.update({
      where: { id: round.id },
      data: {
        exitPrice: finalPrice,
        endedAt: new Date(),
        status: "completed",
      },
    });

    // Emit round end event
    this.emit("round:end", {
      roundId: round.id,
      pair: round.pair,
      finalPrice,
      reason,
      payouts,
    });

    // Start new lobby
    this.startLobby();
  }

  /**
   * Player joins lobby
   */
  /**
   * Player joins lobby
   */
  async joinLobby(
    playerId: string,
    username: string,
    betAmount: number,
  ): Promise<void> {
    if (this.gameState.phase !== "LOBBY") {
      throw new Error("Cannot join lobby during active round");
    }

    // Validate bet amount
    if (betAmount < CONFIG.PLAYER.MIN_BET_AMOUNT) {
      throw new Error(`Minimum bet is $${CONFIG.PLAYER.MIN_BET_AMOUNT}`);
    }

    // Check if player already in lobby
    if (this.lobbyPlayers.has(playerId)) {
      throw new Error("Already in lobby");
    }

    // Use upsert to create or update player
    const player = await prisma.player.upsert({
      where: { username },
      update: {
        id: playerId, // Update ID if username exists
      },
      create: {
        id: playerId,
        username,
        demoBalance: CONFIG.PLAYER.DEFAULT_DEMO_BALANCE,
      },
    });

    logger.info(
      player.createdAt.getTime() === player.updatedAt.getTime()
        ? `New player created: ${username} with $${CONFIG.PLAYER.DEFAULT_DEMO_BALANCE} balance`
        : `Existing player ${username} reconnected`,
    );

    // Check balance
    if (Number(player.demoBalance) < betAmount) {
      throw new Error(
        `Insufficient balance. You have $${Number(player.demoBalance).toFixed(2)}, need $${betAmount.toFixed(2)}`,
      );
    }

    // Add to lobby
    this.lobbyPlayers.set(playerId, {
      playerId,
      username,
      betAmount,
      balance: Number(player.demoBalance),
      joinedAt: Date.now(),
    });

    // Save to database
    await prisma.lobbyEntry.create({
      data: {
        playerId,
        betAmount,
      },
    });

    logger.info(
      `Player ${username} joined lobby with bet $${betAmount} (Balance: $${Number(player.demoBalance).toFixed(2)})`,
    );

    this.emit("lobby:player_joined", {
      playerId,
      username,
      betAmount,
      balance: Number(player.demoBalance),
    });
  }

  /**
   * Player shoots (exits position early)
   */
  async shoot(playerId: string, roundId: string): Promise<void> {
    if (this.gameState.phase !== "ROUND" || !this.gameState.currentRound) {
      throw new Error("No active round");
    }

    if (this.gameState.currentRound.id !== roundId) {
      throw new Error("Round ID mismatch");
    }

    const position = this.gameState.currentRound.positions.get(playerId);
    if (!position) {
      throw new Error("Position not found");
    }

    if (position.didShoot) {
      throw new Error("Already shot");
    }

    if (position.liquidated) {
      throw new Error("Position liquidated");
    }

    // Mark as shot
    position.didShoot = true;
    position.shotAt = Date.now();

    const exitPrice = this.gameState.currentRound.currentPrice;
    const pnl = position.currentPnl;
    const payout = calculatePayout(position.betAmount, pnl, true, false);

    // Update database
    await prisma.position.updateMany({
      where: {
        roundId: roundId,
        playerId: playerId,
      },
      data: {
        didShoot: true,
        shotAt: new Date(),
        exitPrice,
        pnl,
      },
    });

    // Update player balance immediately
    await prisma.player.update({
      where: { id: playerId },
      data: {
        demoBalance: { increment: payout },
        totalPnl: { increment: pnl },
      },
    });

    // Get updated balance
    const player = await prisma.player.findUnique({ where: { id: playerId } });
    const newBalance = player ? Number(player.demoBalance) : 0;

    logger.info(
      `Player ${playerId} SHOT at $${exitPrice} - P&L: $${pnl.toFixed(2)}, Payout: $${payout.toFixed(2)}`,
    );

    this.emit("player:shoot", {
      playerId,
      roundId,
      exitPrice,
      pnl,
      payout,
      newBalance,
    });
  }

  /**
   * Get player balance
   */
  async getPlayerBalance(playerId: string): Promise<{
    balance: number;
    totalPnl: number;
    gamesPlayed: number;
  } | null> {
    const player = await prisma.player.findUnique({ where: { id: playerId } });

    if (!player) {
      return null;
    }

    return {
      balance: Number(player.demoBalance),
      totalPnl: Number(player.totalPnl),
      gamesPlayed: player.gamesPlayed,
    };
  }

  /**
   * Get current game state
   */
  getGameState(): GameState {
    return this.gameState;
  }

  /**
   * Get current price for a pair
   */
  private async getCurrentPrice(pair: string): Promise<PriceData> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error("Timeout getting current price"));
      }, 5000);

      const unsubscribe = priceFeedClient.subscribeToPair(pair, (priceData) => {
        clearTimeout(timeout);
        unsubscribe();
        resolve(priceData);
      });
    });
  }

  close(): void {
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer);
    if (this.roundTimer) clearTimeout(this.roundTimer);
    if (this.priceUnsubscribe) this.priceUnsubscribe();

    this.removeAllListeners();
    logger.info("Game State Manager closed");
  }
}

export const gameStateManager = new GameStateManager();
