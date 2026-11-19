import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

const JWT_SECRET = process.env.JWT_SECRET || 'smartattend-university-dev-secret-2026';

export type UserRole = 'admin' | 'lecturer' | 'student';

export interface AuthPayload {
  userId: number;
  role: UserRole;
  name: string;
}

export interface AuthedRequest extends Request {
  user?: AuthPayload;
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, JWT_SECRET) as AuthPayload;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Please log in.' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired or invalid token. Please log in again.' });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Access denied for your user role.' });
      return;
    }
    next();
  };
}

export function generateQrTokenValue(): string {
  return crypto.randomBytes(18).toString('hex');
}

export function formatQrPayload(sessionId: number, token: string): string {
  return `SA1:${sessionId}:${token}`;
}

export function parseQrPayload(raw: string): { sessionId: number; token: string } | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('SA1:')) {
    const parts = trimmed.split(':');
    if (parts.length === 3) {
      const sessionId = Number(parts[1]);
      const token = parts[2];
      if (Number.isInteger(sessionId) && sessionId > 0 && token.length >= 16) {
        return { sessionId, token };
      }
    }
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && parsed.sessionId && parsed.token) {
      return { sessionId: Number(parsed.sessionId), token: String(parsed.token) };
    }
  } catch {
    // ignore JSON parse failure
  }

  return null;
}

/**
 * Haversine formula to compute distance in meters between two GPS coordinates.
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function csvEscape(value: unknown): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
