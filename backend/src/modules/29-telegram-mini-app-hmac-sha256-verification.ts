// ---------------- TELEGRAM MINI APP (TMA) HMAC-SHA256 VERIFICATION ----------------
function verifyTelegramWebAppData(initData: string, botToken: string): { isValid: boolean; user?: any; authDate?: number } {
  if (!initData || !botToken) return { isValid: false };
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return { isValid: false };

    // Remove hash parameter before calculating data_check_string
    params.delete('hash');

    // Sort parameters alphabetically: key=value\nkey2=value2...
    const keys = Array.from(params.keys()).sort();
    const dataCheckArr: string[] = [];
    for (const key of keys) {
      dataCheckArr.push(`${key}=${params.get(key)}`);
    }
    const dataCheckString = dataCheckArr.join('\n');

    // Secret key = HMAC_SHA256("WebAppData", botToken)
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken.trim()).digest();

    // Signature = HMAC_SHA256(secretKey, dataCheckString).hex()
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    const calculatedBuffer = Buffer.from(calculatedHash, 'utf8');
    const hashBuffer = Buffer.from(hash, 'utf8');

    if (calculatedBuffer.length !== hashBuffer.length) {
      return { isValid: false };
    }

    if (!crypto.timingSafeEqual(calculatedBuffer, hashBuffer)) {
      return { isValid: false };
    }

    const userStr = params.get('user');
    const authDateStr = params.get('auth_date');
    const authDate = authDateStr ? parseInt(authDateStr, 10) : undefined;
    let userObj: any = null;
    if (userStr) {
      try {
        userObj = JSON.parse(userStr);
      } catch {}
    }

    return { isValid: true, user: userObj, authDate };
  } catch (err) {
    return { isValid: false };
  }
}

