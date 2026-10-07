import { sqliteDb, getDbKv, setDbKv } from '../db/sqlite.ts';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface GrowthBotConfig {
  bot_token: string;
  bot_username: string;
  enabled: boolean;
  global_broadcast_delay_ms: number;
  admin_telegram_id?: string;
}

export interface GrowthCampaign {
  id: string;
  owner: string;
  campaign_slug: string;
  title: string;
  channel_username: string;
  channel_id?: string;
  lock_message: string;
  unlock_content: string;
  banner_url?: string;
  video_url?: string;
  video_caption?: string;
  audio_url?: string;
  apk_url?: string;
  apk_caption?: string;
  contact_username?: string;
  contact_button_text?: string;
  contact_prefill_text?: string;
  extra_buttons_json?: string;
  button_text?: string;
  status: 'active' | 'paused';
  billing_status?: 'active' | 'unpaid' | 'suspended';
  customer_tg_id?: string;
  bot_token?: string;
  bot_username?: string;
  admin_notes?: string;
  created_at: number;
  updated_at: number;
}

export interface GrowthSubscriber {
  id: string;
  owner: string;
  campaign_id: string;
  telegram_id: number;
  username: string;
  first_name: string;
  last_name: string;
  is_joined: number;
  joined_at: number;
  last_active_at: number;
  created_at: number;
}

export interface GrowthBroadcast {
  id: string;
  owner: string;
  campaign_name: string;
  message_text: string;
  media_type: 'text' | 'photo';
  media_url?: string;
  buttons_json?: string;
  target_filter: 'all' | 'joined_only' | 'pending_only';
  total_targets: number;
  sent_count: number;
  failed_count: number;
  status: 'pending' | 'processing' | 'completed' | 'cancelled';
  created_at: number;
  completed_at?: number;
}

// ---------------- CONFIG MANAGEMENT ----------------
const GROWTH_CONFIG_KEY = 'growth_master_bot_config';

export function getGrowthBotConfig(): GrowthBotConfig {
  const cfg = getDbKv<GrowthBotConfig>(GROWTH_CONFIG_KEY, null);
  if (cfg && typeof cfg === 'object') {
    return {
      bot_token: cfg.bot_token || '',
      bot_username: cfg.bot_username || '',
      enabled: cfg.enabled !== undefined ? cfg.enabled : true,
      global_broadcast_delay_ms: cfg.global_broadcast_delay_ms || 40, // ~25 msg/sec
      admin_telegram_id: cfg.admin_telegram_id || ''
    };
  }
  return {
    bot_token: '',
    bot_username: '',
    enabled: true,
    global_broadcast_delay_ms: 40,
    admin_telegram_id: ''
  };
}

export function saveGrowthBotConfig(config: Partial<GrowthBotConfig>): GrowthBotConfig {
  const current = getGrowthBotConfig();
  const updated: GrowthBotConfig = {
    ...current,
    ...config
  };
  setDbKv(GROWTH_CONFIG_KEY, updated);
  return updated;
}

// ---------------- CAMPAIGN MANAGEMENT ----------------
export function getCampaignsByOwner(owner: string): GrowthCampaign[] {
  if (!sqliteDb) return [];
  try {
    const rows = sqliteDb.prepare("SELECT * FROM growth_campaigns WHERE owner = ? ORDER BY created_at DESC").all(owner);
    return rows as GrowthCampaign[];
  } catch (err) {
    console.error('[GROWTH ENGINE] getCampaignsByOwner error:', err);
    return [];
  }
}

export function getAllCampaigns(): GrowthCampaign[] {
  if (!sqliteDb) return [];
  try {
    const rows = sqliteDb.prepare("SELECT * FROM growth_campaigns ORDER BY created_at DESC").all();
    return rows as GrowthCampaign[];
  } catch (err) {
    console.error('[GROWTH ENGINE] getAllCampaigns error:', err);
    return [];
  }
}

export function getAllCampaignsWithStats(): Array<GrowthCampaign & { subscribers_total: number; subscribers_joined: number }> {
  if (!sqliteDb) return [];
  try {
    const rows = sqliteDb.prepare(`
      SELECT c.*, 
        COALESCE(s.total, 0) as subscribers_total,
        COALESCE(s.joined, 0) as subscribers_joined
      FROM growth_campaigns c
      LEFT JOIN (
        SELECT campaign_id, COUNT(*) as total, SUM(CASE WHEN is_joined = 1 THEN 1 ELSE 0 END) as joined
        FROM growth_subscribers
        GROUP BY campaign_id
      ) s ON c.id = s.campaign_id
      ORDER BY c.created_at DESC
    `).all();
    return rows as any;
  } catch (err) {
    console.error('[GROWTH ENGINE] getAllCampaignsWithStats error:', err);
    return [];
  }
}

export function getCampaignBySlug(slug: string): GrowthCampaign | null {
  if (!sqliteDb) return null;
  try {
    const row = sqliteDb.prepare("SELECT * FROM growth_campaigns WHERE campaign_slug = ?").get(slug);
    return (row as GrowthCampaign) || null;
  } catch (err) {
    console.error('[GROWTH ENGINE] getCampaignBySlug error:', err);
    return null;
  }
}

export function getCampaignById(id: string): GrowthCampaign | null {
  if (!sqliteDb) return null;
  try {
    const row = sqliteDb.prepare("SELECT * FROM growth_campaigns WHERE id = ?").get(id);
    return (row as GrowthCampaign) || null;
  } catch (err) {
    console.error('[GROWTH ENGINE] getCampaignById error:', err);
    return null;
  }
}

export function getCampaignByToken(botToken: string): GrowthCampaign | null {
  if (!sqliteDb || !botToken) return null;
  try {
    const row = sqliteDb.prepare("SELECT * FROM growth_campaigns WHERE bot_token = ? LIMIT 1").get(botToken.trim());
    return (row as GrowthCampaign) || null;
  } catch (err) {
    return null;
  }
}

export function getAllDedicatedBotCampaigns(): GrowthCampaign[] {
  if (!sqliteDb) return [];
  try {
    const rows = sqliteDb.prepare(
      "SELECT * FROM growth_campaigns WHERE bot_token IS NOT NULL AND TRIM(bot_token) != '' AND status = 'active'"
    ).all();
    return rows as GrowthCampaign[];
  } catch (err) {
    return [];
  }
}

export function getCampaignByCustomerTg(tgIdOrUsername: string | number): GrowthCampaign | null {
  if (!sqliteDb) return null;
  try {
    const raw = String(tgIdOrUsername).trim();
    const clean = raw.replace(/^@/, '');
    const row = sqliteDb.prepare(
      "SELECT * FROM growth_campaigns WHERE customer_tg_id = ? OR customer_tg_id = ? OR customer_tg_id = ? OR owner = ? ORDER BY updated_at DESC LIMIT 1"
    ).get(raw, clean, `@${clean}`, clean);
    return (row as GrowthCampaign) || null;
  } catch (err) {
    console.error('[GROWTH ENGINE] getCampaignByCustomerTg error:', err);
    return null;
  }
}

export function setCampaignBillingStatus(idOrSlug: string, status: 'active' | 'unpaid' | 'suspended', notes?: string): boolean {
  if (!sqliteDb) return false;
  try {
    const res = sqliteDb.prepare(
      "UPDATE growth_campaigns SET billing_status = ?, admin_notes = COALESCE(?, admin_notes), updated_at = ? WHERE id = ? OR campaign_slug = ?"
    ).run(status, notes || null, Date.now(), idOrSlug, idOrSlug);
    return res.changes > 0;
  } catch (err) {
    console.error('[GROWTH ENGINE] setCampaignBillingStatus error:', err);
    return false;
  }
}

export function linkCampaignToCustomerTg(slugOrId: string, tgIdOrUsername: string): boolean {
  if (!sqliteDb) return false;
  try {
    const clean = String(tgIdOrUsername).trim();
    const res = sqliteDb.prepare(
      "UPDATE growth_campaigns SET customer_tg_id = ?, updated_at = ? WHERE id = ? OR campaign_slug = ?"
    ).run(clean, Date.now(), slugOrId, slugOrId);
    return res.changes > 0;
  } catch (err) {
    console.error('[GROWTH ENGINE] linkCampaignToCustomerTg error:', err);
    return false;
  }
}

