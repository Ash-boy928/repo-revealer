// ---------------- CHANNEL BOT REACTIONS ENGINE ----------------
interface ChannelReactionConfig {
  id: string;
  owner: string;
  channel_username: string; // e.g. @channel or full link
  channel_chat_id?: string | number;
  bot_ids: string[]; // bot ids from botsVault
  emojis: string[]; // selected emojis (e.g. ['👍', '❤️', '🔥'])
  reaction_mode: 'mixed' | 'single'; // mixed random emojis or fixed
  delay_min_sec: number;
  delay_max_sec: number;
  auto_monitor: boolean; // auto-react to new posts
  created_at: string;
  updated_at: string;
  last_reacted_post_id?: number;
  status: 'active' | 'paused';
}

interface ReactionActivityLog {
  id: string;
  timestamp: string;
  owner: string;
  channel: string;
  message_id: number;
  bot_name: string;
  bot_username: string;
  emoji: string;
  status: 'success' | 'failed';
  error?: string;
}

const REACTION_CONFIGS_FILE = path.join(__dirname, 'reaction_configs.json');
const REACTION_LOGS_FILE = path.join(__dirname, 'reaction_logs.json');

let channelReactionConfigs: ChannelReactionConfig[] = [];
let channelReactionLogs: ReactionActivityLog[] = [];
const activeReactionMonitors = new Set<string>();

function loadChannelReactionsLocal(): void {
  try {
    if (fs.existsSync(REACTION_CONFIGS_FILE)) {
      const raw = fs.readFileSync(REACTION_CONFIGS_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) channelReactionConfigs = data;
    }
  } catch (e) {
    channelReactionConfigs = [];
  }
  try {
    if (fs.existsSync(REACTION_LOGS_FILE)) {
      const raw = fs.readFileSync(REACTION_LOGS_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) channelReactionLogs = data;
    }
  } catch (e) {
    channelReactionLogs = [];
  }
}

function saveChannelReactionsLocal(): void {
  try {
    fs.writeFileSync(REACTION_CONFIGS_FILE, JSON.stringify(channelReactionConfigs, null, 2), 'utf8');
  } catch {}
  try {
    fs.writeFileSync(REACTION_LOGS_FILE, JSON.stringify(channelReactionLogs.slice(0, 500), null, 2), 'utf8');
  } catch {}
}

