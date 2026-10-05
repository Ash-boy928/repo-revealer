import fs from 'fs';
import os from 'os';
import { SECRET_KEY_FILE, SQLITE_DB_FILE } from '../config/constants.ts';

// ==========================================
// 🛡️ TELEBOT SECURITY HARDENING SUITE
// ==========================================

/**
 * 1. Linux File Permission Guard
 * Enforces chmod 600 (read/write by owner only) on SQLite DB and Secret Key.
 * Prevents unauthorized local inspection by other processes or web users.
 */
export function enforceSecureFilePermissions(): void {
  // Only execute on POSIX systems (Linux/macOS)
  if (os.platform() === 'win32') return;

  const targetFiles = [
    SECRET_KEY_FILE,
    SQLITE_DB_FILE,
    `${SQLITE_DB_FILE}-wal`,
    `${SQLITE_DB_FILE}-shm`
  ];

  for (const f of targetFiles) {
    if (fs.existsSync(f)) {
      try {
        fs.chmodSync(f, 0o600);
      } catch (err: any) {
        // Silently continue if filesystem doesn't support chmod (e.g. FAT32/mounted volume)
      }
    }
  }
  console.log('[SECURITY] File permission guard active (chmod 600 enforced on DB & Keys).');
}

/**
 * 2. IP Brute-Force & Rate-Limiting Protection for Login
 * Defends against automated password guessing / dictionary attacks.
 */
interface FailedLoginAttempt {
  count: number;
  firstAttemptAt: number;
  lockedUntil: number;
}

const failedLoginStore = new Map<string, FailedLoginAttempt>();

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 5 * 60 * 1000;   // 5 minutes attempt window
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes temporary lockout

export function getClientIp(req: any): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ip = String(forwarded).split(',')[0].trim();
    if (ip) return ip;
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Express Middleware: Inspects if client IP is currently locked out
 */
export function checkLoginBruteForce(req: any, res: any, next: any): void {
  const ip = getClientIp(req);
  const now = Date.now();
  const record = failedLoginStore.get(ip);

  if (record && record.lockedUntil > now) {
    const remainingMins = Math.ceil((record.lockedUntil - now) / 60000);
    return res.status(429).json({
      ok: false,
      msg: `🛡️ Security Lockout: Too many failed login attempts from your IP. Temporarily blocked for ${remainingMins} more minute(s).`,
      locked: true,
      remaining_minutes: remainingMins
    });
  }

  next();
}

/**
 * Record a failed login attempt for this client IP
 */
export function recordFailedLoginAttempt(ip: string): { locked: boolean; remainingAttempts: number; lockoutMins: number } {
  const now = Date.now();
  let record = failedLoginStore.get(ip);

  if (!record || (now - record.firstAttemptAt > LOCKOUT_WINDOW_MS && record.lockedUntil <= now)) {
    record = { count: 1, firstAttemptAt: now, lockedUntil: 0 };
    failedLoginStore.set(ip, record);
    return { locked: false, remainingAttempts: MAX_FAILED_ATTEMPTS - 1, lockoutMins: 0 };
  }

  record.count += 1;

  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_DURATION_MS;
    console.warn(`[SECURITY ALERT] IP ${ip} temporarily locked out for 15 minutes due to ${record.count} failed login attempts.`);
    return { locked: true, remainingAttempts: 0, lockoutMins: Math.ceil(LOCKOUT_DURATION_MS / 60000) };
  }

  return { locked: false, remainingAttempts: MAX_FAILED_ATTEMPTS - record.count, lockoutMins: 0 };
}

/**
 * Clear lockout upon successful authentication
 */
export function recordSuccessfulLogin(ip: string): void {
  failedLoginStore.delete(ip);
}

// Memory guard: Automatically purge stale IP records every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of failedLoginStore.entries()) {
    if (record.lockedUntil <= now && (now - record.firstAttemptAt > LOCKOUT_WINDOW_MS)) {
      failedLoginStore.delete(ip);
    }
  }
}, 10 * 60 * 1000);
