import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Root directory of the applet
export const ROOT_DIR = path.resolve(__dirname, '../../');

export const PORT = Number(process.env.PORT) || 3000;
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'BhaiKaSecret123';

export const USERS_FILE = path.join(ROOT_DIR, 'users.json');
export const ACCOUNTS_FILE = path.join(ROOT_DIR, 'accounts.json');
export const SECRET_KEY_FILE = path.join(ROOT_DIR, 'secret.key');
export const MASTER_PROXY_FILE = path.join(ROOT_DIR, 'proxy_config.json');
export const THEME_CONFIG_FILE = path.join(ROOT_DIR, 'theme_config.json');
export const SQLITE_DB_FILE = path.join(ROOT_DIR, 'telebot.db');
export const BILLING_FILE = path.join(ROOT_DIR, 'billing.json');
export const ACCESS_REQUESTS_FILE = path.join(ROOT_DIR, 'access_requests.json');
export const GLOBAL_AI_CONFIG_FILE = path.join(ROOT_DIR, 'global_ai_config.json');

/**
 * Universal timeout wrapper to prevent hanging promises or deadlocks
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number = 20000, errorMsg: string = 'Operation timed out'): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(errorMsg)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