export function saveCampaign(owner: string, data: Partial<GrowthCampaign>): { ok: boolean; campaign?: GrowthCampaign; msg?: string } {
  if (!sqliteDb) return { ok: false, msg: 'Database not initialized' };
  try {
    let slug = (data.campaign_slug || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!slug) {
      slug = `c_${owner.substring(0, 8)}_${Math.random().toString(36).substring(2, 7)}`;
    }

    // Check slug collision
    const existingSlug = getCampaignBySlug(slug);
    if (existingSlug && existingSlug.id !== data.id) {
      return { ok: false, msg: `Slug "${slug}" already exists! Please choose another unique slug.` };
    }

    const id = data.id || `cmp_${crypto.randomBytes(6).toString('hex')}`;
    const now = Date.now();

    const existingCampaign = data.id ? getCampaignById(data.id) : null;
    
    // Cleanup old files if replaced
    if (existingCampaign) {
      safeDeleteOldUpload(existingCampaign.banner_url, data.banner_url);
      safeDeleteOldUpload(existingCampaign.video_url, data.video_url);
      safeDeleteOldUpload(existingCampaign.audio_url, data.audio_url);
      safeDeleteOldUpload(existingCampaign.apk_url, data.apk_url);
    }

    const campaign: GrowthCampaign = {
      id,
      owner,
      campaign_slug: slug,
      title: data.title !== undefined ? data.title : (existingCampaign?.title || 'Official VIP Channel Link'),
      channel_username: data.channel_username !== undefined ? data.channel_username.trim().replace(/^@/, '') : (existingCampaign?.channel_username || ''),
      channel_id: data.channel_id !== undefined ? data.channel_id : (existingCampaign?.channel_id || ''),
      lock_message: data.lock_message !== undefined ? data.lock_message : (existingCampaign?.lock_message || '⭐️ <b>HELLO {first_name}</b> ⭐️\n\n🔒 <b>ACCESS LOCKED!</b>\nPlease join our official VIP channel below to unlock full access & instant APK/Video download.\n\nAfter joining, tap <b>✅ Check Membership</b>.'),
      unlock_content: data.unlock_content !== undefined ? data.unlock_content : (existingCampaign?.unlock_content || '⭐️ <b>HELLO {first_name}</b> ⭐️\n⭐️ <b>AAPKI REQUEST APPROVE HO GAYI HAI</b> ⭐️\n\n⭐️ <b>SETUP VIDEO & HACK APK NEECHE DIYA GAYA HAI</b> ⭐️\n\n🎬 Setup Video: https://youtu.be/your_video\n📥 Download APK: https://t.me/your_apk_link'),
      banner_url: data.banner_url !== undefined ? data.banner_url : (existingCampaign?.banner_url || ''),
      video_url: data.video_url !== undefined ? data.video_url : (existingCampaign?.video_url || ''),
      video_caption: data.video_caption !== undefined ? data.video_caption : (existingCampaign?.video_caption || '✅ NEW HACK How To Activate Hack ✅\nPls Video Ko Pura Dekhna'),
      audio_url: data.audio_url !== undefined ? data.audio_url : (existingCampaign?.audio_url || ''),
      apk_url: data.apk_url !== undefined ? data.apk_url : (existingCampaign?.apk_url || ''),
      apk_caption: data.apk_caption !== undefined ? data.apk_caption : (existingCampaign?.apk_caption || 'DM FIRST VIP HACK.apk\n\nLIVE 👑 VIP HACK\n👇 DOWNLOAD & USE FAST\n💰 MINIMUM DEPOSIT 300+\n💯 FULL NUMBER WORKING'),
      contact_username: data.contact_username !== undefined ? data.contact_username.trim().replace(/^@/, '') : (existingCampaign?.contact_username || ''),
      contact_button_text: data.contact_button_text !== undefined ? data.contact_button_text : (existingCampaign?.contact_button_text || '🚀 DM FOR LOSS RECOVERY'),
      contact_prefill_text: data.contact_prefill_text !== undefined ? data.contact_prefill_text : (existingCampaign?.contact_prefill_text || 'Hello Sir, I want VIP Setup & Loss Recovery'),
      extra_buttons_json: data.extra_buttons_json !== undefined ? data.extra_buttons_json : (existingCampaign?.extra_buttons_json || ''),
      button_text: data.button_text !== undefined ? data.button_text : (existingCampaign?.button_text || '📢 1. Join Official Channel'),
      status: data.status || existingCampaign?.status || 'active',
      billing_status: data.billing_status || existingCampaign?.billing_status || 'active',
      customer_tg_id: data.customer_tg_id !== undefined ? data.customer_tg_id : (existingCampaign?.customer_tg_id || ''),
      admin_notes: data.admin_notes || existingCampaign?.admin_notes || '',
      bot_token: data.bot_token || existingCampaign?.bot_token || '',
      bot_username: data.bot_username !== undefined ? data.bot_username.trim().replace(/^@/, '') : (existingCampaign?.bot_username || ''),
      created_at: data.created_at || existingCampaign?.created_at || now,
      updated_at: now
    };

    sqliteDb.prepare(`
      INSERT OR REPLACE INTO growth_campaigns 
      (id, owner, campaign_slug, title, channel_username, channel_id, lock_message, unlock_content, banner_url, video_url, video_caption, audio_url, apk_url, apk_caption, contact_username, contact_button_text, contact_prefill_text, extra_buttons_json, button_text, status, billing_status, customer_tg_id, admin_notes, bot_token, bot_username, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      campaign.id,
      campaign.owner,
      campaign.campaign_slug,
      campaign.title,
      campaign.channel_username,
      campaign.channel_id,
      campaign.lock_message,
      campaign.unlock_content,
      campaign.banner_url,
      campaign.video_url,
      campaign.video_caption,
      campaign.audio_url,
      campaign.apk_url,
      campaign.apk_caption,
      campaign.contact_username,
      campaign.contact_button_text,
      campaign.contact_prefill_text,
      campaign.extra_buttons_json,
      campaign.button_text,
      campaign.status,
      campaign.billing_status,
      campaign.customer_tg_id,
      campaign.admin_notes,
      campaign.bot_token,
      campaign.bot_username || '',
      campaign.created_at,
      campaign.updated_at
    );

    return { ok: true, campaign };
  } catch (err: any) {
    console.error('[GROWTH ENGINE] saveCampaign error:', err);
    return { ok: false, msg: err.message || 'Failed to save campaign' };
  }
}

function safeDeleteOldUpload(oldUrl?: string, newUrl?: string) {
  if (oldUrl && oldUrl !== newUrl && (oldUrl.startsWith('/uploads/') || oldUrl.startsWith('uploads/'))) {
    try {
      const oldPath = path.join(process.cwd(), oldUrl.replace(/^\//, ''));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    } catch (e) {}
  }
}

export function deleteCampaign(id: string, owner: string): boolean {
  if (!sqliteDb) return false;
  try {
    const existing = getCampaignById(id);
    if (existing) {
      safeDeleteOldUpload(existing.banner_url);
      safeDeleteOldUpload(existing.video_url);
      safeDeleteOldUpload(existing.audio_url);
      safeDeleteOldUpload(existing.apk_url);
    }

    if (owner === 'admin') {
      sqliteDb.prepare("DELETE FROM growth_campaigns WHERE id = ?").run(id);
    } else {
      sqliteDb.prepare("DELETE FROM growth_campaigns WHERE id = ? AND owner = ?").run(id, owner);
    }
    return true;
  } catch (err) {
    console.error('[GROWTH ENGINE] deleteCampaign error:', err);
    return false;
  }
}

// ---------------- SUBSCRIBERS MANAGEMENT ----------------
export function recordSubscriber(
  owner: string,
  campaignId: string,
  telegramUser: { id: number; username?: string; first_name?: string; last_name?: string },
  isJoined: boolean = false
): GrowthSubscriber | null {
  if (!sqliteDb) return null;
  try {
    const subId = `${owner}_${telegramUser.id}`;
    const now = Date.now();
    const existing = sqliteDb.prepare("SELECT * FROM growth_subscribers WHERE id = ?").get(subId) as GrowthSubscriber | undefined;

    const sub: GrowthSubscriber = {
      id: subId,
      owner,
      campaign_id: campaignId || (existing?.campaign_id || ''),
      telegram_id: telegramUser.id,
      username: telegramUser.username || existing?.username || '',
      first_name: telegramUser.first_name || existing?.first_name || '',
      last_name: telegramUser.last_name || existing?.last_name || '',
      is_joined: isJoined ? 1 : (existing?.is_joined || 0),
      joined_at: isJoined ? (existing?.joined_at || now) : (existing?.joined_at || 0),
      last_active_at: now,
      created_at: existing?.created_at || now
    };

    sqliteDb.prepare(`
      INSERT OR REPLACE INTO growth_subscribers
      (id, owner, campaign_id, telegram_id, username, first_name, last_name, is_joined, joined_at, last_active_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sub.id,
      sub.owner,
      sub.campaign_id,
      sub.telegram_id,
      sub.username,
      sub.first_name,
      sub.last_name,
      sub.is_joined,
      sub.joined_at,
      sub.last_active_at,
      sub.created_at
    );

    return sub;
  } catch (err) {
    console.error('[GROWTH ENGINE] recordSubscriber error:', err);
    return null;
  }
}

export function getSubscribersByOwner(owner: string, limit: number = 200, offset: number = 0): { total: number; joined: number; subscribers: GrowthSubscriber[] } {
  if (!sqliteDb) return { total: 0, joined: 0, subscribers: [] };
  try {
    const totalRow = sqliteDb.prepare("SELECT COUNT(*) as cnt, SUM(CASE WHEN is_joined = 1 THEN 1 ELSE 0 END) as joined_cnt FROM growth_subscribers WHERE owner = ?").get(owner) as any;
    const total = totalRow?.cnt || 0;
    const joined = totalRow?.joined_cnt || 0;

    const rows = sqliteDb.prepare("SELECT * FROM growth_subscribers WHERE owner = ? ORDER BY last_active_at DESC LIMIT ? OFFSET ?").all(owner, limit, offset) as GrowthSubscriber[];
    return { total, joined, subscribers: rows };
  } catch (err) {
    console.error('[GROWTH ENGINE] getSubscribersByOwner error:', err);
    return { total: 0, joined: 0, subscribers: [] };
  }
}

export function getGlobalSubscriberStats(): { totalCampaigns: number; totalSubscribers: number; totalJoined: number } {
  if (!sqliteDb) return { totalCampaigns: 0, totalSubscribers: 0, totalJoined: 0 };
  try {
    const cmpRow = sqliteDb.prepare("SELECT COUNT(*) as cnt FROM growth_campaigns").get() as any;
    const subRow = sqliteDb.prepare("SELECT COUNT(*) as cnt, SUM(CASE WHEN is_joined = 1 THEN 1 ELSE 0 END) as joined_cnt FROM growth_subscribers").get() as any;
    return {
      totalCampaigns: cmpRow?.cnt || 0,
      totalSubscribers: subRow?.cnt || 0,
      totalJoined: subRow?.joined_cnt || 0
    };
  } catch (err) {
    return { totalCampaigns: 0, totalSubscribers: 0, totalJoined: 0 };
  }
}

// ---------------- SPINTAX PARSER & PERSONALIZATION ----------------
export function parseSpintax(text: string): string {
  if (!text) return '';
  const regex = /\{([^{}]+)\}/g;
  let matches = regex.exec(text);
  while (matches) {
    const options = matches[1].split('|');
    const choice = options[Math.floor(Math.random() * options.length)];
    text = text.slice(0, matches.index) + choice + text.slice(matches.index + matches[0].length);
    regex.lastIndex = 0;
    matches = regex.exec(text);
  }
  return text;
}

export function formatCampaignText(template: string, fromUser?: any, campaign?: any): string {
  if (!template) return '';
  let text = parseSpintax(template);
  if (fromUser) {
    const firstName = fromUser.first_name || 'Friend';
    const lastName = fromUser.last_name || '';
    const fullName = `${firstName} ${lastName}`.trim();
    const username = fromUser.username ? `@${fromUser.username}` : firstName;
    const userId = String(fromUser.id || '');

    text = text
      .replace(/\{first_name\}/gi, firstName)
      .replace(/\{firstname\}/gi, firstName)
      .replace(/\{name\}/gi, fullName)
      .replace(/\{full_name\}/gi, fullName)
      .replace(/\{username\}/gi, username)
      .replace(/\{id\}/gi, userId)
      .replace(/\{user_id\}/gi, userId);
  }
  if (campaign) {
    const ch = (campaign.channel_username || '').replace(/^@/, '');
    text = text
      .replace(/\{channel\}/gi, `@${ch}`)
      .replace(/\{channel_name\}/gi, `@${ch}`)
      .replace(/\{title\}/gi, campaign.title || 'VIP Channel');
  }
  return text;
}

// ---------------- TELEGRAM BOT API HELPERS ----------------
async function callTelegramApi(token: string, method: string, payload?: any): Promise<any> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(30000)
    });
    return await res.json();
  } catch (err: any) {
    return { ok: false, description: err.message };
  }
}

export async function sendTelegramPhotoOrMessage(
  token: string,
  chatId: number | string,
  text: string,
  mediaUrl?: string,
  replyMarkup?: any
): Promise<any> {
  try {
    const cleanMedia = (mediaUrl || '').trim();
    if (cleanMedia) {
      // 1. Base64 Data URL
      if (cleanMedia.startsWith('data:image/')) {
        const parts = cleanMedia.split(',');
        const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
        const buffer = Buffer.from(parts[1] || '', 'base64');
        const formData = new FormData();
        formData.append('chat_id', String(chatId));
        formData.append('photo', new Blob([buffer], { type: mime }), 'screenshot.jpg');
        if (text) {
          formData.append('caption', text);
          formData.append('parse_mode', 'HTML');
        }
        if (replyMarkup) {
          formData.append('reply_markup', typeof replyMarkup === 'string' ? replyMarkup : JSON.stringify(replyMarkup));
        }
        const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
          method: 'POST',
          body: formData
        });
        return await res.json();
      }

      // 2. Local uploads file
      if (cleanMedia.startsWith('/uploads/') || cleanMedia.startsWith('uploads/')) {
        const localPath = path.join(process.cwd(), cleanMedia.replace(/^\//, ''));
        if (fs.existsSync(localPath)) {
          const buffer = fs.readFileSync(localPath);
          const ext = path.extname(localPath).toLowerCase() || '.jpg';
          const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
          const formData = new FormData();
          formData.append('chat_id', String(chatId));
          formData.append('photo', new Blob([buffer], { type: mime }), `screenshot${ext}`);
          if (text) {
            formData.append('caption', text);
            formData.append('parse_mode', 'HTML');
          }
          if (replyMarkup) {
            formData.append('reply_markup', typeof replyMarkup === 'string' ? replyMarkup : JSON.stringify(replyMarkup));
          }
          const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
            method: 'POST',
            body: formData
          });
          return await res.json();
        }
      }

      // 3. Web URL
      if (cleanMedia.startsWith('http://') || cleanMedia.startsWith('https://')) {
        return await callTelegramApi(token, 'sendPhoto', {
          chat_id: chatId,
          photo: cleanMedia,
          caption: text || undefined,
          parse_mode: 'HTML',
          reply_markup: replyMarkup
        });
      }

      // 4. Telegram Direct File ID (from in-chat media forward/upload)
      if (cleanMedia && !cleanMedia.startsWith('data:') && !cleanMedia.startsWith('/uploads/') && !cleanMedia.startsWith('uploads/')) {
        return await callTelegramApi(token, 'sendPhoto', {
          chat_id: chatId,
          photo: cleanMedia,
          caption: text || undefined,
          parse_mode: 'HTML',
          reply_markup: replyMarkup
        });
      }
    }

    // Default: Regular Text Message
    return await callTelegramApi(token, 'sendMessage', {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
      disable_web_page_preview: false
    });
  } catch (err: any) {
    return { ok: false, description: err.message };
  }
}

export async function sendTelegramVideo(
  token: string,
  chatId: number | string,
  videoUrl: string,
  caption?: string,
  replyMarkup?: any
): Promise<any> {
  try {
    const cleanMedia = (videoUrl || '').trim();
    if (!cleanMedia) return { ok: false, description: 'No video provided' };

    // 1. Base64 Video
    if (cleanMedia.startsWith('data:video/')) {
      const parts = cleanMedia.split(',');
      const mime = parts[0].match(/:(.*?);/)?.[1] || 'video/mp4';
      const buffer = Buffer.from(parts[1] || '', 'base64');
      const formData = new FormData();
      formData.append('chat_id', String(chatId));
      formData.append('video', new Blob([buffer], { type: mime }), 'setup_video.mp4');
      if (caption) {
        formData.append('caption', caption);
        formData.append('parse_mode', 'HTML');
      }
      if (replyMarkup) {
        formData.append('reply_markup', typeof replyMarkup === 'string' ? replyMarkup : JSON.stringify(replyMarkup));
      }
      const res = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
        method: 'POST',
        body: formData
      });
      return await res.json();
    }

    // 2. Local uploads file
    if (cleanMedia.startsWith('/uploads/') || cleanMedia.startsWith('uploads/')) {
      const localPath = path.join(process.cwd(), cleanMedia.replace(/^\//, ''));
      if (fs.existsSync(localPath)) {
        const buffer = fs.readFileSync(localPath);
        const ext = path.extname(localPath).toLowerCase() || '.mp4';
        const mime = ext === '.webm' ? 'video/webm' : ext === '.mov' ? 'video/quicktime' : 'video/mp4';
        const formData = new FormData();
        formData.append('chat_id', String(chatId));
        formData.append('video', new Blob([buffer], { type: mime }), `setup_video${ext}`);
        if (caption) {
          formData.append('caption', caption);
          formData.append('parse_mode', 'HTML');
        }
        if (replyMarkup) {
          formData.append('reply_markup', typeof replyMarkup === 'string' ? replyMarkup : JSON.stringify(replyMarkup));
        }
        const res = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
          method: 'POST',
          body: formData
        });
        return await res.json();
      }
    }

    // 3. Web URL
    if (cleanMedia.startsWith('http://') || cleanMedia.startsWith('https://')) {
      return await callTelegramApi(token, 'sendVideo', {
        chat_id: chatId,
        video: cleanMedia,
        caption: caption || undefined,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      });
    }

    // 4. Telegram Direct File ID (from in-chat media forward/upload)
    if (cleanMedia && !cleanMedia.startsWith('data:') && !cleanMedia.startsWith('/uploads/') && !cleanMedia.startsWith('uploads/')) {
      return await callTelegramApi(token, 'sendVideo', {
        chat_id: chatId,
        video: cleanMedia,
        caption: caption || undefined,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      });
    }
  } catch (err: any) {
    return { ok: false, description: err.message };
  }
}

