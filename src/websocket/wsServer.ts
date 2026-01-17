import { Server as HTTPServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { logger } from '../utils/logger.js';
import { WebSocketHandler } from './wsHandler.js';

export function createWebSocketServer(httpServer: HTTPServer): WebSocketServer {
  const wss = new WebSocketServer({ 
    server: httpServer,
    path: '/game'
  });

  const handler = new WebSocketHandler();

  wss.on('connection', (ws: WebSocket) => {
    handler.handleConnection(ws); 
  });

  wss.on('error', (error: any) => {
    logger.error('WebSocket server error:', error);
  });

  logger.info('WebSocket server created on path /game');

  return wss;
}