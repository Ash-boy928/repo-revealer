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