export async function sendTelegramAudio(
  token: string,
  chatId: number | string,
  audioUrl: string,
  caption?: string,
  replyMarkup?: any
): Promise<any> {
  try {
    const cleanMedia = (audioUrl || '').trim();
    if (!cleanMedia) return { ok: false, description: 'No audio provided' };

    // 1. Base64 Audio
    if (cleanMedia.startsWith('data:audio/')) {
      const parts = cleanMedia.split(',');
      const mime = parts[0].match(/:(.*?);/)?.[1] || 'audio/mpeg';
      const buffer = Buffer.from(parts[1] || '', 'base64');
      const formData = new FormData();
      formData.append('chat_id', String(chatId));
      formData.append('audio', new Blob([buffer], { type: mime }), 'voice_guide.mp3');
      if (caption) {
        formData.append('caption', caption);
        formData.append('parse_mode', 'HTML');
      }
      if (replyMarkup) {
        formData.append('reply_markup', typeof replyMarkup === 'string' ? replyMarkup : JSON.stringify(replyMarkup));
      }
      const res = await fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
        method: 'POST',
        body: formData
      });
      return await res.json();
    }

    // 2. Local uploads file
    if (cleanMedia.startsWith('/uploads/') || cleanMedia.startsWith('uploads/')) {
      const localPath = path.join(process.cwd(), cleanMedia.replace(/^\//, ''));
      if (fs.existsSync(localPath)) {
        const buffer = fs.readFileSync(localPath);
        const ext = path.extname(localPath).toLowerCase() || '.mp3';
        const mime = ext === '.ogg' ? 'audio/ogg' : ext === '.wav' ? 'audio/wav' : ext === '.m4a' ? 'audio/mp4' : 'audio/mpeg';
        const formData = new FormData();
        formData.append('chat_id', String(chatId));
        formData.append('audio', new Blob([buffer], { type: mime }), `voice_guide${ext}`);
        if (caption) {
          formData.append('caption', caption);
          formData.append('parse_mode', 'HTML');
        }
        if (replyMarkup) {
          formData.append('reply_markup', typeof replyMarkup === 'string' ? replyMarkup : JSON.stringify(replyMarkup));
        }
        const res = await fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
          method: 'POST',
          body: formData
        });
        return await res.json();
      }
    }

    // 3. Web URL
    if (cleanMedia.startsWith('http://') || cleanMedia.startsWith('https://')) {
      return await callTelegramApi(token, 'sendAudio', {
        chat_id: chatId,
        audio: cleanMedia,
        caption: caption || undefined,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      });
    }

    // 4. Telegram Direct File ID (from in-chat media forward/upload)
    if (cleanMedia && !cleanMedia.startsWith('data:') && !cleanMedia.startsWith('/uploads/') && !cleanMedia.startsWith('uploads/')) {
      return await callTelegramApi(token, 'sendAudio', {
        chat_id: chatId,
        audio: cleanMedia,
        caption: caption || undefined,
        parse_mode: 'HTML',
        reply_markup: replyMarkup
      });
    }
  } catch (err: any) {
    return { ok: false, description: err.message };
  }
}

/**
 * Builds rich inline keyboard for personal contact redirect, channels, and custom buttons
 */
export function buildCampaignReplyMarkup(campaign: GrowthCampaign, fromUser?: any): any {
  const keyboardRows: any[] = [];

  // 1. Direct Personal Chat Button (with pre-filled message)
  if (campaign.contact_username) {
    const cleanContact = campaign.contact_username.replace(/^@/, '').trim();
    if (cleanContact) {
      const prefillRaw = campaign.contact_prefill_text || 'Hello Sir, I want VIP Setup & Loss Recovery';
      const prefillText = formatCampaignText(prefillRaw, fromUser, campaign);
      const encodedMsg = encodeURIComponent(prefillText);
      const contactUrl = `https://t.me/${cleanContact}?text=${encodedMsg}`;
      keyboardRows.push([
        {
          text: campaign.contact_button_text || '🚀 DM FOR LOSS RECOVERY / SETUP',
          url: contactUrl
        }
      ]);
    }
  }

  // 2. Channel Link Button & Membership Check
  if (campaign.channel_username) {
    const chUrl = campaign.channel_username.startsWith('http')
      ? campaign.channel_username
      : `https://t.me/${campaign.channel_username.replace(/^@/, '')}`;
    keyboardRows.push([
      {
        text: campaign.button_text || '📢 1. Join Official Channel',
        url: chUrl
      },
      {
        text: '✅ 2. Check Status',
        callback_data: `verify_join:${campaign.campaign_slug}`
      }
    ]);
  }

  // 3. Extra Custom Buttons (Full Width OR Side-by-Side Compact)
  if (campaign.extra_buttons_json) {
    try {
      const extras = JSON.parse(campaign.extra_buttons_json);
      if (Array.isArray(extras)) {
        let currentRow: any[] = [];
        for (let i = 0; i < extras.length; i++) {
          const btn = extras[i];
          if (!btn || !btn.text) continue;

          let btnObj: any = { text: btn.text };
          if (btn.type === 'alert') {
            btnObj.callback_data = `c_alert:${campaign.campaign_slug}:${i}`;
          } else if (btn.url) {
            let finalUrl = btn.url.trim();
            if (finalUrl.startsWith('@')) {
              finalUrl = `https://t.me/${finalUrl.replace(/^@/, '')}`;
            }
            if (btn.prefill_text && finalUrl.includes('t.me/')) {
              const pre = encodeURIComponent(formatCampaignText(btn.prefill_text, fromUser, campaign));
              finalUrl = finalUrl.includes('?') ? `${finalUrl}&text=${pre}` : `${finalUrl}?text=${pre}`;
            }
            btnObj.url = finalUrl;
          } else {
            btnObj.callback_data = `c_alert:${campaign.campaign_slug}:${i}`;
          }

          if (btn.size === 'compact' || btn.size === 'small' || btn.layout === '2_per_row') {
            currentRow.push(btnObj);
            if (currentRow.length === 2) {
              keyboardRows.push(currentRow);
              currentRow = [];
            }
          } else {
            if (currentRow.length > 0) {
              keyboardRows.push(currentRow);
              currentRow = [];
            }
            keyboardRows.push([btnObj]);
          }
        }
        if (currentRow.length > 0) {
          keyboardRows.push(currentRow);
        }
      }
    } catch (e) {}
  }

  return keyboardRows.length > 0 ? { inline_keyboard: keyboardRows } : undefined;
}

/**
 * Dispatches the full rich Auto-DM sequence (Greeting + Photo + Video + Audio + Redirect Buttons)
 */
export async function sendCampaignAutoDmSequence(
  botToken: string,
  chatId: number | string,
  fromUser: any,
  campaign: GrowthCampaign,
  isUnlocked: boolean = false
): Promise<void> {
  const replyMarkup = buildCampaignReplyMarkup(campaign, fromUser);
  const rawText = isUnlocked ? (campaign.unlock_content || campaign.lock_message) : campaign.lock_message;
  const formattedText = formatCampaignText(rawText, fromUser, campaign);

  // 1. Send Banner / Photo / Greeting with Inline Buttons
  if (campaign.banner_url) {
    await sendTelegramPhotoOrMessage(botToken, chatId, formattedText, campaign.banner_url, replyMarkup);
  } else {
    await sendTelegramPhotoOrMessage(botToken, chatId, formattedText, undefined, replyMarkup);
  }

  // 2. Send Setup Video (if uploaded)
  if (campaign.video_url) {
    const videoCaption = formatCampaignText(
      campaign.video_caption || '🎬 <b>Setup Video Tutorial</b>\nPls Video Ko Pura Dekhna & Follow Steps',
      fromUser,
      campaign
    );
    await new Promise(r => setTimeout(r, 600));
    await sendTelegramVideo(botToken, chatId, campaign.video_url, videoCaption);
  }

  // 3. Send Voice / Audio Guide (if uploaded)
  if (campaign.audio_url) {
    const audioCaption = formatCampaignText(
      '🎙️ <b>Important Voice Guide</b>\nYe audio suno aur steps follow karo',
      fromUser,
      campaign
    );
    await new Promise(r => setTimeout(r, 600));
    await sendTelegramAudio(botToken, chatId, campaign.audio_url, audioCaption);
  }
}

export async function testGrowthBotToken(token: string): Promise<{ ok: boolean; username?: string; first_name?: string; msg?: string }> {
  if (!token || !token.trim()) return { ok: false, msg: 'Bot token cannot be empty' };
  const res = await callTelegramApi(token.trim(), 'getMe', {});
  if (res && res.ok && res.result) {
    return {
      ok: true,
      username: res.result.username,
      first_name: res.result.first_name
    };
  }
  return { ok: false, msg: res?.description || 'Invalid Telegram Bot Token' };
}

// Check membership in channel
export async function checkChannelMembership(botToken: string, channelUsernameOrId: string, telegramUserId: number): Promise<{ isMember: boolean; status: string }> {
  try {
    let chatId: any = channelUsernameOrId;
    if (typeof chatId === 'string' && !chatId.startsWith('-100') && !chatId.startsWith('@')) {
      chatId = `@${chatId}`;
    }

    const res = await callTelegramApi(botToken, 'getChatMember', {
      chat_id: chatId,
      user_id: telegramUserId
    });

    if (res && res.ok && res.result) {
      const status = res.result.status; // 'creator', 'administrator', 'member', 'restricted', 'left', 'kicked'
      const isMember = ['creator', 'administrator', 'member'].includes(status) || (status === 'restricted' && res.result.is_member === true);
      return { isMember, status };
    }
    return { isMember: false, status: res?.description || 'not_found' };
  } catch (err: any) {
    return { isMember: false, status: err.message };
  }
}

// ---------------- TELEGRAM BOT POLLER / UPDATE PROCESSOR ----------------
let growthPollerActive = false;
let growthLastUpdateId = 0;

// Interactive in-chat session state for customers configuring their bot directly in Telegram
interface CustomerSessionState {
  campaign_slug: string;
  action:
    | 'awaiting_welcome_text'
    | 'awaiting_channel'
    | 'awaiting_contact_user'
    | 'awaiting_contact_btn_text'
    | 'awaiting_unlock_content'
    | 'awaiting_video_caption'
    | 'awaiting_button_title'
    | 'awaiting_button_action'
    | 'awaiting_broadcast_filter'
    | 'awaiting_broadcast_content'
    | 'awaiting_broadcast_btn'
    | 'awaiting_broadcast_confirm';
  broadcast_filter?: 'all' | 'joined_only' | 'pending_only';
  broadcast_media_type?: 'text' | 'photo' | 'video';
  broadcast_media_id?: string;
  broadcast_text?: string;
  broadcast_btn_text?: string;
  broadcast_btn_url?: string;
  pending_btn_title?: string;
  timestamp: number;
}
const customerSessionStates = new Map<number | string, CustomerSessionState>();

/**
 * Builds the interactive Telegram Management Menu for a customer's bot
 */
