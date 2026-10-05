// ---------------- BULK BOT GENERATOR & VAULT ENGINE ----------------
interface VaultBotRecord {
  id: string;
  name: string;
  bot_name?: string;
  username: string;
  bot_username?: string;
  token: string;
  creator_phone: string;
  creator_label: string;
  creator_owner: string;
  created_at: string;
  created_at_formatted: string;
  status: 'active' | 'revoked' | 'unverified';
  bot_id?: string;
  notes?: string;
}

interface GeneratorWorkerState {
  phone: string;
  label: string;
  owner: string;
  status: 'idle' | 'running' | 'connecting' | 'creating' | 'floodwait' | 'completed' | 'stopped' | 'error';
  currentStep: string;
  botsTarget: number;
  botsCreated: number;
  errorMsg?: string;
  floodWaitSeconds?: number;
  floodWaitUntil?: number;
  logs: string[];
}

const BOTS_VAULT_FILE = path.join(__dirname, 'bots_vault.json');
let botsVault: VaultBotRecord[] = [];
const generatorWorkerStates = new Map<string, GeneratorWorkerState>();
const generatorAbortControllers = new Map<string, AbortController>();

function formatISTDateTime(date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function loadBotsVaultLocal(): void {
  try {
    if (fs.existsSync(BOTS_VAULT_FILE)) {
      const raw = fs.readFileSync(BOTS_VAULT_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        botsVault = data.map((b: any) => {
          const rawUsername = (b.bot_username || b.username || '').replace(/^@/, '');
          const rawName = b.bot_name || b.name || (rawUsername ? `@${rawUsername}` : (b.bot_id ? `Bot #${b.bot_id}` : 'Bot'));
          return {
            ...b,
            name: rawName,
            bot_name: rawName,
            username: rawUsername,
            bot_username: rawUsername
          };
        });
        console.log(`[BOT VAULT] Loaded ${botsVault.length} generated bot(s) from bots_vault.json`);
      }
    }
  } catch (e) {
    console.error('Error loading bots_vault.json:', e);
    botsVault = [];
  }
}

function saveBotsVaultLocal(): void {
  try {
    fs.writeFileSync(BOTS_VAULT_FILE, JSON.stringify(botsVault, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving bots_vault.json:', e);
  }
}

function saveBotsVault(): void {
  saveBotsVaultLocal();
  (async () => {
    try {

    } catch {}
  })();
}

function getAccountBotsCount(phone: string): number {
  return botsVault.filter(b => b.creator_phone === phone).length;
}

// BotFather automated creation flow with robust username retry and limit checking
async function executeBotFatherNewBot(
  client: any,
  botName: string,
  usernamePrefix: string,
  phone: string,
  logWorker: (msg: string) => void
): Promise<{ token: string; username: string; name: string; botId: string }> {
  logWorker(`Connecting to @BotFather...`);
  const botFather = await client.getInputEntity('@BotFather').catch(() => '@BotFather');

  // Step 1: Cancel any interrupted conversation
  await client.sendMessage(botFather, { message: '/cancel' }).catch(() => null);
  await new Promise(r => setTimeout(r, 1500));

  // Step 2: Send /newbot command
  logWorker(`Issuing /newbot command to @BotFather...`);
  await client.sendMessage(botFather, { message: '/newbot' });
  await new Promise(r => setTimeout(r, 2500));

  let msgs: any = await client.getMessages(botFather, { limit: 3 }).catch(() => []);
  let latest = msgs?.[0]?.message || '';

  if (latest.toLowerCase().includes('limit') || latest.toLowerCase().includes('reached the limit')) {
    throw new Error('Telegram Bot Creation Quota Exceeded (Account has reached the maximum 20-bot limit on @BotFather)');
  }

  // Step 3: Send Bot Display Name
  logWorker(`Providing Bot Name: "${botName}"...`);
  await client.sendMessage(botFather, { message: botName });
  await new Promise(r => setTimeout(r, 2500));

  msgs = await client.getMessages(botFather, { limit: 3 }).catch(() => []);
  latest = msgs?.[0]?.message || '';

  // Step 4: Generate unique username ending in 'bot'
  let cleanPrefix = (usernamePrefix || 'leobot').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (!cleanPrefix || cleanPrefix.length < 3) cleanPrefix = 'leobot';
  if (cleanPrefix.endsWith('bot')) cleanPrefix = cleanPrefix.slice(0, -3);

  let successToken = '';
  let finalUsername = '';
  let attempts = 0;
  const maxAttempts = 8;

  while (attempts < maxAttempts) {
    attempts++;
    const randPart = Math.random().toString(36).substring(2, 6);
    const randNum = Math.floor(100 + Math.random() * 899);
    const candidate = `${cleanPrefix}_${randPart}${randNum}_bot`;

    logWorker(`Submitting username attempt ${attempts}/${maxAttempts}: @${candidate}...`);
    await client.sendMessage(botFather, { message: candidate });
    await new Promise(r => setTimeout(r, 3200));

    msgs = await client.getMessages(botFather, { limit: 3 }).catch(() => []);
    latest = msgs?.[0]?.message || '';
    const low = latest.toLowerCase();

    // Check token regex
    const tokenMatch = latest.match(/\b(\d{8,11}:[A-Za-z0-9_-]{35})\b/);
    if (tokenMatch) {
      successToken = tokenMatch[1];
      finalUsername = candidate;
      const linkMatch = latest.match(/t\.me\/([A-Za-z0-9_]+)/i);
      if (linkMatch && linkMatch[1]) {
        finalUsername = linkMatch[1];
      }
      logWorker(`🎉 Token acquired successfully for @${finalUsername}!`);
      break;
    }

    if (low.includes('sorry, this username is already taken') || low.includes('already taken') || low.includes('occupied')) {
      logWorker(`⚠️ @${candidate} is already taken. Retrying with new suffix...`);
      await new Promise(r => setTimeout(r, 1200));
      continue;
    }

    if (low.includes('short') || low.includes('invalid') || low.includes('must end in')) {
      logWorker(`⚠️ Formatting warning from @BotFather. Adjusting suffix...`);
      await new Promise(r => setTimeout(r, 1200));
      continue;
    }

    // Check second message just in case
    const msg2 = msgs?.[1]?.message || '';
    const tokenMatch2 = msg2.match(/\b(\d{8,11}:[A-Za-z0-9_-]{35})\b/);
    if (tokenMatch2) {
      successToken = tokenMatch2[1];
      finalUsername = candidate;
      break;
    }

    logWorker(`@BotFather: ${latest.slice(0, 60)}`);
  }

  if (!successToken) {
    throw new Error(`Failed to acquire token from @BotFather after ${attempts} attempts. Last response: ${latest.slice(0, 100)}`);
  }

  const botId = successToken.split(':')[0];
  let verifiedUsername = finalUsername;
  let verifiedName = botName;

  // Authoritatively query Telegram Bot API to get real Bot Name and Username
  try {
    const meRes = await fetch(`https://api.telegram.org/bot${successToken}/getMe`, { signal: AbortSignal.timeout(5000) });
    if (meRes.ok) {
      const meData: any = await meRes.json();
      if (meData?.ok && meData?.result) {
        if (meData.result.username) verifiedUsername = meData.result.username;
        if (meData.result.first_name) verifiedName = meData.result.first_name;
        logWorker(`✅ Verified live Telegram bot: "${verifiedName}" (@${verifiedUsername})`);
      }
    }
  } catch {}

  return { token: successToken, username: verifiedUsername, name: verifiedName, botId };
}

// Independent background worker for a single Telegram account
async function runBotGeneratorWorker(
  phone: string,
  targetCount: number,
  namePrefix: string,
  usernamePrefix: string,
  delaySec: number,
  abortSignal: AbortSignal
): Promise<void> {
  const a = accounts.get(phone);
  const label = a?.label || phone;
  const owner = a?.owner || 'admin';

  let worker = generatorWorkerStates.get(phone);
  if (!worker) {
    worker = {
      phone,
      label,
      owner,
      status: 'connecting',
      currentStep: 'Initializing worker...',
      botsTarget: targetCount,
      botsCreated: 0,
      logs: []
    };
    generatorWorkerStates.set(phone, worker);
  } else {
    worker.status = 'connecting';
    worker.currentStep = 'Initializing worker...';
    worker.botsTarget = targetCount;
    worker.botsCreated = 0;
    worker.errorMsg = undefined;
    worker.logs.push(`[${formatISTDateTime()}] Restarting worker for ${label} (${phone})`);
  }

  const logWorker = (msg: string) => {
    const ts = formatISTDateTime();
    const line = `[${ts}] ${msg}`;
    if (worker) {
      worker.logs.push(line);
      if (worker.logs.length > 200) worker.logs.shift();
    }
    console.log(`[BOT-GEN: ${label} (${phone})] ${msg}`);
  };

  let client: any = null;
  let isTempClient = false;

  try {
    logWorker(`Checking Telegram client connection for ${label} (${phone})...`);
    if (a?.client && a.running && a.client.connected) {
      client = a.client;
      logWorker(`Using existing active client session for ${label} (${phone})`);
    } else {
      const sess = await loadSessionString(phone);
      if (!sess) {
        throw new Error(`No saved Telegram session found for ${label} (${phone}). Please log in or start the account once first.`);
      }
      logWorker(`Connecting dedicated MTProto worker client for ${label} (${phone})...`);
      const deviceProf = getDeviceProfileForPhone(phone);
      client = new TelegramClient(new StringSession(sess), a!.api_id, a!.api_hash, {
        connectionRetries: 5,
        useWSS: false,
        timeout: 25,
        deviceModel: deviceProf.deviceModel,
        systemVersion: deviceProf.systemVersion,
        appVersion: 'Telegram Android 12.10.1',
        langCode: 'en',
        systemLangCode: 'en-US'
      });
      try {
        (client as any).setLogLevel('none');
      } catch {}
      client.onError = async (err: any) => {
        const msg = err?.message || String(err || '');
        if (/timeout|ETIMEDOUT|ESOCKETTIMEDOUT|ECONNRESET/i.test(msg)) return;
        logWorker(`Telegram client warning: ${msg.slice(0, 80)}`);
      };
      await client.connect();
      isTempClient = true;
      logWorker(`Connected successfully to Telegram.`);
    }

    const currentCount = getAccountBotsCount(phone);
    if (currentCount >= 20) {
      throw new Error(`Account already reached Telegram lifetime 20-bot limit (${currentCount}/20).`);
    }

    const maxAllowed = Math.min(targetCount, 20 - currentCount);
    worker.botsTarget = maxAllowed;

    for (let i = 0; i < maxAllowed; i++) {
      if (abortSignal.aborted) {
        worker.status = 'stopped';
        worker.currentStep = 'Stopped by user';
        logWorker(`Worker stopped by administrator request.`);
        break;
      }

      worker.status = 'creating';
      worker.currentStep = `Creating bot ${i + 1} of ${maxAllowed}...`;
      const botDisplayName = `${namePrefix || 'LeoBot'} ${label} #${currentCount + i + 1}`;
      logWorker(`▶ Starting creation cycle ${i + 1}/${maxAllowed} ("${botDisplayName}")...`);

      let createdBot: any = null;
      try {
        createdBot = await executeBotFatherNewBot(client, botDisplayName, usernamePrefix || 'leobot', phone, logWorker);
      } catch (genErr: any) {
        const errMsg = String(genErr?.message || genErr);
        const isFloodWait = errMsg.includes('FLOOD_WAIT') || errMsg.includes('FloodWaitError') || genErr?.seconds;

        if (isFloodWait) {
          const waitSeconds = genErr?.seconds || 45;
          worker.status = 'floodwait';
          worker.floodWaitSeconds = waitSeconds;
          worker.floodWaitUntil = Date.now() + waitSeconds * 1000;
          worker.currentStep = `FloodWait: cooling down ${waitSeconds}s...`;
          logWorker(`⏳ FloodWait encountered: pausing worker for ${waitSeconds}s. Other accounts will continue running in parallel...`);
          
          let waited = 0;
          while (waited < waitSeconds && !abortSignal.aborted) {
            await new Promise(r => setTimeout(r, 1000));
            waited++;
          }
          if (abortSignal.aborted) break;

          // Retry this index after cooldown
          logWorker(`Resuming after FloodWait cooldown...`);
          i--;
          continue;
        } else if (errMsg.includes('Quota Exceeded') || errMsg.includes('20-bot limit')) {
          logWorker(`🔒 ${label} (${phone}) has reached the 20-bot limit on @BotFather.`);
          worker.errorMsg = '20-bot Telegram limit reached';
          break;
        } else {
          logWorker(`❌ Error on bot ${i + 1}: ${errMsg}`);
          worker.errorMsg = errMsg;
          if (errMsg.includes('AUTH_KEY_UNREGISTERED') || errMsg.includes('SESSION_REVOKED')) {
            throw genErr;
          }
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }
      }

      if (createdBot && createdBot.token) {
        const cleanUname = (createdBot.username || '').replace(/^@/, '');
        const newRecord: VaultBotRecord = {
          id: `bot_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: createdBot.name,
          bot_name: createdBot.name,
          username: cleanUname,
          bot_username: cleanUname,
          token: createdBot.token,
          creator_phone: phone,
          creator_label: label,
          creator_owner: owner,
          created_at: new Date().toISOString(),
          created_at_formatted: formatISTDateTime(),
          status: 'active',
          bot_id: createdBot.botId
        };

        botsVault.unshift(newRecord);
        saveBotsVault();
        worker.botsCreated++;
        logWorker(`✅ [VAULT STORED] Bot @${cleanUname} saved to bots_vault.json! Total in vault for ${label} (${phone}): ${getAccountBotsCount(phone)}/20`);
      }

      // Rest between bot creations per worker
      if (i < maxAllowed - 1 && !abortSignal.aborted) {
        const jitter = Math.floor(Math.random() * 3);
        const restSec = Math.max(4, delaySec + jitter);
        worker.currentStep = `Waiting ${restSec}s before next bot...`;
        logWorker(`Resting ${restSec}s before creating next bot...`);
        for (let s = 0; s < restSec && !abortSignal.aborted; s++) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    if (!abortSignal.aborted && worker.status !== 'stopped') {
      worker.status = 'completed';
      worker.currentStep = `Completed! Generated ${worker.botsCreated} bot(s).`;
      logWorker(`🏁 Worker finished. Total generated in this batch: ${worker.botsCreated}.`);
    }
  } catch (err: any) {
    const errMsg = String(err?.message || err);
    logWorker(`❌ Worker stopped with error: ${errMsg}`);
    worker.status = 'error';
    worker.errorMsg = errMsg;
    worker.currentStep = `Error: ${errMsg.slice(0, 50)}`;
  } finally {
    if (isTempClient && client) {
      try {
        await client.disconnect();
      } catch {}
    }
    generatorAbortControllers.delete(phone);
  }
}

