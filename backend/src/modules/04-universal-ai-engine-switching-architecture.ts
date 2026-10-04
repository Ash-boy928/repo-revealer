// ==================== UNIVERSAL AI ENGINE & SWITCHING ARCHITECTURE ====================
interface GlobalAiConfig {
  // Node.js Strict Filtering Rules
  nodejs_filter_enabled?: boolean;
  reject_usernames?: boolean;
  allow_no_photo_no_username?: boolean;
  reject_premium?: boolean;
  reject_admins?: boolean;
  reject_bots?: boolean;
  reject_deleted?: boolean;
  reject_scam_keywords?: boolean;
  channel_lock_early?: boolean;

  filter_provider: "gemini" | "openai" | "deepseek" | "groq" | "custom_openai";
  filter_model: string;
  filter_api_key?: string;
  filter_api_url?: string;
  filter_enabled: boolean;
  filter_mode: "smart_keyword" | "batch_ai" | "strict_ai";
  filter_persona: string;
  filter_strictness: "moderate" | "strict" | "aggressive";
  custom_reject_keywords: string[];
  custom_allow_keywords: string[];

  dm_enabled?: boolean;
  dm_provider: "gemini" | "openai" | "deepseek" | "groq" | "custom_openai";
  dm_model: string;
  dm_api_key?: string;
  dm_api_url?: string;
  dm_system_prompt: string;
}

const GLOBAL_AI_CONFIG_FILE = path.join(__dirname, "global_ai_config.json");

let globalAiConfig: GlobalAiConfig = {
  nodejs_filter_enabled: true,
  reject_usernames: false,
  allow_no_photo_no_username: true,
  reject_premium: true,
  reject_admins: true,
  reject_bots: true,
  reject_deleted: true,
  reject_scam_keywords: true,
  channel_lock_early: true,
  custom_reject_keywords: [
    "trader",
    "agent",
    "sub-agent",
    "broker",
    "trading",
    "Color prediction",
    "Colour trading",
    "Big Small",
    "BigSmall",
    "Deposit",
    "Daman",
    "91club",
    "BDG game",
    "Tiranga",
    "Aviator",
    "Satta",
    "VIP signal",
    "Loss cover",
    "Earning app",
    "Join my channel",
    "t.me/",
    "wa.me/"
  ],
  custom_allow_keywords: [],

  filter_provider: "groq",
  filter_model: "llama-3.1-8b-instant",
  filter_api_key: "",
  filter_api_url: "",
  filter_enabled: false,
  filter_mode: "smart_keyword",
  filter_persona: "You are an intelligent Telegram profile auditor. Strictly identify and REJECT profiles involved in trading signals, color prediction, big small game, betting, casinos, gambling, telegram channel promotional spam. Only APPROVE genuine normal human users.",
  filter_strictness: "strict",

  dm_enabled: true,
  dm_provider: "groq",
  dm_model: "llama-3.1-8b-instant",
  dm_api_key: "",
  dm_api_url: "",
  dm_system_prompt: "You are a casual human user reaching out on Telegram. Write a natural, personalized 1-2 sentence message in friendly Hinglish (or casual English) based on the context. Include the channel link naturally. Keep it very short, human, no bot preamble, no quotation marks."
};

function loadGlobalAiConfigLocal(): void {
  try {
    if (fs.existsSync(GLOBAL_AI_CONFIG_FILE)) {
      const raw = fs.readFileSync(GLOBAL_AI_CONFIG_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        globalAiConfig = { ...globalAiConfig, ...parsed };
      }
    }
    // Auto-migrate legacy, invalid, or low-quota models
    if (!globalAiConfig.filter_model || globalAiConfig.filter_model === "gemini-3.6-flash" || globalAiConfig.filter_model === "gemini-3.8-flash") {
      globalAiConfig.filter_model = "gemini-3.1-flash-lite";
    } else if (globalAiConfig.filter_model.includes("allam")) {
      globalAiConfig.filter_model = "llama-3.3-70b-versatile";
    }
    if (!globalAiConfig.dm_model || globalAiConfig.dm_model === "gemini-3.6-flash" || globalAiConfig.dm_model === "gemini-3.8-flash") {
      globalAiConfig.dm_model = "gemini-3.1-flash-lite";
    } else if (globalAiConfig.dm_model.includes("allam")) {
      globalAiConfig.dm_model = "llama-3.3-70b-versatile";
    }
  } catch (err) {
    console.error("Error loading global_ai_config.json:", err);
  }
}