async function sendCustomerBotManagementMenu(botToken: string, chatId: number | string, campaign: GrowthCampaign, editMessageId?: number) {
  let subCount = 0;
  let verifiedCount = 0;
  if (sqliteDb) {
    try {
      const stats = sqliteDb.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN is_joined = 1 THEN 1 ELSE 0 END) as verified FROM growth_subscribers WHERE campaign_id = ?").get(campaign.id) as any;
      if (stats) {
        subCount = stats.total || 0;
        verifiedCount = stats.verified || 0;
      }
    } catch (e) {}
  }

  const pendingCount = subCount - verifiedCount;
  const isSuspended = campaign.billing_status === 'suspended' || campaign.billing_status === 'unpaid';
  const statusBadge = isSuspended ? '🔴 SUSPENDED (Bill: Unpaid)' : '🟢 ACTIVE (Bill: Paid ✅)';

  let extraCount = 0;
  if (campaign.extra_buttons_json) {
    try {
      const p = JSON.parse(campaign.extra_buttons_json);
      if (Array.isArray(p)) extraCount = p.length;
    } catch (e) {}
  }

  const text = `🎛️ <b>CUSTOMER BOT DASHBOARD</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🤖 <b>Campaign:</b> ${campaign.title} (<code>/${campaign.campaign_slug}</code>)\n` +
    `⚡ <b>Service Status:</b> ${statusBadge}\n` +
    `📢 <b>Target Channel:</b> ${campaign.channel_username ? `@${campaign.channel_username}` : '<i>Not Set</i>'}\n` +
    `💬 <b>Direct DM Contact:</b> ${campaign.contact_username ? `@${campaign.contact_username}` : '<i>Not Set</i>'} ("${campaign.contact_button_text || '🚀 DM FOR LOSS RECOVERY'}")\n` +
    `👥 <b>Total Leads:</b> <b>${subCount}</b> (✅ ${verifiedCount} Verified | ⏳ ${pendingCount} Pending)\n` +
    `🔘 <b>Extra Buttons:</b> <b>${extraCount}</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `<i>Neeche diye gaye buttons se direct Telegram app me apne bot ko customize karein:</i>`;

  const inlineKeyboard = {
    inline_keyboard: isSuspended ? [
      [{ text: '⚠️ Service Suspended — Clear Bill with Admin', callback_data: `c_mgmt:suspended:${campaign.campaign_slug}` }]
    ] : [
      [
        { text: '📝 Welcome / Auto-DM Text', callback_data: `c_mgmt:edit_welcome:${campaign.campaign_slug}` },
        { text: '📢 Target Channel', callback_data: `c_mgmt:set_channel:${campaign.campaign_slug}` }
      ],
      [
        { text: '🎬 Setup Video (MP4)', callback_data: `c_mgmt:set_video:${campaign.campaign_slug}` },
        { text: '🎙️ Voice Guide (Audio)', callback_data: `c_mgmt:set_audio:${campaign.campaign_slug}` }
      ],
      [
        { text: '🖼️ Banner / Photo', callback_data: `c_mgmt:set_photo:${campaign.campaign_slug}` },
        { text: '💬 Personal DM Link', callback_data: `c_mgmt:set_contact:${campaign.campaign_slug}` }
      ],
      [
        { text: '🔘 Inline Buttons Studio', callback_data: `c_mgmt:buttons_studio:${campaign.campaign_slug}` },
        { text: '🔓 VIP Unlock Content', callback_data: `c_mgmt:edit_unlock:${campaign.campaign_slug}` }
      ],
      [
        { text: '📊 Live Analytics', callback_data: `c_mgmt:stats:${campaign.campaign_slug}` },
        { text: '👁️ Test Auto-DM Preview', callback_data: `c_mgmt:preview:${campaign.campaign_slug}` }
      ],
      [
        { text: '🚀 Broadcast Studio (All / Pending / Joined)', callback_data: `c_mgmt:broadcast:${campaign.campaign_slug}` }
      ]
    ]
  };

  if (editMessageId) {
    await callTelegramApi(botToken, 'editMessageText', {
      chat_id: chatId,
      message_id: editMessageId,
      text,
      parse_mode: 'HTML',
      reply_markup: inlineKeyboard
    });
  } else {
    await callTelegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: inlineKeyboard
    });
  }
}

/**
 * Builds the Inline Buttons Studio sub-menu for the customer
 */
async function sendCustomerButtonsMenu(botToken: string, chatId: number | string, campaign: GrowthCampaign, editMessageId?: number) {
  let extraList: Array<{ text: string; url?: string; alert_text?: string; layout?: string }> = [];
  if (campaign.extra_buttons_json) {
    try {
      const parsed = JSON.parse(campaign.extra_buttons_json);
      if (Array.isArray(parsed)) extraList = parsed;
    } catch (e) {}
  }

  let text = `🔘 <b>INLINE BUTTONS STUDIO</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `Campaign: <b>${campaign.title}</b>\n\n` +
    `📋 <b>Default Action Buttons:</b>\n` +
    `1. 📢 <b>Join Channel:</b> ${campaign.channel_username ? `@${campaign.channel_username}` : 'Not Set'}\n` +
    `2. ✅ <b>Check Status:</b> (Verifies channel membership)\n` +
    `3. 💬 <b>Personal DM:</b> "${campaign.contact_button_text || '🚀 DM FOR LOSS RECOVERY'}" ➔ @${campaign.contact_username || 'Not Set'}\n`;

  if (extraList.length > 0) {
    text += `\n⭐️ <b>Extra Custom Buttons (${extraList.length}):</b>\n`;
    extraList.forEach((b, idx) => {
      const actionType = b.url ? `🔗 Link: ${b.url.substring(0, 32)}...` : `🔔 Alert: "${(b.alert_text || '').substring(0, 24)}..."`;
      text += `${idx + 4}. <b>${b.text}</b> (${actionType})\n`;
    });
  } else {
    text += `\n<i>(No extra custom buttons yet)</i>\n`;
  }

  text += `━━━━━━━━━━━━━━━━━━━━\n` +
    `<i>Neeche diye gaye buttons se naya button add karein ya label change karein:</i>`;

  const rows: any[] = [
    [
      { text: '➕ Add Custom Button', callback_data: `c_btn:add:${campaign.campaign_slug}` },
      { text: '✏️ Edit DM Button Label', callback_data: `c_btn:edit_dm_label:${campaign.campaign_slug}` }
    ]
  ];

  if (extraList.length > 0) {
    rows.push([
      { text: '📐 Toggle Layout (1 vs 2 / row)', callback_data: `c_btn:toggle_layout:${campaign.campaign_slug}` },
      { text: '🗑️ Clear Extra Buttons', callback_data: `c_btn:clear:${campaign.campaign_slug}` }
    ]);
  }

  rows.push([
    { text: '⬅️ Back to Main Menu', callback_data: `c_mgmt:back:${campaign.campaign_slug}` }
  ]);

  if (editMessageId) {
    await callTelegramApi(botToken, 'editMessageText', {
      chat_id: chatId,
      message_id: editMessageId,
      text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: rows }
    });
  } else {
    await callTelegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: rows }
    });
  }
}

/**
 * Builds the Broadcast Studio sub-menu for the customer
 */
async function sendCustomerBroadcastMenu(botToken: string, chatId: number | string, campaign: GrowthCampaign, editMessageId?: number) {
  let subCount = 0;
  let verifiedCount = 0;
  if (sqliteDb) {
    try {
      const stats = sqliteDb.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN is_joined = 1 THEN 1 ELSE 0 END) as verified FROM growth_subscribers WHERE campaign_id = ?").get(campaign.id) as any;
      if (stats) {
        subCount = stats.total || 0;
        verifiedCount = stats.verified || 0;
      }
    } catch (e) {}
  }
  const pendingCount = subCount - verifiedCount;

  const text = `🚀 <b>BROADCAST STUDIO</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `Campaign: <b>${campaign.title}</b> (<code>/${campaign.campaign_slug}</code>)\n\n` +
    `👥 <b>Total Captured Audience:</b> <b>${subCount}</b>\n` +
    `• ⏳ <b>Pending (Bot Start Kiya, Channel Join Nahi):</b> <b>${pendingCount}</b>\n` +
    `• ✅ <b>Joined (Channel Verified Members):</b> <b>${verifiedCount}</b>\n` +
    `• 👥 <b>All Subscribers:</b> <b>${subCount}</b>\n\n` +
    `🎯 <b>Kisko Broadcast Message Bhejna Hai?</b>\n` +
    `Neeche se Target Audience select karein:`;

  const rows = [
    [
      { text: `⏳ Pending Only (${pendingCount} Users)`, callback_data: `c_bc_target:pending_only:${campaign.campaign_slug}` }
    ],
    [
      { text: `✅ Joined Only (${verifiedCount} Users)`, callback_data: `c_bc_target:joined_only:${campaign.campaign_slug}` }
    ],
    [
      { text: `👥 All Subscribers (${subCount} Users)`, callback_data: `c_bc_target:all:${campaign.campaign_slug}` }
    ],
    [
      { text: '⬅️ Back to Main Menu', callback_data: `c_mgmt:back:${campaign.campaign_slug}` }
    ]
  ];

  if (editMessageId) {
    await callTelegramApi(botToken, 'editMessageText', {
      chat_id: chatId,
      message_id: editMessageId,
      text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: rows }
    });
  } else {
    await callTelegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: rows }
    });
  }
}

/**
 * Builds the Master Admin Authority Menu with kill-switches for each customer bot
 */
async function sendMasterAdminMenu(botToken: string, chatId: number | string, editMessageId?: number) {
  const allCampaigns = getAllCampaigns();
  const activeCount = allCampaigns.filter(c => c.billing_status !== 'suspended' && c.billing_status !== 'unpaid').length;
  const suspendedCount = allCampaigns.length - activeCount;

  let text = `👑 <b>MASTER ADMIN BOT AUTHORITY</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `Authority: <b>Telegram BotFather Master</b>\n` +
    `Total Bots: <b>${allCampaigns.length}</b> | Active: <b>${activeCount}</b> | Suspended/Unpaid: <b>${suspendedCount}</b>\n\n` +
    `📋 <b>Customer Bots & Kill-Switch Controls:</b>\n`;

  const keyboardRows: any[] = [];

  if (allCampaigns.length === 0) {
    text += `<i>No customer bots created yet.</i>`;
  } else {
    allCampaigns.slice(0, 15).forEach((camp, idx) => {
      const isOff = camp.billing_status === 'suspended' || camp.billing_status === 'unpaid';
      text += `\n${idx + 1}. <b>${camp.title}</b> (<code>/${camp.campaign_slug}</code>)\n` +
        `   • Owner: <b>${camp.owner}</b> | TG: <b>${camp.customer_tg_id || 'Not Linked'}</b>\n` +
        `   • Bill Status: ${isOff ? '🔴 <b>UNPAID / OFF</b>' : '🟢 <b>PAID / ACTIVE</b>'}\n`;

      if (isOff) {
        keyboardRows.push([
          { text: `🟢 Turn ON / Activate: ${camp.campaign_slug}`, callback_data: `c_admin:activate:${camp.campaign_slug}` }
        ]);
      } else {
        keyboardRows.push([
          { text: `🔴 Turn OFF / Suspend: ${camp.campaign_slug}`, callback_data: `c_admin:kill:${camp.campaign_slug}` }
        ]);
      }
    });
  }

  keyboardRows.push([
    { text: '🔄 Refresh Status', callback_data: 'c_admin:refresh' }
  ]);

  if (editMessageId) {
    await callTelegramApi(botToken, 'editMessageText', {
      chat_id: chatId,
      message_id: editMessageId,
      text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboardRows }
    });
  } else {
    await callTelegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboardRows }
    });
  }
}