function addReactionLog(log: Omit<ReactionActivityLog, 'id' | 'timestamp'>): void {
  const newLog: ReactionActivityLog = {
    ...log,
    id: `rlog_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    timestamp: formatISTDateTime()
  };
  channelReactionLogs.unshift(newLog);
  if (channelReactionLogs.length > 500) {
    channelReactionLogs = channelReactionLogs.slice(0, 500);
  }
  saveChannelReactionsLocal();
}

// In-memory cache for resolved channel handles/invite links to numeric chat IDs and titles
const channelTargetCache = new Map<string, { chatId: string | number; title: string }>();

function extractInviteHash(input: string): string | null {
  if (!input) return null;
  const str = input.trim();
  const plusMatch = str.match(/(?:t\.me\/\+|telegram\.me\/\+|\+)([a-zA-Z0-9_-]+)/i);
  if (plusMatch && plusMatch[1]) return plusMatch[1];
  const joinMatch = str.match(/(?:t\.me\/joinchat\/|telegram\.me\/joinchat\/)([a-zA-Z0-9_-]+)/i);
  if (joinMatch && joinMatch[1]) return joinMatch[1];
  return null;
}

// Clean channel username/handle from input string or link
function sanitizeChannelHandle(input: string): string {
  if (!input) return '';
  let clean = input.trim();

  // 1. Handle internal Telegram web client channel URLs: https://t.me/c/1234567890/123 -> -1001234567890
  const cMatch = clean.match(/(?:t\.me|telegram\.me)\/c\/(\d+)/i);
  if (cMatch && cMatch[1]) {
    return `-100${cMatch[1]}`;
  }

  // 2. Handle invite link hashes (+hash or joinchat/hash)
  const inviteHash = extractInviteHash(clean);
  if (inviteHash) {
    return `+${inviteHash}`;
  }

  clean = clean.replace(/^https?:\/\/t\.me\//i, '');
  clean = clean.replace(/^https?:\/\/telegram\.me\//i, '');
  clean = clean.replace(/^t\.me\//i, '');
  clean = clean.replace(/^telegram\.me\//i, '');
  clean = clean.replace(/^\/+|\/+$/g, '');

  // 3. If numeric ID (with or without - or -100 prefix), normalize to -100...
  if (/^-?\d+$/.test(clean)) {
    if (clean.startsWith('-100')) return clean;
    if (clean.startsWith('-')) return `-100${clean.substring(1)}`;
    return `-100${clean}`;
  }

  // 4. Remove post ID or query parameters if pasted post link (e.g. t.me/channel/123 -> channel)
  clean = clean.split('/')[0].split('?')[0];
  clean = clean.replace(/^@/, '');
  return clean ? `@${clean}` : '';
}

// Helper to resolve any channel target (public link, private invite link, or numeric chat ID) to a numeric chat ID
async function resolveChannelChatId(channelTarget: string, botToken?: string): Promise<{ chatId?: string | number; title?: string }> {
  if (!channelTarget) return {};
  const clean = sanitizeChannelHandle(channelTarget);
  if (channelTargetCache.has(clean)) {
    return channelTargetCache.get(clean)!;
  }
  if (channelTargetCache.has(channelTarget)) {
    return channelTargetCache.get(channelTarget)!;
  }

  // 1. If it's already a numeric chat ID (-100... or -...)
  if (/^-?\d+$/.test(clean)) {
    const formattedId = clean.startsWith('-100') ? clean : (clean.startsWith('-') ? clean : `-100${clean}`);
    const res = { chatId: formattedId, title: formattedId };
    channelTargetCache.set(clean, res);
    return res;
  }

  const inviteHash = extractInviteHash(channelTarget) || (clean.startsWith('+') ? clean.substring(1) : null);

  // 2. If it's an invite link, try to resolve via active GramJS user accounts
  if (inviteHash) {
    for (const acc of accounts.values()) {
      if (acc.client && (acc.status === 'online' || acc.status === 'Monitoring...' || acc.running)) {
        try {
          const inviteRes: any = await acc.client.invoke(new Api.messages.CheckChatInvite({ hash: inviteHash }));
          const chat = inviteRes?.chat || inviteRes;
          const rawId = chat?.id || inviteRes?.id;
          if (rawId) {
            const formattedId = `-100${rawId}`;
            const title = chat?.title || inviteRes?.title || `Private Channel (${inviteHash})`;
            const res = { chatId: formattedId, title };
            channelTargetCache.set(clean, res);
            channelTargetCache.set(channelTarget, res);
            return res;
          }
        } catch (e: any) {
          if (e?.chat?.id) {
            const formattedId = `-100${e.chat.id}`;
            const title = e.chat.title || `Private Channel (${inviteHash})`;
            const res = { chatId: formattedId, title };
            channelTargetCache.set(clean, res);
            channelTargetCache.set(channelTarget, res);
            return res;
          }
        }
      }
    }
  }

  // 3. Check Telegram Bot API updates for the bot to find channels the bot is in
  const tokensToCheck: string[] = [];
  if (botToken) tokensToCheck.push(botToken);
  for (const b of botsVault) {
    if (b.token && !tokensToCheck.includes(b.token)) {
      tokensToCheck.push(b.token);
    }
  }

  for (const token of tokensToCheck.slice(0, 5)) {
    try {
      // Ensure webhook is not blocking getUpdates
      await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`, { signal: AbortSignal.timeout(3000) }).catch(() => null);

      const updRes = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=-100&limit=100&allowed_updates=${encodeURIComponent('["my_chat_member","channel_post","chat_member","message"]')}`, {
        signal: AbortSignal.timeout(5000)
      }).catch(() => null);
      const updData: any = updRes ? await updRes.json().catch(() => null) : null;
      if (updData?.ok && Array.isArray(updData.result)) {
        for (const u of updData.result) {
          const chat = u.my_chat_member?.chat || u.channel_post?.chat || u.chat_member?.chat || u.message?.chat;
          if (chat && (chat.type === 'channel' || chat.type === 'supergroup') && chat.id) {
            const res = { chatId: chat.id, title: chat.title || String(chat.id) };
            channelTargetCache.set(clean, res);
            channelTargetCache.set(channelTarget, res);
            channelTargetCache.set(String(chat.id), res);
            return res;
          }
        }
      }
    } catch {}
  }

  // 4. If public @username, return @username
  if (clean.startsWith('@')) {
    return { chatId: clean, title: clean };
  }

  return {};
}

// Extract message ID if user provided post URL (e.g. https://t.me/channel/142)
function extractPostIdFromUrl(url: string): number | null {
  if (!url) return null;
  const match = url.match(/(?:t\.me\/|telegram\.me\/)[^/]+\/(\d+)/i);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }
  return null;
}

// Low-level helper: send reaction using Telegram Bot API setMessageReaction
async function applyBotReaction(botToken: string, chatId: string | number, messageId: number, emoji: string): Promise<{ ok: boolean; description?: string }> {
  try {
    const url = `https://api.telegram.org/bot${botToken}/setMessageReaction`;
    const body = {
      chat_id: chatId,
      message_id: messageId,
      reaction: [
        {
          type: 'emoji',
          emoji: emoji
        }
      ],
      is_big: false
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(9000)
    });
    const data: any = await res.json().catch(() => null);
    if (data?.ok) {
      return { ok: true };
    }
    return { ok: false, description: data?.description || `HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, description: err?.message || 'Network error' };
  }
}

interface BotAdminCheckResult {
  isAdmin: boolean;
  title?: string;
  chatId?: number | string;
  description: string;
  logs: string[];
  rawStatus?: string;
  permissions?: Record<string, boolean>;
  botInfo?: { id: number; username?: string; first_name?: string };
}

// Helper: check if a bot is an administrator in the target channel
async function checkBotChannelAdmin(botToken: string, channelTarget: string): Promise<BotAdminCheckResult> {
  const logs: string[] = [];
  const log = (msg: string) => {
    logs.push(msg);
    console.log(`[BotAdminVerify] ${msg}`);
  };

  try {
    const cleanTarget = sanitizeChannelHandle(channelTarget);
    log(`[INIT] Channel target: "${channelTarget}" -> Resolved identifier: "${cleanTarget}"`);

    // 1. Get bot identity first
    log(`[STEP 1/5] Verifying bot token credentials via /getMe...`);
    const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, { signal: AbortSignal.timeout(7000) }).catch((err) => {
      log(`❌ /getMe network error: ${err?.message || err}`);
      return null;
    });
    if (!meRes || !meRes.ok) {
      log(`❌ Telegram API responded with HTTP ${meRes?.status || 'ERR'} for /getMe.`);
      return { isAdmin: false, description: 'Invalid bot token or Telegram connection timeout', logs };
    }
    const meData: any = await meRes.json().catch(() => null);
    if (!meData?.ok || !meData?.result?.id) {
      log(`❌ Invalid bot token response: ${JSON.stringify(meData)}`);
      return { isAdmin: false, description: 'Invalid bot token credentials', logs };
    }
    const botUser = meData.result;
    const botUserId = botUser.id;
    const botUname = botUser.username ? `@${botUser.username}` : `ID:${botUserId}`;
    log(`✓ Bot Identity confirmed: ${botUname} (Bot ID: ${botUserId}, First Name: "${botUser.first_name || ''}")`);

    // 2. Direct getChatMember check for @username or numeric -100 ID
    if (cleanTarget.startsWith('@') || /^-100\d+$/.test(cleanTarget) || /^-?\d+$/.test(cleanTarget)) {
      const targetId = cleanTarget;
      log(`[STEP 2/5] Testing direct getChatMember & getChat for "${targetId}"...`);
      
      const directMemberRes = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(targetId)}&user_id=${botUserId}`, {
        signal: AbortSignal.timeout(7000)
      }).catch((err) => {
        log(`⚠️ Direct getChatMember connection timeout: ${err?.message || err}`);
        return null;
      });
      const directMemberData: any = directMemberRes ? await directMemberRes.json().catch(() => null) : null;

      if (directMemberData?.ok && directMemberData.result) {
        const mem = directMemberData.result;
        const status = mem.status;
        log(`✓ Received member status for bot ${botUname} in ${targetId}: status="${status}"`);
        
        if (status === 'administrator' || status === 'creator') {
          const directChatRes = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(targetId)}`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
          const directChatData: any = directChatRes ? await directChatRes.json().catch(() => null) : null;
          const chatTitle = directChatData?.result?.title || (directChatData?.result?.username ? `@${directChatData.result.username}` : String(targetId));
          const numericChatId = directChatData?.result?.id || targetId;

          const perms: Record<string, boolean> = {
            can_post_messages: Boolean(mem.can_post_messages !== false),
            can_edit_messages: Boolean(mem.can_edit_messages !== false),
            can_delete_messages: Boolean(mem.can_delete_messages !== false),
            can_change_info: Boolean(mem.can_change_info !== false),
            can_invite_users: Boolean(mem.can_invite_users !== false)
          };

          channelTargetCache.set(cleanTarget, { chatId: numericChatId, title: chatTitle });
          channelTargetCache.set(channelTarget, { chatId: numericChatId, title: chatTitle });
          channelTargetCache.set(String(numericChatId), { chatId: numericChatId, title: chatTitle });

          log(`✅ Success! Bot ${botUname} is verified as ${status.toUpperCase()} in "${chatTitle}" (Chat ID: ${numericChatId}).`);
          return {
            isAdmin: true,
            title: chatTitle,
            chatId: numericChatId,
            rawStatus: status,
            permissions: perms,
            botInfo: { id: botUserId, username: botUser.username, first_name: botUser.first_name },
            description: `Bot is ${status === 'creator' ? 'Channel Owner' : 'Administrator'}`,
            logs
          };
        } else if (status === 'member') {
          log(`⚠️ Bot is present in "${targetId}" but only has regular MEMBER status. Promotion required.`);
          return {
            isAdmin: false,
            rawStatus: status,
            botInfo: { id: botUserId, username: botUser.username },
            description: `Bot is in the channel as a regular Member. Please promote ${botUname} to Administrator in Channel Settings -> Administrators.`,
            logs
          };
        } else if (status === 'left' || status === 'kicked') {
          log(`❌ Bot status in "${targetId}" is "${status}". Bot is not a participant in the channel.`);
          return {
            isAdmin: false,
            rawStatus: status,
            botInfo: { id: botUserId, username: botUser.username },
            description: `Bot is not in the channel (status: ${status}). Please add ${botUname} to the channel as Administrator.`,
            logs
          };
        }
      } else {
        const errDesc = directMemberData?.description || (directMemberRes ? `HTTP ${directMemberRes.status}` : 'No response');
        log(`ℹ️ Direct lookup on "${targetId}" returned: "${errDesc}"`);
      }
    }

    // 3. Scan Bot's getUpdates for recent admin promotion events
    log(`[STEP 3/5] Checking Telegram Bot updates (getUpdates) for channel promotion events...`);
    await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook?drop_pending_updates=false`, { signal: AbortSignal.timeout(4000) }).catch(() => null);

    const updRes = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?offset=-100&limit=100&allowed_updates=${encodeURIComponent('["my_chat_member","channel_post","chat_member","message"]')}`, {
      signal: AbortSignal.timeout(7000)
    }).catch((err) => {
      log(`⚠️ getUpdates request timeout: ${err?.message || err}`);
      return null;
    });
    const updData: any = updRes ? await updRes.json().catch(() => null) : null;

    const detectedChats: Array<{ id: string | number; title?: string; username?: string }> = [];
    if (updData?.ok && Array.isArray(updData.result)) {
      log(`✓ Retrieved ${updData.result.length} update event(s) from Telegram for bot ${botUname}.`);
      for (const u of updData.result) {
        if (u.my_chat_member?.chat) {
          const c = u.my_chat_member.chat;
          const newStatus = u.my_chat_member.new_chat_member?.status;
          log(`  • Found my_chat_member event: "${c.title || c.id}" (${c.type}), status -> "${newStatus}"`);
          if (c.id && !detectedChats.some(dc => String(dc.id) === String(c.id))) {
            detectedChats.push({ id: c.id, title: c.title, username: c.username });
          }
        }
        if (u.channel_post?.chat) {
          const c = u.channel_post.chat;
          if (c.id && !detectedChats.some(dc => String(dc.id) === String(c.id))) {
            detectedChats.push({ id: c.id, title: c.title, username: c.username });
          }
        }
        if (u.chat_member?.chat) {
          const c = u.chat_member.chat;
          if (c.id && !detectedChats.some(dc => String(dc.id) === String(c.id))) {
            detectedChats.push({ id: c.id, title: c.title, username: c.username });
          }
        }
      }
    } else {
      log(`ℹ️ No pending updates returned by Telegram Bot API.`);
    }

    // Check each detected candidate chat
    log(`[STEP 4/5] Checking detected candidate channels (${detectedChats.length} found)...`);
    for (const dChat of detectedChats) {
      try {
        log(`  • Testing getChatMember on candidate channel ID ${dChat.id} ("${dChat.title || ''}")...`);
        const memRes = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(dChat.id)}&user_id=${botUserId}`, {
          signal: AbortSignal.timeout(5000)
        }).catch(() => null);
        const memData: any = memRes ? await memRes.json().catch(() => null) : null;
        if (memData?.ok && memData.result) {
          const status = memData.result.status;
          log(`    -> Status on ${dChat.id}: "${status}"`);
          if (status === 'administrator' || status === 'creator') {
            const finalTitle = dChat.title || (dChat.username ? `@${dChat.username}` : String(dChat.id));
            channelTargetCache.set(cleanTarget, { chatId: dChat.id, title: finalTitle });
            channelTargetCache.set(channelTarget, { chatId: dChat.id, title: finalTitle });
            channelTargetCache.set(String(dChat.id), { chatId: dChat.id, title: finalTitle });
            log(`✅ Success! Bot ${botUname} is verified as ${status.toUpperCase()} in detected channel "${finalTitle}" (ID: ${dChat.id})!`);
            return {
              isAdmin: true,
              title: finalTitle,
              chatId: dChat.id,
              rawStatus: status,
              botInfo: { id: botUserId, username: botUser.username, first_name: botUser.first_name },
              description: `Bot is ${status === 'creator' ? 'Channel Owner' : 'Administrator'}`,
              logs
            };
          }
        }
      } catch (err: any) {
        log(`    -> Error checking candidate ${dChat.id}: ${err?.message || err}`);
      }
    }

    // 4. Try resolving via GramJS active MTProto user accounts (if any are online)
    log(`[STEP 5/5] Checking active MTProto accounts for channel dialogs & invite link resolution...`);
    for (const acc of accounts.values()) {
      if (acc.client && (acc.status === 'online' || acc.status === 'Monitoring...' || acc.running)) {
        try {
          const dialogs: any = await acc.client.getDialogs({ limit: 50 }).catch(() => []);
          for (const d of dialogs) {
            if (d.isChannel || d.isGroup) {
              const rawId = d.entity?.id;
              if (rawId) {
                const formattedId = `-100${rawId}`;
                const memRes = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(formattedId)}&user_id=${botUserId}`, {
                  signal: AbortSignal.timeout(4000)
                }).catch(() => null);
                const memData: any = memRes ? await memRes.json().catch(() => null) : null;
                if (memData?.ok && (memData.result?.status === 'administrator' || memData.result?.status === 'creator')) {
                  const finalTitle = d.entity?.title || d.title || formattedId;
                  channelTargetCache.set(cleanTarget, { chatId: formattedId, title: finalTitle });
                  channelTargetCache.set(channelTarget, { chatId: formattedId, title: finalTitle });
                  log(`✅ Success! Bot is Administrator in resolved MTProto dialog "${finalTitle}" (${formattedId})!`);
                  return {
                    isAdmin: true,
                    title: finalTitle,
                    chatId: formattedId,
                    rawStatus: memData.result.status,
                    botInfo: { id: botUserId, username: botUser.username, first_name: botUser.first_name },
                    description: 'Bot is Administrator',
                    logs
                  };
                }
              }
            }
          }
        } catch {}
      }
    }

    // 5. Final fallback check with resolveChannelChatId
    const resolved = await resolveChannelChatId(channelTarget, botToken);
    if (resolved.chatId) {
      log(`Checking cached/resolved channel ID: ${resolved.chatId}`);
      const memberRes = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${encodeURIComponent(resolved.chatId)}&user_id=${botUserId}`, {
        signal: AbortSignal.timeout(6000)
      }).catch(() => null);
      const memberData: any = memberRes ? await memberRes.json().catch(() => null) : null;
      if (memberData?.ok && memberData.result) {
        const status = memberData.result.status;
        const isAdm = status === 'administrator' || status === 'creator';
        log(`Resolved ID ${resolved.chatId} status: "${status}"`);
        if (isAdm) {
          return {
            isAdmin: true,
            title: resolved.title || String(resolved.chatId),
            chatId: resolved.chatId,
            rawStatus: status,
            botInfo: { id: botUserId, username: botUser.username, first_name: botUser.first_name },
            description: 'Bot is Administrator',
            logs
          };
        }
      }
    }

    log(`❌ Bot admin rights could not be detected for ${botUname} on "${channelTarget}".`);
    log(`💡 Diagnostic Tips:`);
    log(`  1. Open Telegram -> Go to your Channel -> Edit -> Administrators -> Add Administrator.`);
    log(`  2. Add ${botUname} and ensure "Post Messages" permission is enabled.`);
    log(`  3. Post any test message in the channel so Telegram notifies the bot.`);
    log(`  4. If this is a private channel, you can also paste the channel ID (-100...) directly.`);

    return {
      isAdmin: false,
      botInfo: { id: botUserId, username: botUser.username },
      description: `Bot admin rights not detected for ${botUname}. If this is a private channel, please post a test message in your channel so Telegram notifies the bot, or provide the channel ID (-100...).`,
      logs
    };
  } catch (e: any) {
    log(`❌ Exception in verification process: ${e?.message || e}`);
    return {
      isAdmin: false,
      description: e?.name === 'TimeoutError' ? 'Verification request timed out' : (e?.message || 'Connection error'),
      logs
    };
  }
}

// Background poller loop for active auto-reaction configs
let reactionMonitorRunning = false;
async function startChannelReactionMonitorLoop() {
  if (reactionMonitorRunning) return;
  reactionMonitorRunning = true;

  while (true) {
    try {
      const activeConfigs = channelReactionConfigs.filter(c => c.status === 'active' && c.auto_monitor);
      for (const cfg of activeConfigs) {
        if (!cfg.channel_username || cfg.bot_ids.length === 0) continue;
        
        // Pick the first available bot in the config to monitor channel updates
        const primaryBotRecord = botsVault.find(b => cfg.bot_ids.includes(b.id));
        if (!primaryBotRecord || !primaryBotRecord.token) continue;

        try {
          // Poll channel for latest posts/messages via getUpdates or channel info
          const updatesUrl = `https://api.telegram.org/bot${primaryBotRecord.token}/getUpdates?timeout=1&limit=10&allowed_updates=${encodeURIComponent('["channel_post","message"]')}`;
          const res = await fetch(updatesUrl, { signal: AbortSignal.timeout(4000) }).catch(() => null);
          if (!res) continue;
          const json: any = await res.json().catch(() => null);

          if (json?.ok && Array.isArray(json.result)) {
            for (const upd of json.result) {
              const post = upd.channel_post || upd.message;
              if (!post || !post.message_id) continue;

              const postChat = post.chat;
              const postChatUsername = postChat?.username ? `@${postChat.username.toLowerCase()}` : '';
              const targetChatClean = cfg.channel_username.toLowerCase();

              const matchesChat = (postChatUsername && postChatUsername === targetChatClean) ||
                                  (cfg.channel_chat_id && String(postChat?.id) === String(cfg.channel_chat_id));

              if (matchesChat) {
                const postId = post.message_id;
                // Check if we already reacted to this post
                if (cfg.last_reacted_post_id && postId <= cfg.last_reacted_post_id) {
                  continue;
                }

                console.log(`[REACTION MONITOR] Detected new post #${postId} in channel ${cfg.channel_username} for owner ${cfg.owner}`);
                cfg.last_reacted_post_id = postId;
                saveChannelReactionsLocal();

                // Trigger staggered multi-bot reaction sequence asynchronously
                (async () => {
                  await executeMultiBotReactions(cfg, postId, cfg.channel_chat_id || cfg.channel_username);
                })();
              }
            }
          }
        } catch {}
      }
    } catch (err) {
      console.error('[REACTION MONITOR ERROR]:', err);
    }
    await new Promise(r => setTimeout(r, 6000));
  }
}

// Function to execute multi-bot reactions with staggered human-like random delays
async function executeMultiBotReactions(
  cfg: ChannelReactionConfig,
  postId: number,
  chatTarget: string | number
): Promise<{ successCount: number; totalCount: number; errors: string[] }> {
  const selectedBots = botsVault.filter(b => cfg.bot_ids.includes(b.id));
  if (selectedBots.length === 0) {
    return { successCount: 0, totalCount: 0, errors: ['No valid bots found in vault'] };
  }

  const availableEmojis = cfg.emojis && cfg.emojis.length > 0 
    ? cfg.emojis 
    : ['👍', '❤️', '🔥', '👏', '🎉', '🤩', '🚀'];

  let successCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < selectedBots.length; i++) {
    const bot = selectedBots[i];
    
    // Choose emoji: if 'single' mode, use first; if 'mixed', cycle or randomize
    let chosenEmoji: string;
    if (cfg.reaction_mode === 'single') {
      chosenEmoji = availableEmojis[0] || '👍';
    } else {
      chosenEmoji = availableEmojis[i % availableEmojis.length] || availableEmojis[0];
    }

    // Apply staggered safe human delay between bots (except first bot)
    if (i > 0) {
      const minD = Math.max(1, cfg.delay_min_sec || 3);
      const maxD = Math.max(minD, cfg.delay_max_sec || 10);
      const randomDelayMs = Math.floor(Math.random() * ((maxD - minD) * 1000 + 1)) + (minD * 1000);
      await new Promise(resolve => setTimeout(resolve, randomDelayMs));
    }

    const botDisplayName = bot.bot_name || bot.name || `@${bot.username}`;
    const result = await applyBotReaction(bot.token, chatTarget, postId, chosenEmoji);
    
    if (result.ok) {
      successCount++;
      addReactionLog({
        owner: cfg.owner,
        channel: cfg.channel_username,
        message_id: postId,
        bot_name: botDisplayName,
        bot_username: bot.username || '',
        emoji: chosenEmoji,
        status: 'success'
      });
      console.log(`[REACTION OK] Bot ${botDisplayName} reacted with ${chosenEmoji} to post #${postId} in ${cfg.channel_username}`);
    } else {
      const errMsg = result.description || 'Unknown reaction error';
      errors.push(`${botDisplayName}: ${errMsg}`);
      addReactionLog({
        owner: cfg.owner,
        channel: cfg.channel_username,
        message_id: postId,
        bot_name: botDisplayName,
        bot_username: bot.username || '',
        emoji: chosenEmoji,
        status: 'failed',
        error: errMsg
      });
      console.warn(`[REACTION FAIL] Bot ${botDisplayName} failed to react to post #${postId}:`, errMsg);
    }
  }

  return { successCount, totalCount: selectedBots.length, errors };
}

