// ---------------- SECURITY HARDENING SUITE ----------------
import {
  enforceSecureFilePermissions,
  checkLoginBruteForce,
  recordFailedLoginAttempt,
  recordSuccessfulLogin,
  getClientIp
} from './src/security/securityGuard.ts';

// Auto-enforce Linux file permissions on startup (chmod 600 on DB & Secret Key)
enforceSecureFilePermissions();

// 🛡️ CRITICAL PROCESS CRASH SHIELDS (Prevents unexpected VPS / PM2 restarts on transient errors)
process.on('uncaughtException', (err: any) => {
  const errMsg = err?.message || String(err || '');
  console.error('🛡️ [CRASH SHIELD] Uncaught Exception caught (prevented process exit):', errMsg);
  if (/ECONNRESET|ETIMEDOUT|EPIPE|ESOCKETTIMEDOUT|Connection closed/i.test(errMsg)) {
    return;
  }
  if (err?.stack) {
    console.error(err.stack.split('\n').slice(0, 3).join('\n'));
  }
});

process.on('unhandledRejection', (reason: any) => {
  const reasonMsg = reason?.message || String(reason || '');
  console.error('🛡️ [CRASH SHIELD] Unhandled Promise Rejection caught (prevented process exit):', reasonMsg);
});