export async function handleGrowthBotUpdate(update: any, dedicatedBotToken?: string, defaultCampaign?: GrowthCampaign) {
  const config = getGrowthBotConfig();
  const botToken = (dedicatedBotToken || config.bot_token || '').trim();
  if (!botToken) return;
  if (!dedicatedBotToken && !config.enabled) return;

  // 1. Message Handling
  if (update.message) {
    const msg = update.message;
    const text = (msg.text || '').trim();
    const fromUser = msg.from;
    const chatId = msg.chat.id;
    const userTgIdStr = String(fromUser.id);
    const userTgHandle = (fromUser.username || '').toLowerCase().replace(/^@/, '');

    // Check if sender is Master Admin
    const isAdmin = Boolean(
      (config.admin_telegram_id && (
        String(config.admin_telegram_id).toLowerCase().replace(/^@/, '') === userTgIdStr ||
        String(config.admin_telegram_id).toLowerCase().replace(/^@/, '') === userTgHandle
      )) ||
      userTgHandle === 'ashiqking' ||
      userTgHandle === 'admin'
    );

    // ================= A. MASTER ADMIN COMMANDS =================
    if (text === '/setadmin' || (!config.admin_telegram_id && text === '/admin')) {
      saveGrowthBotConfig({ admin_telegram_id: userTgIdStr });
      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: `👑 <b>Master Admin Authority Registered!</b>\n\nAapka Telegram account (ID: <code>${userTgIdStr}</code>) ab is Bot ka Master Admin set ho chuka hai.\n\nType <code>/admin</code> to view all customer bots and kill-switches.`,
        parse_mode: 'HTML'
      });
      await sendMasterAdminMenu(botToken, chatId);
      return;
    }

    if (isAdmin && (text === '/admin' || text === '/bots' || text === '/killswitch')) {
      await sendMasterAdminMenu(botToken, chatId);
      return;
    }

    if (isAdmin && (text.startsWith('/suspend') || text.startsWith('/kill'))) {
      const slug = text.split(' ')[1]?.trim().replace(/^@/, '').replace(/^\//, '');
      if (!slug) {
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `⚠️ Usage: <code>/suspend &lt;campaign_slug&gt;</code>\nExample: <code>/suspend vip_zone</code>`,
          parse_mode: 'HTML'
        });
        return;
      }
      setCampaignBillingStatus(slug, 'unpaid', 'Suspended by admin via Telegram');
      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: `🔴 <b>BOT SHUT OFF & SUSPENDED!</b>\n\nCampaign <code>/${slug}</code> ko band kar diya gaya hai (Bill: Unpaid marked).\nSubscribers aur Customer dono ka access block ho gaya hai.`,
        parse_mode: 'HTML'
      });
      return;
    }

    if (isAdmin && (text.startsWith('/activate') || text.startsWith('/resume'))) {
      const slug = text.split(' ')[1]?.trim().replace(/^@/, '').replace(/^\//, '');
      if (!slug) {
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `⚠️ Usage: <code>/activate &lt;campaign_slug&gt;</code>\nExample: <code>/activate vip_zone</code>`,
          parse_mode: 'HTML'
        });
        return;
      }
      setCampaignBillingStatus(slug, 'active', 'Activated by admin via Telegram');
      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: `🟢 <b>BOT ACTIVATED & LIVE!</b>\n\nCampaign <code>/${slug}</code> ko activate kar diya gaya hai (Bill: Paid marked).\nPoori service restore ho chuki hai!`,
        parse_mode: 'HTML'
      });
      return;
    }

    if (isAdmin && text.startsWith('/link')) {
      const parts = text.split(' ');
      const slug = parts[1]?.trim().replace(/^\//, '');
      const targetUser = parts[2]?.trim().replace(/^@/, '');
      if (!slug || !targetUser) {
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `⚠️ Usage: <code>/link &lt;campaign_slug&gt; &lt;@telegram_username_or_id&gt;</code>\nExample: <code>/link vip_zone @Ashraf_VIP</code>`,
          parse_mode: 'HTML'
        });
        return;
      }
      linkCampaignToCustomerTg(slug, targetUser);
      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: `🔗 <b>Campaign Linked!</b>\n\nCampaign <code>/${slug}</code> has been linked to customer <b>@${targetUser}</b>. Customer can now control it via Telegram!`,
        parse_mode: 'HTML'
      });
      return;
    }

    // ================= B. CUSTOMER BROADCAST CONTENT OR MEDIA INGESTION =================
    // 1. Check if customer is sending broadcast content (Photo/Video/Text)
    if (customerSessionStates.has(fromUser.id)) {
      const state = customerSessionStates.get(fromUser.id)!;
      if (state.action === 'awaiting_broadcast_content') {
        const campaign = getCampaignBySlug(state.campaign_slug);
        if (campaign) {
          let mediaType: 'text' | 'photo' = 'text';
          let mediaId = '';
          let broadcastText = text;

          if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
            mediaType = 'photo';
            mediaId = msg.photo[msg.photo.length - 1].file_id;
            broadcastText = (msg.caption || '').trim();
          } else if (msg.video) {
            mediaType = 'photo';
            mediaId = msg.video.file_id;
            broadcastText = (msg.caption || '').trim();
          }

          if (!broadcastText && !mediaId) {
            await callTelegramApi(botToken, 'sendMessage', {
              chat_id: chatId,
              text: '⚠️ Kripya valid text message ya photo/video attach karke bhejein.'
            });
            return;
          }

          state.action = 'awaiting_broadcast_confirm';
          state.broadcast_media_type = mediaType;
          state.broadcast_media_id = mediaId;
          state.broadcast_text = broadcastText;

          let targetLabel = '👥 All Subscribers';
          if (state.broadcast_filter === 'pending_only') targetLabel = '⏳ Pending Only (Unjoined Users)';
          if (state.broadcast_filter === 'joined_only') targetLabel = '✅ Joined Only (Verified Users)';

          const previewMsg = `👁️ <b>BROADCAST DISPATCH PREVIEW</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `🎯 <b>Target:</b> ${targetLabel}\n` +
            `📁 <b>Media Attached:</b> ${mediaId ? (mediaType === 'photo' ? 'Photo / Screenshot ✅' : 'Video ✅') : 'None (Text Only)'}\n` +
            `📝 <b>Broadcast Content:</b>\n\n` +
            `${broadcastText || '<i>(No caption text)</i>'}\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `<i>Kya aap is broadcast ko sabhi target subscribers ko turant blast karna chahte hain?</i>`;

          await callTelegramApi(botToken, 'sendMessage', {
            chat_id: chatId,
            text: previewMsg,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '🚀 Confirm & Blast Broadcast Now', callback_data: `c_bc_blast:${state.campaign_slug}` }
                ],
                [
                  { text: '❌ Cancel Broadcast', callback_data: `c_mgmt:back:${state.campaign_slug}` }
                ]
              ]
            }
          });
          return;
        }
      }
    }

    // 2. Normal Media Ingestion: If customer sends Photo, Video, or Audio/Voice outside broadcast
    if (msg.photo || msg.video || msg.audio || msg.voice) {
      const custCamp = getCampaignByCustomerTg(userTgIdStr) || (userTgHandle ? getCampaignByCustomerTg(userTgHandle) : null);
      if (custCamp) {
        if (custCamp.billing_status === 'suspended' || custCamp.billing_status === 'unpaid') {
          await callTelegramApi(botToken, 'sendMessage', {
            chat_id: chatId,
            text: `❌ <b>SERVICE SUSPENDED (BILL UNPAID)</b>\n\nAapka bot bill pending hone ki wajah se suspend hai. Kripya Admin se sampark karein.`,
            parse_mode: 'HTML'
          });
          return;
        }

        if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
          const photoId = msg.photo[msg.photo.length - 1].file_id;
          saveCampaign(custCamp.owner, { id: custCamp.id, banner_url: photoId });
          await callTelegramApi(botToken, 'sendMessage', {
            chat_id: chatId,
            text: `✅ <b>Banner Photo Updated Successfully!</b> 🖼️\n\nAapke Auto-DM me nayi photo save ho gayi hai. User ko ab yahi picture deliver hogi!`,
            parse_mode: 'HTML'
          });
          await sendCustomerBotManagementMenu(botToken, chatId, getCampaignById(custCamp.id) || custCamp);
          return;
        }

        if (msg.video) {
          const videoId = msg.video.file_id;
          const caption = (msg.caption || '').trim();
          saveCampaign(custCamp.owner, {
            id: custCamp.id,
            video_url: videoId,
            video_caption: caption || undefined
          });
          await callTelegramApi(botToken, 'sendMessage', {
            chat_id: chatId,
            text: `✅ <b>Setup Video Updated Successfully!</b> 🎬\n\nAapke Auto-DM me naya video save ho gaya hai. User ko ab yahi video deliver hoga!`,
            parse_mode: 'HTML'
          });
          await sendCustomerBotManagementMenu(botToken, chatId, getCampaignById(custCamp.id) || custCamp);
          return;
        }

        if (msg.audio || msg.voice) {
          const audioId = (msg.audio || msg.voice).file_id;
          saveCampaign(custCamp.owner, { id: custCamp.id, audio_url: audioId });
          await callTelegramApi(botToken, 'sendMessage', {
            chat_id: chatId,
            text: `✅ <b>Voice / Audio Guide Updated Successfully!</b> 🎙️\n\nAapke Auto-DM me naya audio save ho gaya hai!`,
            parse_mode: 'HTML'
          });
          await sendCustomerBotManagementMenu(botToken, chatId, getCampaignById(custCamp.id) || custCamp);
          return;
        }
      }
    }

    // ================= C. CUSTOMER AWAITING TEXT INPUT (STATE MACHINE) =================
    if (customerSessionStates.has(fromUser.id) && text && !text.startsWith('/')) {
      const state = customerSessionStates.get(fromUser.id)!;
      if (Date.now() - state.timestamp < 15 * 60 * 1000) {
        const campaign = getCampaignBySlug(state.campaign_slug);
        if (campaign) {
          if (state.action === 'awaiting_welcome_text') {
            customerSessionStates.delete(fromUser.id);
            saveCampaign(campaign.owner, { id: campaign.id, lock_message: text });
            await callTelegramApi(botToken, 'sendMessage', {
              chat_id: chatId,
              text: `✅ <b>Welcome / Auto-DM Text Updated Successfully!</b> 📝\n\nNaya text Auto-DM sequence me set ho gaya hai.`,
              parse_mode: 'HTML'
            });
            await sendCustomerBotManagementMenu(botToken, chatId, getCampaignById(campaign.id) || campaign);
            return;
          }

          if (state.action === 'awaiting_channel') {
            customerSessionStates.delete(fromUser.id);
            const cleanCh = text.replace(/.*t\.me\//, '').replace(/^@/, '').trim();
            saveCampaign(campaign.owner, { id: campaign.id, channel_username: cleanCh });
            await callTelegramApi(botToken, 'sendMessage', {
              chat_id: chatId,
              text: `✅ <b>Target Channel Updated to @${cleanCh}!</b> 📢`,
              parse_mode: 'HTML'
            });
            await sendCustomerBotManagementMenu(botToken, chatId, getCampaignById(campaign.id) || campaign);
            return;
          }

          if (state.action === 'awaiting_contact_user') {
            customerSessionStates.delete(fromUser.id);
            const cleanContact = text.replace(/.*t\.me\//, '').replace(/^@/, '').trim();
            saveCampaign(campaign.owner, { id: campaign.id, contact_username: cleanContact });
            await callTelegramApi(botToken, 'sendMessage', {
              chat_id: chatId,
              text: `✅ <b>Personal DM Redirect Button Updated to @${cleanContact}!</b> 💬`,
              parse_mode: 'HTML'
            });
            await sendCustomerBotManagementMenu(botToken, chatId, getCampaignById(campaign.id) || campaign);
            return;
          }

          if (state.action === 'awaiting_contact_btn_text') {
            customerSessionStates.delete(fromUser.id);
            saveCampaign(campaign.owner, { id: campaign.id, contact_button_text: text.trim() });
            await callTelegramApi(botToken, 'sendMessage', {
              chat_id: chatId,
              text: `✅ <b>Contact Button Label Updated to:</b>\n"<b>${text.trim()}</b>" 💬`,
              parse_mode: 'HTML'
            });
            await sendCustomerButtonsMenu(botToken, chatId, getCampaignById(campaign.id) || campaign);
            return;
          }

          if (state.action === 'awaiting_unlock_content') {
            customerSessionStates.delete(fromUser.id);
            saveCampaign(campaign.owner, { id: campaign.id, unlock_content: text.trim() });
            await callTelegramApi(botToken, 'sendMessage', {
              chat_id: chatId,
              text: `✅ <b>VIP Unlock Content Updated Successfully!</b> 🔓\n\nVerified users ko ab yahi content deliver hoga.`,
              parse_mode: 'HTML'
            });
            await sendCustomerBotManagementMenu(botToken, chatId, getCampaignById(campaign.id) || campaign);
            return;
          }

          if (state.action === 'awaiting_button_title') {
            state.pending_btn_title = text.trim();
            state.action = 'awaiting_button_action';
            state.timestamp = Date.now();
            await callTelegramApi(botToken, 'sendMessage', {
              chat_id: chatId,
              text: `🔘 <b>Button Title: "${text.trim()}"</b>\n━━━━━━━━━━━━━━━━━━━━\n<b>Step 2/2: Button tap hone par kya action ho?</b>\n\n1️⃣ <b>URL Link:</b> Agar website ya Telegram link open karwana hai to link chat me bhejein:\nExample: <code>https://t.me/MyChannel</code> ya <code>https://myhack.com</code>\n\n2️⃣ <b>Popup Alert:</b> Agar tap hone par Telegram screen par popup alert notification show karna hai to alert text type karke bhejein:\nExample: <code>⭐️ VIP Access Verified! Check your DM.</code>`,
              parse_mode: 'HTML'
            });
            return;
          }

          if (state.action === 'awaiting_button_action') {
            const btnTitle = state.pending_btn_title || 'Custom Button';
            customerSessionStates.delete(fromUser.id);
            let extraList: any[] = [];
            if (campaign.extra_buttons_json) {
              try {
                const p = JSON.parse(campaign.extra_buttons_json);
                if (Array.isArray(p)) extraList = p;
              } catch (e) {}
            }

            const cleanInput = text.trim();
            if (cleanInput.startsWith('http://') || cleanInput.startsWith('https://') || cleanInput.startsWith('t.me/') || cleanInput.startsWith('@')) {
              const url = cleanInput.startsWith('@') ? `https://t.me/${cleanInput.replace(/^@/, '')}` : (cleanInput.startsWith('t.me/') ? `https://${cleanInput}` : cleanInput);
              extraList.push({ text: btnTitle, url, layout: '2_per_row' });
            } else {
              extraList.push({ text: btnTitle, type: 'alert', alert_text: cleanInput, layout: '2_per_row' });
            }

            saveCampaign(campaign.owner, { id: campaign.id, extra_buttons_json: JSON.stringify(extraList) });
            await callTelegramApi(botToken, 'sendMessage', {
              chat_id: chatId,
              text: `✅ <b>Custom Button "${btnTitle}" Added Successfully!</b> 🔘\n\nAuto-DM buttons list me naya button save ho gaya hai.`,
              parse_mode: 'HTML'
            });
            await sendCustomerButtonsMenu(botToken, chatId, getCampaignById(campaign.id) || campaign);
            return;
          }

          if (state.action === 'awaiting_broadcast_btn') {
            const parts = text.split('|');
            const btnText = parts[0]?.trim();
            const btnUrl = (parts[1] || '').trim();
            if (btnText && btnUrl) {
              state.broadcast_btn_text = btnText;
              state.broadcast_btn_url = btnUrl.startsWith('http') ? btnUrl : `https://${btnUrl}`;
            }
            state.action = 'awaiting_broadcast_confirm';

            let targetLabel = '👥 All Subscribers';
            if (state.broadcast_filter === 'pending_only') targetLabel = '⏳ Pending Only (Unjoined Users)';
            if (state.broadcast_filter === 'joined_only') targetLabel = '✅ Joined Only (Verified Users)';

            const previewMsg = `👁️ <b>BROADCAST DISPATCH PREVIEW</b>\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `🎯 <b>Target:</b> ${targetLabel}\n` +
              `📁 <b>Media Attached:</b> ${state.broadcast_media_id ? (state.broadcast_media_type === 'photo' ? 'Photo / Screenshot ✅' : 'Video ✅') : 'None (Text Only)'}\n` +
              `🔘 <b>Inline CTA Button:</b> ${state.broadcast_btn_text ? `[${state.broadcast_btn_text}] ➔ ${state.broadcast_btn_url}` : 'None'}\n` +
              `📝 <b>Broadcast Content:</b>\n\n` +
              `${state.broadcast_text || '<i>(No caption text)</i>'}\n` +
              `━━━━━━━━━━━━━━━━━━━━\n` +
              `<i>Kya aap is broadcast ko sabhi target subscribers ko turant blast karna chahte hain?</i>`;

            await callTelegramApi(botToken, 'sendMessage', {
              chat_id: chatId,
              text: previewMsg,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '🚀 Confirm & Blast Broadcast Now', callback_data: `c_bc_blast:${state.campaign_slug}` }
                  ],
                  [
                    { text: '❌ Cancel Broadcast', callback_data: `c_mgmt:back:${state.campaign_slug}` }
                  ]
                ]
              }
            });
            return;
          }

          if (state.action === 'awaiting_broadcast_text') {
            customerSessionStates.delete(fromUser.id);
            const bcResult = createBroadcastJob(campaign.owner, {
              campaign_id: campaign.id,
              campaign_name: campaign.title,
              message_text: text,
              target_filter: 'all'
            });
            await callTelegramApi(botToken, 'sendMessage', {
              chat_id: chatId,
              text: `🚀 <b>Broadcast Dispatched!</b>\n\nJob started. Total <b>${bcResult.job?.total_targets || 0}</b> subscribers ko background queue me direct message deliver ho raha hai.`,
              parse_mode: 'HTML'
            });
            await sendCustomerBotManagementMenu(botToken, chatId, campaign);
            return;
          }
        }
      } else {
        customerSessionStates.delete(fromUser.id);
      }
    }

    // ================= D. CUSTOMER /LOGIN OR /CONNECT COMMAND =================
    if (text.startsWith('/login') || text.startsWith('/connect')) {
      const targetSlug = text.split(' ')[1]?.trim().replace(/^@/, '').replace(/^\//, '');
      if (!targetSlug) {
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `⚠️ Usage: <code>/login &lt;campaign_slug&gt;</code>\nExample: <code>/login vip_zone</code>\n\n(Aapka slug web dashboard me ya Admin se prapt karein)`,
          parse_mode: 'HTML'
        });
        return;
      }
      const campaign = getCampaignBySlug(targetSlug);
      if (!campaign) {
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `❌ Campaign slug "<b>${targetSlug}</b>" nahi mila! Kripya sahi slug enter karein.`,
          parse_mode: 'HTML'
        });
        return;
      }

      linkCampaignToCustomerTg(targetSlug, userTgIdStr);
      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: `🎉 <b>Account Successfully Linked!</b>\n\nAapka Telegram account campaign: <b>${campaign.title}</b> (<code>/${campaign.campaign_slug}</code>) ke sath bind ho gaya hai.\n\nAb aap direct Telegram app se is bot ko customize aur manage kar sakte hain!`,
        parse_mode: 'HTML'
      });
      await sendCustomerBotManagementMenu(botToken, chatId, getCampaignById(campaign.id) || campaign);
      return;
    }

    // ================= E. CUSTOMER /MENU, /MANAGE, OR /SETTINGS =================
    if (text === '/menu' || text === '/manage' || text === '/settings' || (text === '/start' && !text.split(' ')[1])) {
      const isOwnerOfDefault = Boolean(
        defaultCampaign && (
          defaultCampaign.customer_tg_id === userTgIdStr ||
          (userTgHandle && defaultCampaign.customer_tg_id === userTgHandle) ||
          (userTgHandle && defaultCampaign.owner.toLowerCase() === userTgHandle)
        )
      );

      const custCamp = isOwnerOfDefault
        ? defaultCampaign
        : (getCampaignByCustomerTg(userTgIdStr) || (userTgHandle ? getCampaignByCustomerTg(userTgHandle) : null));

      if (custCamp) {
        if (custCamp.billing_status === 'suspended' || custCamp.billing_status === 'unpaid') {
          await callTelegramApi(botToken, 'sendMessage', {
            chat_id: chatId,
            text: `❌ <b>BOT SERVICE SUSPENDED (BILL PENDING)</b>\n━━━━━━━━━━━━━━━━━━━━\nAapka bot bill unpaid hone ki wajah se Admin dwara suspend kar diya gaya hai.\n\nKripya Admin se sampark karke bill clear karein taaki bot instantly activate ho sake.`,
            parse_mode: 'HTML'
          });
          return;
        }
        await sendCustomerBotManagementMenu(botToken, chatId, custCamp);
        return;
      }

      // If this is a dedicated customer bot and sender is a regular visitor typing /start:
      if (defaultCampaign && text === '/start') {
        // Fall through to regular campaign auto-DM sequence for defaultCampaign below!
      } else {
        // If user is not customer and not admin, prompt them
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `👋 <b>Namaste ${fromUser.first_name || 'User'}!</b>\n\nAapka Telegram account kisi Bot Campaign se connected nahi hai.\n\nAgar aap Customer hain to apna bot connect karne ke liye type karein:\n<code>/login &lt;campaign_slug&gt;</code>\n\n<i>Example: /login my_campaign</i>`,
          parse_mode: 'HTML'
        });
        return;
      }
    }

    // ================= F. REGULAR USER /START WITH CAMPAIGN SLUG =================
    if (text.startsWith('/start')) {
      const parts = text.split(' ');
      const startParam = (parts[1] || '').trim();

      // Support /start login_slug
      if (startParam.startsWith('login_')) {
        const targetSlug = startParam.replace('login_', '').trim();
        const campaign = getCampaignBySlug(targetSlug);
        if (campaign) {
          linkCampaignToCustomerTg(targetSlug, userTgIdStr);
          await callTelegramApi(botToken, 'sendMessage', {
            chat_id: chatId,
            text: `🎉 <b>Account Linked!</b>\nAapka Telegram account campaign: <b>${campaign.title}</b> ke sath bind ho chuka hai!`,
            parse_mode: 'HTML'
          });
          await sendCustomerBotManagementMenu(botToken, chatId, getCampaignById(campaign.id) || campaign);
          return;
        }
      }

      let campaign: GrowthCampaign | null = null;
      if (startParam) {
        campaign = getCampaignBySlug(startParam);
      }
      if (!campaign && defaultCampaign) {
        campaign = defaultCampaign;
      }

      if (!campaign) {
        const welcomeText = `👋 <b>Welcome to the Official Gateway Bot!</b>\n\nPlease use a valid campaign link or tap below to explore.`;
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: welcomeText,
          parse_mode: 'HTML'
        });
        return;
      }

      // Check Billing Status Kill-Switch
      if (campaign.billing_status === 'suspended' || campaign.billing_status === 'unpaid') {
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `⚠️ <b>Service Temporarily Inactive</b>\n\nThis channel gateway has been temporarily paused by administration due to billing/maintenance. Please contact support.`,
          parse_mode: 'HTML'
        });
        return;
      }

      // Record subscriber for this campaign owner
      recordSubscriber(campaign.owner, campaign.id, fromUser, false);

      // Check if user is already a member
      let isAlreadyMember = false;
      if (campaign.channel_username) {
        const memCheck = await checkChannelMembership(botToken, campaign.channel_username, fromUser.id);
        if (memCheck.isMember) {
          isAlreadyMember = true;
          recordSubscriber(campaign.owner, campaign.id, fromUser, true);
        }
      }

      if (isAlreadyMember) {
        await sendCampaignAutoDmSequence(botToken, chatId, fromUser, campaign, true);
        return;
      }

      await sendCampaignAutoDmSequence(botToken, chatId, fromUser, campaign, false);
    }
  }

  // 2. Callback Query Handling
  if (update.callback_query) {
    const cb = update.callback_query;
    const data = cb.data || '';
    const fromUser = cb.from;
    const chatId = cb.message?.chat?.id || fromUser.id;
    const msgId = cb.message?.message_id;

    // ================= ADMIN KILL-SWITCH CALLBACKS =================
    if (data.startsWith('c_admin:kill:')) {
      const slug = data.replace('c_admin:kill:', '').trim();
      setCampaignBillingStatus(slug, 'unpaid', 'Suspended by admin 1-tap kill-switch');
      await callTelegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: cb.id,
        text: `🔴 Bot for /${slug} turned OFF (Bill: Unpaid marked)!`,
        show_alert: true
      });
      await sendMasterAdminMenu(botToken, chatId, msgId);
      return;
    }

    if (data.startsWith('c_admin:activate:')) {
      const slug = data.replace('c_admin:activate:', '').trim();
      setCampaignBillingStatus(slug, 'active', 'Activated by admin 1-tap resume');
      await callTelegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: cb.id,
        text: `🟢 Bot for /${slug} turned ON (Bill: Paid marked)!`,
        show_alert: true
      });
      await sendMasterAdminMenu(botToken, chatId, msgId);
      return;
    }

    if (data === 'c_admin:refresh') {
      await callTelegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: cb.id,
        text: '🔄 Refreshed!'
      });
      await sendMasterAdminMenu(botToken, chatId, msgId);
      return;
    }

    // ================= CUSTOMER MANAGEMENT CALLBACKS =================
    if (data.startsWith('c_mgmt:')) {
      const parts = data.split(':');
      const action = parts[1];
      const slug = parts[2];
      const campaign = getCampaignBySlug(slug);

      if (!campaign) {
        await callTelegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '❌ Campaign not found!',
          show_alert: true
        });
        return;
      }

      if (campaign.billing_status === 'suspended' || campaign.billing_status === 'unpaid') {
        await callTelegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '❌ Bot suspended! Kripya Admin se sampark karke bill clear karein.',
          show_alert: true
        });
        return;
      }

      if (action === 'edit_welcome') {
        customerSessionStates.set(fromUser.id, {
          campaign_slug: slug,
          action: 'awaiting_welcome_text',
          timestamp: Date.now()
        });
        await callTelegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '✍️ Message edit mode active!'
        });
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `✍️ <b>Enter New Welcome / Auto-DM Text:</b>\n━━━━━━━━━━━━━━━━━━━━\nKripya apna naya message chat me type karke send karein.\n\n• HTML Tags supported: <code>&lt;b&gt;bold&lt;/b&gt;</code>, <code>&lt;i&gt;italic&lt;/i&gt;</code>\n• User Name Tag: <code>{first_name}</code>\n• VIP Emojis: ⭐️ 👑 🔥 💎\n\n<i>Current Message:</i>\n${campaign.lock_message.substring(0, 150)}...`,
          parse_mode: 'HTML'
        });
        return;
      }

      if (action === 'set_channel') {
        customerSessionStates.set(fromUser.id, {
          campaign_slug: slug,
          action: 'awaiting_channel',
          timestamp: Date.now()
        });
        await callTelegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '📢 Channel setup active!'
        });
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `📢 <b>Set Target Channel:</b>\n━━━━━━━━━━━━━━━━━━━━\nApna Target Channel username ya private link chat me send karein:\n\nExample:\n<code>@MyVipChannel</code> ya <code>https://t.me/MyVipChannel</code>\n\n<i>(Current: @${campaign.channel_username || 'Not set'})</i>`,
          parse_mode: 'HTML'
        });
        return;
      }

      if (action === 'set_contact') {
        customerSessionStates.set(fromUser.id, {
          campaign_slug: slug,
          action: 'awaiting_contact_user',
          timestamp: Date.now()
        });
        await callTelegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '💬 Contact button setup active!'
        });
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `💬 <b>Set Personal Chat Redirect Button:</b>\n━━━━━━━━━━━━━━━━━━━━\nApna personal Telegram username chat me send karein (jahan user tap karke direct aapse chat karega):\n\nExample:\n<code>@Ashraf_VIP</code>\n\n<i>(Current: @${campaign.contact_username || 'Not set'})</i>`,
          parse_mode: 'HTML'
        });
        return;
      }

      if (action === 'set_media') {
        await callTelegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '📸 Send media directly!'
        });
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `📸/🎬/🎙️ <b>Send Any Media Directly in Chat!</b>\n━━━━━━━━━━━━━━━━━━━━\nAapko koi external link dene ki zaroorat nahi hai:\n\n1. <b>Photo</b> send karein ➔ Auto-DM Lock Screen Banner ban jayega\n2. <b>Video (MP4)</b> send karein ➔ Setup Video ban jayega\n3. <b>Voice / Audio</b> send karein ➔ Voice Guide ban jayega\n\nBot automatically media receive karke save kar lega!`,
          parse_mode: 'HTML'
        });
        return;
      }

      if (action === 'stats') {
        let totalSubs = 0;
        let verifiedSubs = 0;
        if (sqliteDb) {
          try {
            const row = sqliteDb.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN is_joined = 1 THEN 1 ELSE 0 END) as verified FROM growth_subscribers WHERE campaign_id = ?").get(campaign.id) as any;
            if (row) {
              totalSubs = row.total || 0;
              verifiedSubs = row.verified || 0;
            }
          } catch (e) {}
        }
        const pendingCount = totalSubs - verifiedSubs;
        const convRate = totalSubs > 0 ? ((verifiedSubs / totalSubs) * 100).toFixed(1) : '0';

        await callTelegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: `📊 Total: ${totalSubs} | Verified: ${verifiedSubs} | Pending: ${pendingCount} (${convRate}%)`,
          show_alert: true
        });
        return;
      }

      if (action === 'preview') {
        await callTelegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '👁️ Sending Live Preview...'
        });
        await sendCampaignAutoDmSequence(botToken, chatId, fromUser, campaign, false);
        return;
      }

      if (action === 'broadcast' || action === 'broadcast_menu') {
        await callTelegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '🚀 Opening Broadcast Studio...'
        });
        await sendCustomerBroadcastMenu(botToken, chatId, campaign, msgId);
        return;
      }

      if (action === 'buttons_studio') {
        await callTelegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '🔘 Opening Buttons Studio...'
        });
        await sendCustomerButtonsMenu(botToken, chatId, campaign, msgId);
        return;
      }

      if (action === 'edit_unlock') {
        customerSessionStates.set(fromUser.id, {
          campaign_slug: slug,
          action: 'awaiting_unlock_content',
          timestamp: Date.now()
        });
        await callTelegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '🔓 Unlock content edit active!'
        });
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `🔓 <b>Set VIP Unlock Content:</b>\n━━━━━━━━━━━━━━━━━━━━\nJab user official channel join karke <b>✅ Check Membership</b> tap karega, tab use kya message/links milne chahiye?\n\nApna content chat me type karke send karein.\n\n<i>Current Content:</i>\n${(campaign.unlock_content || '').substring(0, 150)}...`,
          parse_mode: 'HTML'
        });
        return;
      }

      if (action === 'back') {
        await callTelegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '🔙 Main Menu'
        });
        await sendCustomerBotManagementMenu(botToken, chatId, getCampaignById(campaign.id) || campaign, msgId);
        return;
      }
    }

    // ================= CUSTOMER BUTTONS STUDIO CALLBACKS =================
    if (data.startsWith('c_btn:')) {
      const parts = data.split(':');
      const action = parts[1];
      const slug = parts[2];
      const campaign = getCampaignBySlug(slug);

      if (!campaign) {
        await callTelegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cb.id, text: '❌ Campaign not found!' });
        return;
      }

      if (action === 'add') {
        customerSessionStates.set(fromUser.id, {
          campaign_slug: slug,
          action: 'awaiting_button_title',
          timestamp: Date.now()
        });
        await callTelegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cb.id, text: '➕ Enter button title' });
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `➕ <b>Add New Inline Button (Step 1/2):</b>\n━━━━━━━━━━━━━━━━━━━━\nButton ka display title chat me type karke send karein.\n\nExamples:\n• ⭐️ <b>VIP DAILY PROOFS</b>\n• 🎁 <b>CLAIM 500 BONUS</b>\n• 📊 <b>REGISTER VIP ACCOUNT</b>`,
          parse_mode: 'HTML'
        });
        return;
      }

      if (action === 'edit_dm_label') {
        customerSessionStates.set(fromUser.id, {
          campaign_slug: slug,
          action: 'awaiting_contact_btn_text',
          timestamp: Date.now()
        });
        await callTelegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cb.id, text: '✏️ Enter button label' });
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `💬 <b>Set Contact DM Button Label:</b>\n━━━━━━━━━━━━━━━━━━━━\nButton par kya text likha hona chahiye? Chat me send karein.\n\nExamples:\n• 🚀 <b>DM FOR LOSS RECOVERY</b>\n• 👑 <b>CHAT WITH OWNER</b>\n• 🔥 <b>GET VIP HACK ACCESS</b>\n\n<i>Current: "${campaign.contact_button_text || '🚀 DM FOR LOSS RECOVERY'}"</i>`,
          parse_mode: 'HTML'
        });
        return;
      }

      if (action === 'clear') {
        saveCampaign(campaign.owner, { id: campaign.id, extra_buttons_json: '[]' });
        await callTelegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '🗑️ Extra buttons cleared!',
          show_alert: true
        });
        await sendCustomerButtonsMenu(botToken, chatId, getCampaignById(campaign.id) || campaign, msgId);
        return;
      }

      if (action === 'toggle_layout') {
        let extraList: any[] = [];
        if (campaign.extra_buttons_json) {
          try {
            const p = JSON.parse(campaign.extra_buttons_json);
            if (Array.isArray(p)) extraList = p;
          } catch (e) {}
        }
        const isCurrentCompact = extraList.some(b => b.layout === '2_per_row' || b.size === 'compact');
        const newLayout = isCurrentCompact ? '1_per_row' : '2_per_row';
        extraList.forEach(b => { b.layout = newLayout; b.size = newLayout === '2_per_row' ? 'compact' : 'full'; });
        saveCampaign(campaign.owner, { id: campaign.id, extra_buttons_json: JSON.stringify(extraList) });
        await callTelegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: `📐 Layout switched to: ${newLayout === '2_per_row' ? 'Dual Compact (2 per row)' : 'Full Width (1 per row)'}`
        });
        await sendCustomerButtonsMenu(botToken, chatId, getCampaignById(campaign.id) || campaign, msgId);
        return;
      }
    }

    // ================= CUSTOMER BROADCAST STUDIO CALLBACKS =================
    if (data.startsWith('c_bc_target:')) {
      const parts = data.split(':');
      const targetFilter = parts[1] as 'all' | 'joined_only' | 'pending_only';
      const slug = parts[2];
      const campaign = getCampaignBySlug(slug);

      if (!campaign) {
        await callTelegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cb.id, text: '❌ Campaign not found!' });
        return;
      }

      let subCount = 0;
      let verifiedCount = 0;
      if (sqliteDb) {
        try {
          const stats = sqliteDb.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN is_joined = 1 THEN 1 ELSE 0 END) as verified FROM growth_subscribers WHERE campaign_id = ?").get(campaign.id) as any;
          if (stats) {
            subCount = stats.total || 0;
            verifiedCount = stats.verified || 0;
          }
        } catch (e) {}
      }
      const pendingCount = subCount - verifiedCount;
      const targetCount = targetFilter === 'pending_only' ? pendingCount : (targetFilter === 'joined_only' ? verifiedCount : subCount);
      const targetLabel = targetFilter === 'pending_only' ? '⏳ Pending Only (Unjoined Users)' : (targetFilter === 'joined_only' ? '✅ Joined Only (Verified Users)' : '👥 All Subscribers');

      customerSessionStates.set(fromUser.id, {
        campaign_slug: slug,
        action: 'awaiting_broadcast_content',
        broadcast_filter: targetFilter,
        timestamp: Date.now()
      });

      await callTelegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: cb.id,
        text: `🎯 Target: ${targetLabel}`
      });

      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: `🎯 <b>Target Audience Selected: ${targetLabel} (${targetCount} Users)</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `Ab aap apna Broadcast message send karein:\n\n` +
          `📸 <b>Photo / Screenshot:</b> Direct send karein, caption me DM text likh sakte hain.\n` +
          `🎬 <b>Video:</b> Direct send karein, caption me DM text likh sakte hain.\n` +
          `📝 <b>Text Only:</b> Seedhe message type karke send karein.\n\n` +
          `<i>💡 Tip: Har baar naya screenshot badal kar broadcast karne ke liye photo attach karke bhejein!</i>`,
        parse_mode: 'HTML'
      });
      return;
    }

    if (data.startsWith('c_bc_blast:')) {
      const slug = data.replace('c_bc_blast:', '').trim();
      const campaign = getCampaignBySlug(slug);
      const state = customerSessionStates.get(fromUser.id);

      if (!campaign || !state) {
        await callTelegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '❌ Broadcast session expired or not found! Please try again.',
          show_alert: true
        });
        return;
      }

      if (campaign.billing_status === 'suspended' || campaign.billing_status === 'unpaid') {
        await callTelegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '❌ Bot suspended! Kripya bill clear karein.',
          show_alert: true
        });
        return;
      }

      customerSessionStates.delete(fromUser.id);

      const bcResult = createBroadcastJob(campaign.owner, {
        campaign_id: campaign.id,
        campaign_name: `${campaign.title} (${state.broadcast_filter || 'all'})`,
        message_text: state.broadcast_text || '',
        media_type: state.broadcast_media_type || 'text',
        media_url: state.broadcast_media_id || '',
        buttons_json: state.broadcast_btn_text ? JSON.stringify([{ text: state.broadcast_btn_text, url: state.broadcast_btn_url }]) : undefined,
        target_filter: state.broadcast_filter || 'all'
      });

      await callTelegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: cb.id,
        text: `🚀 Dispatched to ${bcResult.job?.total_targets || 0} subscribers!`,
        show_alert: true
      });

      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: `🚀 <b>Broadcast Dispatched Successfully!</b>\n━━━━━━━━━━━━━━━━━━━━\nJob ID: <code>${bcResult.job?.id || 'live'}</code>\nTotal Target Subscribers: <b>${bcResult.job?.total_targets || 0}</b>\n\nBackground queue me message deliver hona start ho gaya hai. Aap progress live check kar sakte hain!`,
        parse_mode: 'HTML'
      });

      await sendCustomerBotManagementMenu(botToken, chatId, getCampaignById(campaign.id) || campaign);
      return;
    }

    if (data.startsWith('c_bc_add_btn:')) {
      const slug = data.replace('c_bc_add_btn:', '').trim();
      const state = customerSessionStates.get(fromUser.id);
      if (state) {
        state.action = 'awaiting_broadcast_btn';
        state.timestamp = Date.now();
        await callTelegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cb.id, text: '🔘 Add CTA Button' });
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `🔘 <b>Add CTA Button to Broadcast:</b>\n━━━━━━━━━━━━━━━━━━━━\nButton text aur URL link is format me bhejein:\n\n<code>Button Text | https://t.me/yourlink</code>\n\nExample:\n<code>👉 JOIN VIP NOW | https://t.me/MyVipChannel</code>`,
          parse_mode: 'HTML'
        });
      }
      return;
    }

    if (data.startsWith('c_bc_retry:')) {
      const slug = data.replace('c_bc_retry:', '').trim();
      const state = customerSessionStates.get(fromUser.id);
      if (state) {
        state.action = 'awaiting_broadcast_content';
        state.timestamp = Date.now();
        await callTelegramApi(botToken, 'answerCallbackQuery', { callback_query_id: cb.id, text: '✏️ Send new media/text' });
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `✏️ Naya <b>Screenshot (Photo)</b>, <b>Video</b> ya <b>Text</b> chat me send karein.`,
          parse_mode: 'HTML'
        });
      }
      return;
    }

    // ================= CUSTOM POPUP ALERTS =================
    if (data.startsWith('c_alert:')) {
      const parts = data.split(':');
      const slug = parts[1];
      const btnIdx = parseInt(parts[2], 10);
      const campaign = getCampaignBySlug(slug);
      let alertMsg = '⭐️ VIP Notification: Request received! Please follow the instructions.';
      if (campaign && campaign.extra_buttons_json) {
        try {
          const extras = JSON.parse(campaign.extra_buttons_json);
          if (extras[btnIdx] && (extras[btnIdx].alert_text || extras[btnIdx].text)) {
            alertMsg = formatCampaignText(extras[btnIdx].alert_text || extras[btnIdx].text, fromUser, campaign);
          }
        } catch (e) {}
      }
      await callTelegramApi(botToken, 'answerCallbackQuery', {
        callback_query_id: cb.id,
        text: alertMsg.substring(0, 199),
        show_alert: true
      });
      return;
    }

    // ================= REGULAR VERIFY JOIN =================
    if (data.startsWith('verify_join:')) {
      const slug = data.replace('verify_join:', '').trim();
      const campaign = getCampaignBySlug(slug);

      if (!campaign) {
        await callTelegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '❌ Campaign not found or expired!',
          show_alert: true
        });
        return;
      }

      if (campaign.billing_status === 'suspended' || campaign.billing_status === 'unpaid') {
        await callTelegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '⚠️ Service temporarily paused by administration.',
          show_alert: true
        });
        return;
      }

      // Check membership
      const memCheck = await checkChannelMembership(botToken, campaign.channel_username, fromUser.id);

      if (memCheck.isMember) {
        recordSubscriber(campaign.owner, campaign.id, fromUser, true);
        await callTelegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: '🎉 Membership Verified! Access Unlocked! ✅',
          show_alert: false
        });
        await sendCampaignAutoDmSequence(botToken, chatId, fromUser, campaign, true);
      } else {
        await callTelegramApi(botToken, 'answerCallbackQuery', {
          callback_query_id: cb.id,
          text: `⚠️ You have not joined @${campaign.channel_username} yet!\n\nPlease join the channel first, then tap Check Membership.`,
          show_alert: true
        });
      }
    }
  }

  // 3. Channel Join Request Handling (chat_join_request)
  if (update.chat_join_request) {
    const joinReq = update.chat_join_request;
    const fromUser = joinReq.from;
    const chat = joinReq.chat;
    const chatId = fromUser.id;

    try {
      const cleanCh = (chat.username || String(chat.id)).replace(/^@/, '').toLowerCase();
      const allC = getAllCampaigns();
      const campaign = allC.find(c => {
        const cCh = (c.channel_username || '').replace(/^@/, '').toLowerCase();
        return cCh === cleanCh || c.channel_id === String(chat.id);
      });

      if (campaign) {
        // Enforce Billing Status Kill-Switch
        if (campaign.billing_status === 'suspended' || campaign.billing_status === 'unpaid') {
          return;
        }

        // Record subscriber as pending (Join request received)
        recordSubscriber(campaign.owner, campaign.id, fromUser, false);

        // NOTE: DO NOT auto approve join request! Customer approves when they want.
        // Send Instant Personalized Auto-DM with greeting, video, audio, and personal chat redirect buttons!
        await sendCampaignAutoDmSequence(botToken, chatId, fromUser, campaign, false);
      }
    } catch (e) {
      console.error('[GROWTH ENGINE] chat_join_request error:', e);
    }
  }
}