// --- API ENDPOINTS FOR CHANNEL BOT REACTIONS (ADMIN ONLY) ---

// 1. Get configs, logs, and stats
app.get('/api/admin/reactions', (req, res) => {
  const ownerFilter = (req.query.owner || '').toString().trim();
  let configs = channelReactionConfigs;
  let logs = channelReactionLogs;

  if (ownerFilter && ownerFilter !== 'all') {
    configs = configs.filter(c => c.owner === ownerFilter);
    logs = logs.filter(l => l.owner === ownerFilter);
  }

  res.json({
    success: true,
    configs,
    logs: logs.slice(0, 150),
    total_configs: configs.length,
    total_logs: logs.length
  });
});

// 2. Save or update reaction campaign / configuration
app.post('/api/admin/reactions/save', async (req, res) => {
  const b = req.body || {};
  const owner = (b.owner || 'admin').trim();
  const rawChannel = (b.channel || '').trim();
  const cleanChannel = sanitizeChannelHandle(rawChannel);

  if (!cleanChannel) {
    return res.status(400).json({ msg: 'Target channel link or @username is required!' });
  }

  const botIds: string[] = Array.isArray(b.bot_ids) ? b.bot_ids : [];
  if (botIds.length === 0) {
    return res.status(400).json({ msg: 'Please select at least 1 Telegram bot to react!' });
  }

  const emojis: string[] = Array.isArray(b.emojis) && b.emojis.length > 0 
    ? b.emojis 
    : ['👍', '❤️', '🔥', '👏', '🎉', '🤩', '🚀'];

  const delayMin = Math.max(1, parseInt(b.delay_min_sec, 10) || 3);
  const delayMax = Math.max(delayMin, parseInt(b.delay_max_sec, 10) || 12);
  const autoMonitor = Boolean(b.auto_monitor !== false);
  const reactionMode = b.reaction_mode === 'single' ? 'single' : 'mixed';

  // Optional: Try to resolve channel chat ID using one of the bots
  let resolvedChatId: string | number | undefined;
  const sampleBot = botsVault.find(bot => botIds.includes(bot.id));
  if (sampleBot) {
    const adminCheck = await checkBotChannelAdmin(sampleBot.token, cleanChannel);
    if (adminCheck.chatId) {
      resolvedChatId = adminCheck.chatId;
    }
  }

  const configId = b.id || `rcfg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const existingIdx = channelReactionConfigs.findIndex(c => c.id === configId);

  const newConfig: ChannelReactionConfig = {
    id: configId,
    owner,
    channel_username: cleanChannel,
    channel_chat_id: resolvedChatId,
    bot_ids: botIds,
    emojis,
    reaction_mode: reactionMode,
    delay_min_sec: delayMin,
    delay_max_sec: delayMax,
    auto_monitor: autoMonitor,
    created_at: existingIdx >= 0 ? channelReactionConfigs[existingIdx].created_at : new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: 'active'
  };

  if (existingIdx >= 0) {
    channelReactionConfigs[existingIdx] = { ...channelReactionConfigs[existingIdx], ...newConfig };
  } else {
    channelReactionConfigs.unshift(newConfig);
  }

  saveChannelReactionsLocal();

  res.json({
    success: true,
    msg: `Channel reaction campaign saved for ${cleanChannel} with ${botIds.length} bot(s)!`,
    config: newConfig
  });
});

// 3. Verify channel admin status for selected bots
app.post('/api/admin/reactions/verify-admin', async (req, res) => {
  const { channel, bot_ids } = req.body || {};
  const cleanChannel = sanitizeChannelHandle(channel);
  if (!cleanChannel) {
    return res.status(400).json({ msg: 'Please provide a valid channel link or @username!' });
  }

  const ids: string[] = Array.isArray(bot_ids) ? bot_ids : [];
  const targetBots = botsVault.filter(b => ids.includes(b.id));

  if (targetBots.length === 0) {
    return res.status(400).json({ msg: 'No bots selected for verification.' });
  }

  const results = await Promise.all(targetBots.map(async (b) => {
    const rawUname = (b.bot_username || b.username || '').replace(/^@/, '');
    try {
      const check = await checkBotChannelAdmin(b.token, channel || cleanChannel);
      return {
        bot_id: b.id,
        bot_name: b.bot_name || b.name || `@${rawUname}`,
        username: rawUname,
        is_admin: check.isAdmin,
        channel_title: check.title,
        chat_id: check.chatId,
        raw_status: check.rawStatus,
        permissions: check.permissions,
        bot_info: check.botInfo,
        description: check.description,
        logs: check.logs
      };
    } catch (err: any) {
      return {
        bot_id: b.id,
        bot_name: b.bot_name || b.name || `@${rawUname}`,
        username: rawUname,
        is_admin: false,
        description: `Verification error: ${err?.message || 'Connection failed'}`,
        logs: [`❌ Error during bot verification: ${err?.message || err}`]
      };
    }
  }));

  const allAdmin = results.every(r => r.is_admin);
  const adminCount = results.filter(r => r.is_admin).length;
  const verifiedResult = results.find(r => r.is_admin && r.chat_id);

  res.json({
    success: true,
    all_admin: allAdmin,
    admin_count: adminCount,
    total_bots: results.length,
    channel: cleanChannel,
    resolved_chat_id: verifiedResult?.chat_id,
    resolved_channel_title: verifiedResult?.channel_title,
    results
  });
});

// 3.5 Auto-detect all channels where the given bot(s) are Administrators
app.post('/api/admin/reactions/detect-bot-channels', async (req, res) => {
  const { bot_ids } = req.body || {};
  const ids: string[] = Array.isArray(bot_ids) ? bot_ids : [];
  const targetBots = botsVault.filter(b => ids.length === 0 || ids.includes(b.id));

  if (targetBots.length === 0) {
    return res.json({ channels: [] });
  }

  const detectedMap = new Map<string, { chat_id: string | number; title: string; username?: string; bot_ids: string[] }>();

  await Promise.all(targetBots.map(async (b) => {
    if (!b.token) return;
    try {
      const meRes = await fetch(`https://api.telegram.org/bot${b.token}/getMe`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
      const meData: any = meRes ? await meRes.json().catch(() => null) : null;
      if (!meData?.ok || !meData?.result?.id) return;
      const botUserId = meData.result.id;

      await fetch(`https://api.telegram.org/bot${b.token}/deleteWebhook?drop_pending_updates=false`, { signal: AbortSignal.timeout(3000) }).catch(() => null);

      const updRes = await fetch(`https://api.telegram.org/bot${b.token}/getUpdates?offset=-100&limit=100&allowed_updates=${encodeURIComponent('["my_chat_member","channel_post","chat_member"]')}`, {
        signal: AbortSignal.timeout(5000)
      }).catch(() => null);
      const updData: any = updRes ? await updRes.json().catch(() => null) : null;

      if (updData?.ok && Array.isArray(updData.result)) {
        for (const u of updData.result) {
          const c = u.my_chat_member?.chat || u.channel_post?.chat || u.chat_member?.chat;
          if (c && c.id && (c.type === 'channel' || c.type === 'supergroup')) {
            const strId = String(c.id);
            // Verify if admin
            const memRes = await fetch(`https://api.telegram.org/bot${b.token}/getChatMember?chat_id=${encodeURIComponent(c.id)}&user_id=${botUserId}`, {
              signal: AbortSignal.timeout(4000)
            }).catch(() => null);
            const memData: any = memRes ? await memRes.json().catch(() => null) : null;
            if (memData?.ok && (memData.result?.status === 'administrator' || memData.result?.status === 'creator')) {
              if (detectedMap.has(strId)) {
                const existing = detectedMap.get(strId)!;
                if (!existing.bot_ids.includes(b.id)) existing.bot_ids.push(b.id);
              } else {
                detectedMap.set(strId, {
                  chat_id: c.id,
                  title: c.title || strId,
                  username: c.username ? `@${c.username}` : undefined,
                  bot_ids: [b.id]
                });
              }
            }
          }
        }
      }
    } catch {}
  }));

  // Also check active GramJS accounts
  for (const acc of accounts.values()) {
    if (acc.client && (acc.status === 'online' || acc.status === 'Monitoring...' || acc.running)) {
      try {
        const dialogs: any = await acc.client.getDialogs({ limit: 30 }).catch(() => []);
        for (const d of dialogs) {
          if (d.isChannel || d.isGroup) {
            const rawId = d.entity?.id;
            if (rawId) {
              const formattedId = `-100${rawId}`;
              const strId = String(formattedId);
              if (!detectedMap.has(strId)) {
                detectedMap.set(strId, {
                  chat_id: formattedId,
                  title: d.entity?.title || d.title || strId,
                  username: d.entity?.username ? `@${d.entity.username}` : undefined,
                  bot_ids: []
                });
              }
            }
          }
        }
      } catch {}
    }
  }

  res.json({
    channels: Array.from(detectedMap.values())
  });
});