function saveGlobalAiConfigLocal(): void {
  try {
    fs.writeFileSync(GLOBAL_AI_CONFIG_FILE, JSON.stringify(globalAiConfig, null, 2), "utf8");
  } catch (err) {
    console.error("Error saving global_ai_config.json:", err);
  }
}

async function loadGlobalAiConfig(): Promise<void> {
  loadGlobalAiConfigLocal();
}

function saveGlobalAiConfig(): void {
  saveGlobalAiConfigLocal();
}

loadGlobalAiConfigLocal();

// Universal AI Caller (Gemini, OpenAI, DeepSeek, Groq, Custom OpenAI-Compatible)
async function callAiEngine(params: {
  task: "filtering" | "dm";
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  jsonResponse?: boolean;
}): Promise<string> {
  const isFilter = params.task === "filtering";
  const provider = isFilter ? globalAiConfig.filter_provider : globalAiConfig.dm_provider;
  const model = isFilter ? globalAiConfig.filter_model : globalAiConfig.dm_model;
  
  // Smart key inheritance: if DM key is empty, automatically reuse Filter key if available
  let customKey = isFilter ? globalAiConfig.filter_api_key : globalAiConfig.dm_api_key;
  if (!customKey && !isFilter && globalAiConfig.filter_api_key) {
    customKey = globalAiConfig.filter_api_key;
  } else if (!customKey && isFilter && globalAiConfig.dm_api_key) {
    customKey = globalAiConfig.dm_api_key;
  }
  const customUrl = isFilter ? globalAiConfig.filter_api_url : (globalAiConfig.dm_api_url || (globalAiConfig.dm_provider === globalAiConfig.filter_provider ? globalAiConfig.filter_api_url : ""));

  if (provider === "gemini") {
    const rawKey = (customKey && customKey.trim()) || 
                   (globalAiConfig.filter_api_key && globalAiConfig.filter_api_key.trim()) || 
                   (globalAiConfig.dm_api_key && globalAiConfig.dm_api_key.trim()) || 
                   process.env.GEMINI_API_KEY || "";
    // Support multi-key rotation: user can paste multiple keys separated by commas or newlines
    const apiKeys = rawKey.split(/[\n,;]+/).map((k: string) => k.trim()).filter(Boolean);
    if (apiKeys.length === 0) {
      throw new Error("Gemini API Key is not configured! Please enter your Gemini API Key in the Admin AI Engine settings.");
    }

    // Default to ultra-fast, high free-tier quota model gemini-3.1-flash-lite
    let requestedModel = model && model.trim() ? model.trim() : "gemini-3.1-flash-lite";
    if (requestedModel === "gemini-3.6-flash" || requestedModel === "gemini-3.8-flash") {
      requestedModel = "gemini-3.1-flash-lite";
    }

    // Fallback chain in case of temporary Google 503 demand spikes or quota exhaustion
    // Note: Do NOT include gemini-3.8-flash here because free tier restricts it to only 20 requests per day!
    const fallbackModels = [
      requestedModel,
      "gemini-3.1-flash-lite",
      "gemini-flash-lite-latest",
      "gemini-3.5-flash-lite",
      "gemini-flash-latest"
    ];
    const modelsToTry = Array.from(new Set(fallbackModels));

    const config: any = {
      temperature: params.temperature ?? 0.3
    };
    if (params.systemInstruction) {
      config.systemInstruction = params.systemInstruction;
    }
    if (params.jsonResponse) {
      config.responseMimeType = "application/json";
    }

    let lastErr: any = null;
    // Iterate through API keys in pool if quota is exhausted on one key
    for (let kIdx = 0; kIdx < apiKeys.length; kIdx++) {
      const currentApiKey = apiKeys[kIdx];
      const ai = new GoogleGenAI({
        apiKey: currentApiKey,
        httpOptions: { headers: { "User-Agent": "aistudio-build" } }
      });

      for (const m of modelsToTry) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const response = await ai.models.generateContent({
              model: m,
              contents: params.prompt,
              config
            });
            const text = (response.text || "").trim();
            if (text) {
              (callAiEngine as any).lastSuccessfulModel = m;
              (callAiEngine as any).lastSuccessfulKeyIndex = kIdx;
              return text;
            }
          } catch (err: any) {
            lastErr = err;
            const msg = err?.message || String(err);
            // If permanent credential error on this key, try next key in pool
            if (msg.includes("API key not valid") || msg.includes("PERMISSION_DENIED") || msg.includes("API_KEY_INVALID")) {
              console.warn(`[AI ENGINE] Key ${kIdx + 1}/${apiKeys.length} invalid. Trying next key if available...`);
              break; // breaks out to next key
            }
            // If quota exhausted (429 / RESOURCE_EXHAUSTED), try next model or next key in pool
            if (msg.includes("RESOURCE_EXHAUSTED") || msg.includes("Quota exceeded") || msg.includes("quota") || msg.includes("429")) {
              console.warn(`[AI ENGINE] Model ${m} quota limit reached. Trying next model/key in pool...`);
              break;
            }
            // If temporary 503 high demand or UNAVAILABLE, wait slightly and retry
            if (msg.includes("503") || msg.includes("high demand") || msg.includes("UNAVAILABLE")) {
              await new Promise((r) => setTimeout(r, 400));
              continue;
            }
            // If model not found (404) or internal (500), try next model
            break;
          }
        }
      }
    }
    throw new Error(lastErr?.message || "Gemini API call failed after trying available models.");
  }

  // OpenAI / DeepSeek / Groq / OpenAI-compatible endpoint
  let defaultBaseUrl = "https://api.openai.com/v1";
  let defaultEnvKey = process.env.OPENAI_API_KEY || "";

  if (provider === "deepseek") {
    defaultBaseUrl = "https://api.deepseek.com";
    defaultEnvKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || "";
  } else if (provider === "groq") {
    defaultBaseUrl = "https://api.groq.com/openai/v1";
    defaultEnvKey = process.env.GROQ_API_KEY || "";
  }

  const effectiveBaseUrl = (customUrl && customUrl.trim()) ? customUrl.trim().replace(/\/+$/, "") : defaultBaseUrl;
  const rawKey = (customKey && customKey.trim()) || defaultEnvKey;
  const keyPool = rawKey.split(/[\n,;]+/).map((k: string) => k.trim()).filter(Boolean);

  if (keyPool.length === 0) {
    throw new Error(`API Key for ${provider.toUpperCase()} is not configured!`);
  }

  const messages: any[] = [];
  if (params.systemInstruction) {
    messages.push({ role: "system", content: params.systemInstruction });
  }
  messages.push({ role: "user", content: params.prompt });

  let primaryModel = (model && model.trim()) || (provider === "deepseek" ? "deepseek-chat" : provider === "groq" ? "llama-3.3-70b-versatile" : "gpt-4o-mini");
  // Never allow low-TPM Arabic allam model on Groq
  if (provider === "groq" && (primaryModel.includes("allam") || !primaryModel)) {
    primaryModel = "llama-3.3-70b-versatile";
  }
  
  // Model fallback candidate list for Groq in case of rate limit (429), model_not_found (404), decommissioned (400)
  const candidateModels = provider === "groq" 
    ? Array.from(new Set([primaryModel, "llama-3.3-70b-versatile", "llama-3.1-8b-instant", "gemma2-9b-it", "qwen-2.5-32b", "deepseek-r1-distill-llama-70b"]))
    : [primaryModel];

  let lastOpenAiErr: any = null;

  for (let kIdx = 0; kIdx < keyPool.length; kIdx++) {
    const currentKey = keyPool[kIdx];

    for (const m of candidateModels) {
      const body: any = {
        model: m,
        messages,
        temperature: params.temperature ?? 0.3
      };

      if (params.jsonResponse) {
        body.response_format = { type: "json_object" };
      }

      try {
        const res = await fetch(`${effectiveBaseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${currentKey}`
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(25000)
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          const isRecoverable = res.status === 404 || 
                                res.status === 429 || 
                                res.status === 503 ||
                                (res.status === 400 && (errText.includes("decommissioned") || errText.includes("deprecated") || errText.includes("does not exist") || errText.includes("model_not_found") || errText.includes("not supported"))) ||
                                errText.includes("model_not_found") || 
                                errText.includes("does not exist") ||
                                errText.includes("Rate limit reached") ||
                                errText.includes("tokens per minute") ||
                                errText.includes("TPM");
          
          // If rate limit or model issue, try next candidate model
          if (isRecoverable && candidateModels.indexOf(m) < candidateModels.length - 1) {
            console.warn(`[AI ENGINE] ${provider.toUpperCase()} model ${m} returned ${res.status}. Trying next model...`);
            lastOpenAiErr = new Error(`${provider.toUpperCase()} API error (${res.status}): ${errText.slice(0, 200)}`);
            continue;
          }
          throw new Error(`${provider.toUpperCase()} API error (${res.status}): ${errText.slice(0, 200)}`);
        }

        const data = await res.json();
        const choiceText = data?.choices?.[0]?.message?.content || "";
        if (choiceText.trim()) {
          (callAiEngine as any).lastSuccessfulModel = m;
          (callAiEngine as any).lastSuccessfulKeyIndex = kIdx;
          return choiceText.trim();
        }
      } catch (err: any) {
        lastOpenAiErr = err;
        const errMsg = String(err?.message || "");
        if (errMsg.includes("model_not_found") || errMsg.includes("404") || errMsg.includes("decommissioned") || errMsg.includes("deprecated") || errMsg.includes("429") || errMsg.includes("Rate limit")) {
          continue;
        }
        throw err;
      }
    }
  }

  throw lastOpenAiErr || new Error(`${provider.toUpperCase()} API call failed after trying available models.`);
}

