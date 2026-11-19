import type { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyToken, type UserRole } from './utils.ts';

interface ClientMeta {
  ws: WebSocket;
  userId: number;
  role: UserRole;
}

class RealtimeHub {
  private clients = new Set<ClientMeta>();

  attach(server: HttpServer) {
    const wss = new WebSocketServer({ server, path: '/ws' });

    wss.on('connection', (ws, req) => {
      try {
        const url = new URL(req.url || '/', 'http://localhost');
        const token = url.searchParams.get('token');
        if (!token) {
          ws.close(4001, 'Missing auth token');
          return;
        }
        const payload = verifyToken(token);
        const client: ClientMeta = {
          ws,
          userId: payload.userId,
          role: payload.role,
        };
        this.clients.add(client);

        ws.send(JSON.stringify({ type: 'connected', userId: payload.userId, role: payload.role }));

        ws.on('close', () => {
          this.clients.delete(client);
        });
        ws.on('error', () => {
          this.clients.delete(client);
        });
      } catch {
        ws.close(4002, 'Invalid token');
      }
    });
  }

  sendToUser(userId: number, event: string, data: unknown) {
    const message = JSON.stringify({ type: event, data });
    for (const client of this.clients) {
      if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }

  sendToRole(roles: UserRole[], event: string, data: unknown) {
    const message = JSON.stringify({ type: event, data });
    for (const client of this.clients) {
      if (roles.includes(client.role) && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }
}

export const realtimeHub = new RealtimeHub();