// 4. Instant Reaction trigger for a specific Post ID or URL
app.post('/api/admin/reactions/trigger-instant', async (req, res) => {
  const b = req.body || {};
  const owner = (b.owner || 'admin').trim();
  const rawTarget = (b.channel || '').trim();
  const postUrlOrId = (b.post_target || '').toString().trim();
  const cleanChannel = sanitizeChannelHandle(rawTarget);

  let postId: number | null = null;
  // If post_target is a number, use it; otherwise try to extract from URL
  if (/^\d+$/.test(postUrlOrId)) {
    postId = parseInt(postUrlOrId, 10);
  } else {
    postId = extractPostIdFromUrl(postUrlOrId) || extractPostIdFromUrl(rawTarget);
  }

  if (!postId) {
    return res.status(400).json({ msg: 'Please provide a valid Post ID (e.g. 145) or Post URL (e.g. https://t.me/channel/145)!' });
  }

  if (!cleanChannel) {
    return res.status(400).json({ msg: 'Target channel username is required!' });
  }

  const botIds: string[] = Array.isArray(b.bot_ids) ? b.bot_ids : [];
  if (botIds.length === 0) {
    return res.status(400).json({ msg: 'Please select at least 1 bot!' });
  }

  const emojis: string[] = Array.isArray(b.emojis) && b.emojis.length > 0 
    ? b.emojis 
    : ['👍', '❤️', '🔥', '👏', '🎉', '🤩', '🚀'];

  const reactionMode = b.reaction_mode === 'single' ? 'single' : 'mixed';
  const delayMin = Math.max(1, parseInt(b.delay_min_sec, 10) || 2);
  const delayMax = Math.max(delayMin, parseInt(b.delay_max_sec, 10) || 8);

  const resolved = await resolveChannelChatId(rawTarget);
  const targetChat = resolved.chatId || cleanChannel;

  const tempCfg: ChannelReactionConfig = {
    id: `temp_${Date.now()}`,
    owner,
    channel_username: cleanChannel,
    channel_chat_id: resolved.chatId,
    bot_ids: botIds,
    emojis,
    reaction_mode: reactionMode,
    delay_min_sec: delayMin,
    delay_max_sec: delayMax,
    auto_monitor: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: 'active'
  };

  // Launch reactions in background or immediately
  executeMultiBotReactions(tempCfg, postId, targetChat).then(outcome => {
    console.log(`[INSTANT REACTION FINISHED] Post #${postId} in ${cleanChannel} (${targetChat}): ${outcome.successCount}/${outcome.totalCount} successful.`);
  });

  res.json({
    success: true,
    msg: `🚀 Multi-bot reactions launched for Post #${postId} across ${botIds.length} bot(s) with human-like delays! Check live logs below.`,
    post_id: postId,
    channel: cleanChannel
  });
});