// BATCH AI PROFILE ANALYZER (Idea 2 & 4)
interface BatchUserAnalysisInput {
  uid: number;
  firstName?: string;
  lastName?: string;
  username?: string;
  phone?: string;
  about?: string;
}

interface BatchUserAnalysisResult {
  uid: number;
  status: "APPROVED" | "REJECTED";
  reason: string;
  category?: string;
  confidence?: number;
}

async function analyzeTelegramUsersBatch(
  users: BatchUserAnalysisInput[]
): Promise<Map<number, BatchUserAnalysisResult>> {
  const results = new Map<number, BatchUserAnalysisResult>();
  if (!users || users.length === 0) return results;

  // 1. Fast local check (custom keywords, deleted account, obvious spam keywords)
  const usersNeedingAi: BatchUserAnalysisInput[] = [];

  for (const u of users) {
    const nameStr = [u.firstName, u.lastName].filter(Boolean).join(" ");
    const textAll = [nameStr, u.username, u.about].filter(Boolean).join(" ").toLowerCase();

    // Check custom allow keywords first
    if (globalAiConfig.custom_allow_keywords?.length > 0) {
      const matchedAllow = globalAiConfig.custom_allow_keywords.find((k) => k && textAll.includes(k.toLowerCase().trim()));
      if (matchedAllow) {
        results.set(u.uid, {
          uid: u.uid,
          status: "APPROVED",
          reason: `Matched custom whitelist keyword "${matchedAllow}"`,
          category: "whitelisted"
        });
        continue;
      }
    }

    // Check custom reject keywords
    if (globalAiConfig.custom_reject_keywords?.length > 0) {
      const matchedReject = globalAiConfig.custom_reject_keywords.find((k) => k && textAll.includes(k.toLowerCase().trim()));
      if (matchedReject) {
        results.set(u.uid, {
          uid: u.uid,
          status: "REJECTED",
          reason: `Matched custom reject keyword "${matchedReject}"`,
          category: "custom_rule"
        });
        continue;
      }
    }

    // Check standard spam keyword rules
    const quickCheck = isTelegramUserSpamOrPromo({ firstName: u.firstName, lastName: u.lastName, username: u.username, about: u.about });
    if (quickCheck.isSpam) {
      results.set(u.uid, {
        uid: u.uid,
        status: "REJECTED",
        reason: quickCheck.reason,
        category: "spam_bio"
      });
      continue;
    }

    if (!globalAiConfig.filter_enabled || globalAiConfig.filter_mode === "smart_keyword") {
      // If AI filter is disabled or in pure keyword mode, approve immediately
      results.set(u.uid, {
        uid: u.uid,
        status: "APPROVED",
        reason: "Clean profile (Passed keyword inspection)",
        category: "clean"
      });
    } else {
      usersNeedingAi.push(u);
    }
  }

  if (usersNeedingAi.length === 0) {
    return results;
  }

  // 2. Process remaining users with Universal Batch AI
  const batchSize = 15;
  for (let i = 0; i < usersNeedingAi.length; i += batchSize) {
    const slice = usersNeedingAi.slice(i, i + batchSize);
    try {
      const profilesPayload = slice.map((u, idx) => ({
        id: u.uid,
        index: idx + 1,
        name: [u.firstName, u.lastName].filter(Boolean).join(" ") || "N/A",
        username: u.username ? `@${u.username.replace(/^@/, "")}` : "None",
        bio_about: u.about || "None"
      }));

      const systemPrompt = `${globalAiConfig.filter_persona || "You are an expert Telegram spam and lead auditor."}
Filter Strictness: ${globalAiConfig.filter_strictness.toUpperCase()}.
Task: Analyze each Telegram profile. Determine if it is a genuine normal user (APPROVED) or a spammer / scammer / promoter / trader / betting channel (REJECTED).
Output MUST be a valid JSON object with the following schema:
{
  "results": [
    {
      "id": <user_id_as_number>,
      "status": "APPROVED" or "REJECTED",
      "reason": "<short 4-8 word reason in English>",
      "category": "clean" or "trading" or "channel_promo" or "betting_casino" or "explicit_18" or "bot_fake" or "other_spam"
    }
  ]
}`;

      const promptText = `Analyze this batch of ${slice.length} Telegram profiles and return approval verdicts:
${JSON.stringify(profilesPayload, null, 2)}`;

      const rawAiResponse = await callAiEngine({
        task: "filtering",
        prompt: promptText,
        systemInstruction: systemPrompt,
        temperature: 0.1,
        jsonResponse: true
      });

      let parsed: any = null;
      try {
        const cleaned = rawAiResponse.replace(/^\s*```json/i, "").replace(/```\s*$/i, "").trim();
        parsed = JSON.parse(cleaned);
      } catch {
        const jsonMatch = rawAiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      }

      const resList = Array.isArray(parsed?.results) ? parsed.results : (Array.isArray(parsed) ? parsed : []);
      const parsedMap = new Map<number, any>();
      for (const item of resList) {
        const itemId = item?.id ?? item?.uid ?? item?.userId;
        if (itemId !== undefined && itemId !== null) parsedMap.set(Number(itemId), item);
      }

      for (let idx = 0; idx < slice.length; idx++) {
        const u = slice[idx];
        let aiItem = parsedMap.get(u.uid);
        if (!aiItem && slice.length === 1 && resList.length > 0) {
          aiItem = resList[0];
        }
        if (!aiItem && resList.find((r: any) => r?.index === idx + 1)) {
          aiItem = resList.find((r: any) => r?.index === idx + 1);
        }

        if (aiItem) {
          const isApproved = String(aiItem.status).toUpperCase() === "APPROVED";
          results.set(u.uid, {
            uid: u.uid,
            status: isApproved ? "APPROVED" : "REJECTED",
            reason: aiItem.reason || (isApproved ? "AI Approved (Genuine User)" : "AI Rejected (Spam/Promo detected)"),
            category: aiItem.category || (isApproved ? "clean" : "spam_bio")
          });
        } else {
          // Fallback safe approval if single profile was omitted by AI
          results.set(u.uid, {
            uid: u.uid,
            status: "APPROVED",
            reason: "Passed initial check (AI fallback)",
            category: "clean"
          });
        }
      }
    } catch (aiErr: any) {
      const errMsg = aiErr?.message || String(aiErr);
      console.warn("[BATCH AI FILTER ERROR]:", errMsg);
      // For real batch pipeline: don't block pipeline on API error, approve with fallback tag
      // For test bench (uid 999999999): surface the exact error to the tester
      for (const u of slice) {
        if (u.uid === 999999999) {
          results.set(u.uid, {
            uid: u.uid,
            status: "REJECTED",
            reason: `AI Call Error: ${errMsg}`,
            category: "error"
          });
        } else {
          results.set(u.uid, {
            uid: u.uid,
            status: "APPROVED",
            reason: "Approved (AI Provider unreachable / Fallback)",
            category: "clean"
          });
        }
      }
    }
  }

  return results;
}

