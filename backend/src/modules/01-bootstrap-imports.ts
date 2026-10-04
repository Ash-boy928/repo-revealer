import express from 'express';
import os from 'os';
import net from 'net';
import { execSync } from 'child_process';
import cookieSession from 'cookie-session';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

// Telegram MTProto Client (GramJS)
import { TelegramClient, Api, utils } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper: Wrap network promises with an aggressive timeout to prevent socket deadlocks/hangs
function withTimeout<T>(promise: Promise<T>, timeoutMs: number = 20000, errorMsg: string = 'Operation timed out'): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(errorMsg)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// Intercept unhandled network/ping timeouts to prevent noisy crashes
process.on('unhandledRejection', (reason: any) => {
  const msg = reason?.message || String(reason || '');
  if (/timeout|ETIMEDOUT|ESOCKETTIMEDOUT|ECONNRESET/i.test(msg)) return;
  console.warn('[Unhandled Rejection]:', msg);
});

process.on('uncaughtException', (err: any) => {
  const msg = err?.message || String(err || '');
  if (/timeout|ETIMEDOUT|ESOCKETTIMEDOUT|ECONNRESET/i.test(msg)) return;
  console.warn('[Uncaught Exception]:', msg);
});

const PORT = 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'BhaiKaSecret123';
const USERS_FILE = path.join(__dirname, 'users.json');
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.json');
const SECRET_KEY_FILE = path.join(__dirname, 'secret.key');
const MASTER_PROXY_FILE = path.join(__dirname, 'proxy_config.json');
const THEME_CONFIG_FILE = path.join(__dirname, 'theme_config.json');
const SQLITE_DB_FILE = path.join(__dirname, 'telebot.db');

