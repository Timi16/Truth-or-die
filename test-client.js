/**
 * Simple WebSocket test client for Debonk Game Server
 * 
 * Usage:
 *   node test-client.js [username] [betAmount]
 * 
 * Example:
 *   node test-client.js Alice 50
 */

import WebSocket from 'ws';

const username = process.argv[2] || 'TestPlayer';
const betAmount = parseFloat(process.argv[3] || '10');
const playerId = `player_${username.toLowerCase()}_${Date.now()}`;

console.log(`\n🎮 Connecting to game server as ${username}...`);
console.log(`💰 Bet amount: $${betAmount}\n`);

const ws = new WebSocket('ws://localhost:4000/game');

ws.on('open', () => {
  console.log('✅ Connected to game server\n');
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  
  switch (message.type) {
    case 'CONNECTED':
      console.log(`🔌 Connected! Client ID: ${message.clientId}`);
      console.log(`📊 Requesting balance...\n`);
      
      // Get balance first
      ws.send(JSON.stringify({
        type: 'GET_BALANCE',
        playerId: playerId
      }));
      break;

    case 'BALANCE_UPDATE':
      console.log(`💰 Balance: $${message.balance.toFixed(2)}`);
      console.log(`📈 Total P&L: $${message.totalPnl.toFixed(2)}`);
      console.log(`🎯 Games Played: ${message.gamesPlayed}\n`);
      break;

    case 'LOBBY_UPDATE':
      console.log(`⏰ LOBBY: ${message.secondsRemaining}s remaining`);
      console.log(`👥 Players: ${message.playersInLobby}`);
      console.log(`💵 Total Wagered: $${message.totalWagered.toFixed(2)}`);
      
      // Join lobby when there's time left
      if (message.secondsRemaining > 5 && message.playersInLobby === 0) {
        console.log(`\n🎲 Joining lobby with bet: $${betAmount}...\n`);
        
        ws.send(JSON.stringify({
          type: 'JOIN_LOBBY',
          playerId: playerId,
          username: username,
          betAmount: betAmount
        }));
      }
      break;

    case 'ROUND_START':
      console.log(`\n🚀 ROUND STARTED!`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📊 Pair: ${message.pair}`);
      console.log(`💵 Entry Price: $${message.entryPrice.toFixed(2)}`);
      console.log(`⚡ Leverage: ${message.leverage}X`);
      console.log(`📍 My Position: ${message.myPosition}`);
      console.log(`💰 My Bet: $${message.myBetAmount.toFixed(2)}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
      break;

    case 'PRICE_UPDATE':
      const pnlSymbol = message.pnl >= 0 ? '📈' : '📉';
      const pnlColor = message.pnl >= 0 ? '+' : '';
      
      console.log(`${pnlSymbol} Price: $${message.currentPrice.toFixed(2)} | P&L: ${pnlColor}$${message.pnl.toFixed(2)} (${pnlColor}${message.pnlPercentage.toFixed(2)}%)`);
      
      // Auto-shoot if profit > $5 (optional)
      // if (message.pnl > 5) {
      //   console.log(`\n💥 SHOOTING! Taking profit at $${message.pnl.toFixed(2)}\n`);
      //   ws.send(JSON.stringify({
      //     type: 'SHOOT',
      //     playerId: playerId,
      //     roundId: message.roundId
      //   }));
      // }
      break;

    case 'LIQUIDATED':
      console.log(`\n❌ LIQUIDATED!`);
      console.log(`💔 Lost: $${message.loss.toFixed(2)}\n`);
      break;

    case 'SHOOT_SUCCESS':
      console.log(`\n💥 SHOT SUCCESSFUL!`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📍 Exit Price: $${message.exitPrice.toFixed(2)}`);
      console.log(`💰 P&L: $${message.pnl.toFixed(2)}`);
      console.log(`💵 Payout: $${message.payout.toFixed(2)}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
      break;

    case 'ROUND_END':
      console.log(`\n🏁 ROUND ENDED!`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📍 Final Price: $${message.finalPrice.toFixed(2)}`);
      console.log(`💰 My P&L: $${message.myPnl.toFixed(2)}`);
      console.log(`💵 Payout: $${message.payout.toFixed(2)}`);
      console.log(`🎯 Did Shoot: ${message.didShoot ? 'Yes' : 'No'}`);
      console.log(`📊 Reason: ${message.reason}`);
      console.log(`💵 New Balance: $${message.newBalance.toFixed(2)}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
      break;

    case 'ERROR':
      console.error(`❌ ERROR: ${message.message} (${message.code || 'UNKNOWN'})\n`);
      break;

    case 'PONG':
      // Heartbeat response
      break;

    default:
      console.log(`📨 Unknown message type: ${message.type}`);
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
});

ws.on('close', () => {
  console.log('\n👋 Disconnected from game server\n');
  process.exit(0);
});

// Send ping every 30 seconds
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'PING' }));
  }
}, 30000);

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down...');
  ws.close();
});