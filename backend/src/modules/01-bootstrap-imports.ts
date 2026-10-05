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

// Core Configuration & Shared Constants
import {
  PORT,
  ADMIN_PASSWORD,
  USERS_FILE,
  ACCOUNTS_FILE,
  SECRET_KEY_FILE,
  MASTER_PROXY_FILE,
  THEME_CONFIG_FILE,
  SQLITE_DB_FILE,
  BILLING_FILE,
  ACCESS_REQUESTS_FILE,
  GLOBAL_AI_CONFIG_FILE,
  withTimeout
} from './src/config/constants.ts';

