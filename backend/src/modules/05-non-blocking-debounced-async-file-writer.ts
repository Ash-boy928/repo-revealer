// ---------------- NON-BLOCKING DEBOUNCED ASYNC FILE WRITER ----------------
import {
  asyncSaveJson,
  flushPendingFileWritesSync,
  fileWriteDebounceMap
} from './src/utils/fileWriter.ts';


// ==================== UNIVERSAL AI ENGINE & SWITCHING ARCHITECTURE ====================
import {
  globalAiConfig,
  loadGlobalAiConfigLocal,
  saveGlobalAiConfigLocal,
  loadGlobalAiConfig,
  saveGlobalAiConfig,
  callAiEngine,
  type GlobalAiConfig
} from './src/services/aiEngine.ts';

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