// Background Poller for Growth Bot (Master Bot + Multi-Tenant Dedicated Customer Bots)
const activeDedicatedPollers = new Set<string>();
const dedicatedBotOffsets = new Map<string, number>();

async function startDedicatedBotPoller(token: string, campaignId: string) {
  let offset = dedicatedBotOffsets.get(token) || 0;
  console.log(`[GROWTH ENGINE] Dedicated poller started for bot token: ...${token.slice(-6)}`);

  while (true) {
    try {
      const camp = getCampaignById(campaignId) || getCampaignByToken(token);
      if (!camp || camp.status !== 'active') {
        await new Promise(r => setTimeout(r, 6000));
        continue;
      }

      // Check billing status: if suspended or unpaid, shut off bot and alert on incoming messages
      if (camp.billing_status === 'suspended' || camp.billing_status === 'unpaid') {
        const res = await callTelegramApi(token, 'getUpdates', {
          offset: offset + 1,
          timeout: 10,
          allowed_updates: ['message', 'callback_query']
        });
        if (res && res.ok && Array.isArray(res.result)) {
          for (const upd of res.result) {
            offset = Math.max(offset, upd.update_id);
            dedicatedBotOffsets.set(token, offset);
            const chatId = upd.message?.chat?.id || upd.callback_query?.message?.chat?.id;
            if (chatId) {
              await callTelegramApi(token, 'sendMessage', {
                chat_id: chatId,
                text: `❌ <b>SERVICE SUSPENDED (BILL UNPAID)</b>\n━━━━━━━━━━━━━━━━━━━━\nYeh bot bill unpaid hone ki wajah se Admin dwara temporary turn OFF kar diya gaya hai.\n\nKripya Admin se sampark karke bill clear karein taaki bot instantly restore ho sake.`,
                parse_mode: 'HTML'
              });
            }
          }
        }
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      // Active & Paid: poll updates and handle via engine
      const res = await callTelegramApi(token, 'getUpdates', {
        offset: offset + 1,
        timeout: 25,
        allowed_updates: ['message', 'callback_query', 'chat_join_request']
      });

      if (res && res.ok && Array.isArray(res.result)) {
        for (const upd of res.result) {
          offset = Math.max(offset, upd.update_id);
          dedicatedBotOffsets.set(token, offset);
          try {
            await handleGrowthBotUpdate(upd, token, camp);
          } catch (err) {
            console.error('[GROWTH ENGINE] Dedicated bot update error:', err);
          }
        }
      } else {
        if (res && (!res.ok || res.error_code === 401 || res.error_code === 404)) {
          // Bad token or unauthorized: pause 20 seconds to prevent hammering CPU
          await new Promise(r => setTimeout(r, 20000));
        } else {
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    } catch (e) {
      await new Promise(r => setTimeout(r, 6000));
    }
  }
}

export function startGrowthBotPoller() {
  if (growthPollerActive) return;
  growthPollerActive = true;

  console.log('[GROWTH ENGINE] Multi-Bot Polling Manager Initialized.');

  // 1. Dedicated customer bots poller scanner (checks every 12s for new or updated customer bots)
  setInterval(() => {
    try {
      const dedicatedCamps = getAllDedicatedBotCampaigns();
      for (const c of dedicatedCamps) {
        if (!c.bot_token || !c.bot_token.trim()) continue;
        const tok = c.bot_token.trim();
        if (!activeDedicatedPollers.has(tok)) {
          activeDedicatedPollers.add(tok);
          startDedicatedBotPoller(tok, c.id);
        }
      }
    } catch (e) {}
  }, 12000);

  // Initial immediate scanner kick
  try {
    const dedicatedCamps = getAllDedicatedBotCampaigns();
    for (const c of dedicatedCamps) {
      if (!c.bot_token || !c.bot_token.trim()) continue;
      const tok = c.bot_token.trim();
      if (!activeDedicatedPollers.has(tok)) {
        activeDedicatedPollers.add(tok);
        startDedicatedBotPoller(tok, c.id);
      }
    }
  } catch (e) {}

  // 2. Master Gateway Bot polling loop
  (async () => {
    while (true) {
      try {
        const config = getGrowthBotConfig();
        if (!config.bot_token || !config.enabled) {
          await new Promise(r => setTimeout(r, 4000));
          continue;
        }

        const res = await callTelegramApi(config.bot_token.trim(), 'getUpdates', {
          offset: growthLastUpdateId + 1,
          timeout: 25,
          allowed_updates: ['message', 'callback_query', 'chat_join_request']
        });

        if (res && res.ok && Array.isArray(res.result)) {
          for (const upd of res.result) {
            growthLastUpdateId = Math.max(growthLastUpdateId, upd.update_id);
            try {
              await handleGrowthBotUpdate(upd);
            } catch (err) {
              console.error('[GROWTH ENGINE] Error handling update:', err);
            }
          }
        } else {
          if (res && (!res.ok || res.error_code === 401 || res.error_code === 404)) {
            await new Promise(r => setTimeout(r, 20000));
          } else {
            await new Promise(r => setTimeout(r, 3000));
          }
        }
      } catch (e) {
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  })();
}

// ---------------- BROADCAST ENGINE ----------------
export function createBroadcastJob(
  owner: string,
  data: {
    campaign_id?: string;
    campaign_name: string;
    message_text: string;
    media_type?: 'text' | 'photo' | 'video';
    media_url?: string;
    buttons_json?: string;
    target_filter?: 'all' | 'joined_only' | 'pending_only';
  }
): { ok: boolean; job?: GrowthBroadcast; msg?: string } {
  if (!sqliteDb) return { ok: false, msg: 'Database not initialized' };
  try {
    const id = `bc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const filter = data.target_filter || 'all';

    let targetQuery = "SELECT DISTINCT telegram_id FROM growth_subscribers WHERE ";
    const params: any[] = [];
    if (data.campaign_id) {
      targetQuery += "campaign_id = ?";
      params.push(data.campaign_id);
    } else {
      targetQuery += "owner = ?";
      params.push(owner);
    }

    if (filter === 'joined_only') {
      targetQuery += " AND is_joined = 1";
    } else if (filter === 'pending_only') {
      targetQuery += " AND is_joined = 0";
    }

    const targets = sqliteDb.prepare(targetQuery).all(...params) as { telegram_id: number }[];
    if (!targets || targets.length === 0) {
      return { ok: false, msg: 'No subscribers found for this target filter!' };
    }

    const job: GrowthBroadcast = {
      id,
      owner,
      campaign_name: data.campaign_name || 'Quick Broadcast',
      message_text: data.message_text,
      media_type: data.media_type || 'text',
      media_url: data.media_url || '',
      buttons_json: data.buttons_json || '',
      target_filter: filter,
      total_targets: targets.length,
      sent_count: 0,
      failed_count: 0,
      status: 'pending',
      created_at: Date.now()
    };

    sqliteDb.prepare(`
      INSERT INTO growth_broadcasts
      (id, owner, campaign_name, message_text, media_type, media_url, buttons_json, target_filter, total_targets, sent_count, failed_count, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      job.id,
      job.owner,
      job.campaign_name,
      job.message_text,
      job.media_type,
      job.media_url,
      job.buttons_json,
      job.target_filter,
      job.total_targets,
      job.sent_count,
      job.failed_count,
      job.status,
      job.created_at
    );

    // Launch async broadcast worker
    executeBroadcastJob(job.id, targets.map(t => t.telegram_id));

    return { ok: true, job };
  } catch (err: any) {
    console.error('[GROWTH ENGINE] createBroadcastJob error:', err);
    return { ok: false, msg: err.message || 'Failed to create broadcast' };
  }
}

async function executeBroadcastJob(jobId: string, recipientIds: number[]) {
  const config = getGrowthBotConfig();
  if (!config.bot_token) {
    sqliteDb?.prepare("UPDATE growth_broadcasts SET status = 'failed' WHERE id = ?").run(jobId);
    return;
  }

  const job = sqliteDb?.prepare("SELECT * FROM growth_broadcasts WHERE id = ?").get(jobId) as GrowthBroadcast | undefined;
  if (!job) return;

  sqliteDb?.prepare("UPDATE growth_broadcasts SET status = 'processing' WHERE id = ?").run(jobId);

  const botToken = config.bot_token.trim();
  let sent = 0;
  let failed = 0;

  // Parse buttons if provided
  let replyMarkup: any = undefined;
  if (job.buttons_json) {
    try {
      const parsedButtons = JSON.parse(job.buttons_json);
      if (Array.isArray(parsedButtons) && parsedButtons.length > 0) {
        replyMarkup = {
          inline_keyboard: parsedButtons.map((b: any) => [{ text: b.text, url: b.url }])
        };
      }
    } catch (e) {}
  }

  const delayMs = config.global_broadcast_delay_ms || 40; // ~25 msg/sec

  for (let i = 0; i < recipientIds.length; i++) {
    const tid = recipientIds[i];
    try {
      const formattedText = parseSpintax(job.message_text);

      let res: any = null;
      if (job.media_type === 'video' && job.media_url) {
        res = await sendTelegramVideo(botToken, tid, job.media_url, formattedText, replyMarkup);
      } else {
        res = await sendTelegramPhotoOrMessage(
          botToken,
          tid,
          formattedText,
          job.media_type === 'photo' ? job.media_url : undefined,
          replyMarkup
        );
      }

      if (res && res.ok) {
        sent++;
      } else {
        failed++;
      }
    } catch (err) {
      failed++;
    }

    // Update progress in DB every 20 sends or at end
    if (i % 20 === 0 || i === recipientIds.length - 1) {
      sqliteDb?.prepare("UPDATE growth_broadcasts SET sent_count = ?, failed_count = ? WHERE id = ?").run(sent, failed, jobId);
    }

    await new Promise(r => setTimeout(r, delayMs));
  }

  sqliteDb?.prepare("UPDATE growth_broadcasts SET status = 'completed', completed_at = ?, sent_count = ?, failed_count = ? WHERE id = ?")
    .run(Date.now(), sent, failed, jobId);
}

export function getBroadcastHistory(owner: string, limit: number = 30): GrowthBroadcast[] {
  if (!sqliteDb) return [];
  try {
    const rows = sqliteDb.prepare("SELECT * FROM growth_broadcasts WHERE owner = ? ORDER BY created_at DESC LIMIT ?").all(owner, limit);
    return rows as GrowthBroadcast[];
  } catch (err) {
    return [];
  }
}
