import fs from 'fs';
import { THEME_CONFIG_FILE, MASTER_PROXY_FILE } from '../config/constants.ts';
import { asyncSaveJson } from '../utils/fileWriter.ts';

// ---------------- THEME CONFIGURATION ----------------
export function getGlobalTheme(): string {
  try {
    if (fs.existsSync(THEME_CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(THEME_CONFIG_FILE, 'utf8'));
      if (data && data.theme) return data.theme;
    }
  } catch {}
  return 'cyberpunk';
}

export function saveGlobalTheme(theme: string): void {
  try {
    fs.writeFileSync(THEME_CONFIG_FILE, JSON.stringify({ theme, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving theme_config.json:', err);
  }
}

// ---------------- MASTER PROXY ARCHITECTURE ----------------
export interface MasterProxyConfig {
  enabled: boolean;
  protocol: 'socks5' | 'http';
  host: string;
  port: number;
  username: string;
  password: string;
  country: string;
  session_duration_mins: number;
  auto_sticky_per_phone: boolean;
}

export let masterProxyConfig: MasterProxyConfig = {
  enabled: false,
  protocol: 'socks5',
  host: '',
  port: 0,
  username: '',
  password: '',
  country: '',
  session_duration_mins: 30,
  auto_sticky_per_phone: true
};

export function loadMasterProxyConfig(): void {
  try {
    if (fs.existsSync(MASTER_PROXY_FILE)) {
      const data = JSON.parse(fs.readFileSync(MASTER_PROXY_FILE, 'utf8'));
      masterProxyConfig = { ...masterProxyConfig, ...data };
    }
  } catch (e) {
    console.error('Error loading proxy_config.json:', e);
  }
}

export function saveMasterProxyConfig(): void {
  try {
    asyncSaveJson(MASTER_PROXY_FILE, masterProxyConfig, 300);
  } catch (e) {
    console.error('Error saving proxy_config.json:', e);
  }
}

loadMasterProxyConfig();

export function getEffectiveProxyForAccount(phone: string, a: any): any {
  if (a && a.proxy && a.proxy.protocol && a.proxy.protocol !== 'none' && a.proxy.ip && Number(a.proxy.port) > 0) {
    if (a.proxy.protocol === 'socks5') {
      return {
        ip: a.proxy.ip,
        port: Number(a.proxy.port),
        socksType: 5,
        username: a.proxy.username || undefined,
        password: a.proxy.password || undefined
      };
    } else if (a.proxy.protocol === 'mtproxy') {
      return {
        ip: a.proxy.ip,
        port: Number(a.proxy.port),
        MTProxy: true,
        secret: a.proxy.secret
      };
    }
  }

  if (masterProxyConfig.enabled && masterProxyConfig.host && Number(masterProxyConfig.port) > 0) {
    const rawCleanPhone = (phone || '').replace(/[^0-9]/g, '');
    let finalUsername = masterProxyConfig.username || '';

    if (masterProxyConfig.auto_sticky_per_phone && finalUsername && rawCleanPhone) {
      if (!finalUsername.includes('session-') && !finalUsername.includes('sess-')) {
        let sessionTag = `_session-${rawCleanPhone}_lifetime-${masterProxyConfig.session_duration_mins || 30}m`;
        if (masterProxyConfig.country) {
          sessionTag = `_country-${masterProxyConfig.country.toLowerCase()}` + sessionTag;
        }
        finalUsername = `${finalUsername}${sessionTag}`;
      }
    }

    return {
      ip: masterProxyConfig.host,
      port: Number(masterProxyConfig.port),
      socksType: masterProxyConfig.protocol === 'socks5' ? 5 : undefined,
      username: finalUsername || undefined,
      password: masterProxyConfig.password || undefined
    };
  }

  return null;
}