// 5. Delete or Pause/Resume Campaign
app.post('/api/admin/reactions/toggle-status', (req, res) => {
  const { id, action } = req.body || {};
  const cfg = channelReactionConfigs.find(c => c.id === id);
  if (!cfg) return res.status(404).json({ msg: 'Campaign config not found.' });

  if (action === 'delete') {
    channelReactionConfigs = channelReactionConfigs.filter(c => c.id !== id);
    saveChannelReactionsLocal();
    return res.json({ success: true, msg: 'Campaign deleted.' });
  } else {
    cfg.status = cfg.status === 'active' ? 'paused' : 'active';
    saveChannelReactionsLocal();
    return res.json({ success: true, msg: `Campaign status changed to ${cfg.status}.`, status: cfg.status });
  }
});

// 6. Clear reaction logs
app.post('/api/admin/reactions/clear-logs', (req, res) => {
  channelReactionLogs = [];
  saveChannelReactionsLocal();
  res.json({ success: true, msg: 'Reaction activity logs cleared.' });
});

app.get('/api/admin/users', (req         , res          ) => {
  const data        = [];
  const todayStr = getTodayDateString();

  for (const u of usersList) {
    const accs = Array.from(accounts.values()).filter((a) => (a.owner || 'admin').toLowerCase() === u.username.toLowerCase());
    const verifiedQ = getOwnerVerifiedQueue(u.username);
    const rawQ = getOwnerRawQueue(u.username);

    let userDailyDMs = 0;
    let sumAccSent = 0;
    for (const a of accs) {
      checkAndResetDailyDmQuota(a.phone);
      const idDaily = (a as any).daily_sent_count || 0;
      userDailyDMs += idDaily;
      sumAccSent += (a.sent_count || 0);
    }

    const historyKey = Object.keys(dailyDmHistory).find(k => k.toLowerCase() === u.username.toLowerCase()) || u.username;
    const todayHistCount = dailyDmHistory[historyKey]?.[todayStr]?.count || 0;
    userDailyDMs = Math.max(userDailyDMs, todayHistCount);

    let userHistoricalTotalDMs = 0;
    const userHistory = dailyDmHistory[historyKey] || {};
    for (const d of Object.keys(userHistory)) {
      userHistoricalTotalDMs += userHistory[d]?.count || 0;
    }
    const alreadySentSet = getOwnerSentUsers(u.username);
    const userTotalDMs = Math.max(userHistoricalTotalDMs, userDailyDMs, sumAccSent, alreadySentSet.size);

    const isUserAdmin = Boolean(u.role === 'admin' || u.username === 'admin');
    const isExpired = Boolean(!isUserAdmin && u.expiry_date && todayStr > u.expiry_date);
    const effectiveActive = isExpired ? false : (u.active ?? true);
    const dailyStats5Days = isUserAdmin ? [] : getOwnerDailyDmStats(u.username, accs.length);
    const joinKey = Object.keys(dailyJoinHistory).find(k => k.toLowerCase() === u.username.toLowerCase()) || u.username;
    const dailyJoinsCount = dailyJoinHistory[joinKey]?.[todayStr]?.count || 0;
    const totalJoinsCount = getOwnerLifetimeJoins(u.username);
    const last5DaysJoins = isUserAdmin ? [] : getOwnerDailyJoinStats(u.username);
    const conversionRate = userTotalDMs > 0 ? ((totalJoinsCount / userTotalDMs) * 100).toFixed(1) + '%' : (totalJoinsCount > 0 ? '100%' : '0.0%');
    const ratePerBot = Number(u.rate_per_bot || (billingStore.user_configs && billingStore.user_configs[u.username]?.rate_per_bot) || 15);
    const billingModel = (u.billing_model || (billingStore.user_configs && billingStore.user_configs[u.username]?.billing_model) || 'advance').toString();
    const maxAccounts = u.max_accounts ?? 5;

    data.push({
      username: u.username,
      role: u.role || 'user',
      active: effectiveActive,
      is_expired: isExpired,
      max_accounts: maxAccounts,
      max_targets: u.max_targets ?? 9999,
      expiry_date: u.expiry_date || '',
      rate_per_bot: ratePerBot,
      billing_model: billingModel,
      weekly_total: ratePerBot * maxAccounts,
      has_sq: Boolean(u.security_question && u.security_answer),
      alert_enabled: Boolean(u.alert_enabled),
      alert_bot_token: u.alert_bot_token || '',
      alert_chat_id: u.alert_chat_id || '',
      accounts_count: accs.length,
      running_count: accs.filter((a) => a.running).length,
      daily_dms_count: userDailyDMs,
      total_dms_count: userTotalDMs,
      last_5_days_dms: dailyStats5Days,
      daily_joins_count: dailyJoinsCount,
      total_joins_count: totalJoinsCount,
      last_5_days_joins: last5DaysJoins,
      conversion_rate: conversionRate,
      tracked_invite_link: userTrackedLinks[u.username]?.invite_link || '',
      verified_queue_count: verifiedQ.length,
      leftover_count: verifiedQ.length,
      already_sent_count: alreadySentSet.size,
      raw_queue_count: rawQ.length,
      phones: accs.map((a) => a.phone),
      labels: accs.map((a) => a.label || a.phone),
      registered_phones: Array.isArray(u.registered_phones) ? u.registered_phones : [],
      access_type: u.access_type || 'both',
      last_platform: (u as any).last_platform || 'Never',
      last_login: (u as any).last_login || 0,
      ai_enabled: u.ai_enabled === true,
      dynamic_templates_enabled: u.dynamic_templates_enabled !== false,
      accounts: accs.map((a) => {
        const idDaily = (a as any).daily_sent_count || 0;
        const idTotal = Math.max(a.sent_count || 0, idDaily, (a.sent_users ? a.sent_users.size : 0));
        return {
          phone: a.phone,
          label: a.label || a.phone,
          status: a.status,
          running: a.running,
          dm_on: a.dm_on !== false,
          live_on: a.live_on !== false,
          daily_sent_count: idDaily,
          sent_count: idTotal
        };
      })
    });
  }
  const allAccList = Array.from(accounts.values());
  const todayTotalDms = data.reduce((acc, u) => acc + (u.daily_dms_count || 0), 0);
  const fleetSummary = {
    total_accounts: allAccList.length,
    running_count: allAccList.filter(a => a.running).length,
    dm_on_count: allAccList.filter(a => a.dm_on !== false).length,
    live_on_count: allAccList.filter(a => a.live_on !== false).length
  };
  const adminUser = usersList.find((u: any) => u.role === 'admin' || u.username === 'admin');
  const adminName = adminUser?.admin_name || adminUser?.display_name || 'Admin';
  res.json({
    users: data,
    today_total_dms: todayTotalDms,
    fleet_summary: fleetSummary,
    view_as: req.session?.view_as || '',
    admin_name: adminName,
    total_vault_bots: botsVault.length,
    pending_slot_requests: slotRequests.filter(r => r.status === 'pending'),
    pending_access_requests: accessRequests.filter(r => r.status === 'pending')
  });
});

