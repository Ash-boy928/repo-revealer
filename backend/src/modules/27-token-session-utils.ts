// ---------------- TOKEN & SESSION UTILS ----------------
function createToken(username        , role        )         {
  const payload = JSON.stringify({
    username,
    role,
    exp: Date.now() + 7 * 24 * 3600 * 1000
  });
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', secretKey).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function verifyToken(token        )                                            {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', secretKey).update(b64).digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf-8'));
    if (payload.exp && payload.exp < Date.now()) return null;
    return { username: payload.username, role: payload.role };
  } catch {
    return null;
  }
}

function getSessionUser(req         )                                            {
  let found                                            = null;
  // 1. Check Authorization header: Bearer <token>
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    found = verifyToken(token);
  }
  // 2. Check query parameter ?token=
  if (!found && typeof req.query.token === 'string' && req.query.token) {
    found = verifyToken(req.query.token);
  }
  // 3. Check custom header x-telebot-token
  if (!found) {
    const xToken = req.headers['x-telebot-token']          ;
    if (xToken) found = verifyToken(xToken);
  }
  // 4. Check cookie session
  if (!found && req.session?.username) {
    found = {
      username: req.session.username          ,
      role: (req.session.role          ) || 'user'
    };
  }

  if (found) {
    const u = getUser(found.username);
    if (!u || !u.active) return null;
    if (found.role !== 'admin' && u.expiry_date) {
      const today = new Date().toISOString().split('T')[0];
      if (today > u.expiry_date) return null;
    }
  }

  return found;
}

// Helper for session
function getEffectiveUser(req         )         {
  const user = getSessionUser(req);
  const va = (req.headers['x-view-as']          ) || (req.query.view_as          ) || (req.session?.view_as          );
  if (va && user?.role === 'admin') {
    return va;
  }
  return user?.username || '';
}

function isAdminSession(req         )          {
  const user = getSessionUser(req);
  if (!user) return false;
  const u = getUser(user.username);
  return Boolean(u && u.role === 'admin');
}

function canTouch(req         , owner        )          {
  if (isAdminSession(req)) return true;
  return owner === getEffectiveUser(req);
}

// Auth guard middleware
app.use((req         , res          , next              ) => {
  if (
    req.path === '/' ||
    req.path === '/login' ||
    req.path === '/api/login' ||
    req.path === '/api/health' ||
    req.path === '/health' ||
    req.path === '/api/system/theme' ||
    req.path === '/whoami' ||
    req.path === '/api/tma/auth' ||
    req.path === '/api/tma/status' ||
    req.path === '/logout' ||
    req.path === '/prd' ||
    req.path === '/prd.html' ||
    req.path === '/PRD.md' ||
    req.path === '/mobile-demo' ||
    req.path === '/mobile-demo.html' ||
    req.path === '/manifest.json' ||
    req.path === '/sw.js' ||
    req.path === '/favicon.ico' ||
    req.path.startsWith('/icons/') ||
    req.path.startsWith('/api/download/prd') ||
    req.path.startsWith('/api/download/flutter-app') ||
    req.path === '/telebot_flutter.tar.gz' ||
    req.path.startsWith('/api/forgot') ||
    req.path.startsWith('/api/public/') ||
    req.path === '/api/system/theme' ||
    req.path.startsWith('/api/system/theme') ||
    req.path.startsWith('/api/telegram-webhook') ||
    req.path === '/login.html' ||
    req.path === '/landing' ||
    req.path === '/landing.html' ||
    req.path === '/index.html'
  ) {
    return next();
  }

  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ msg: 'Unauthorized. Please login.' });
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    return res.redirect('/login?expired=1');
  }

  const u = getUser(sessionUser.username);
  if (!u || !u.active) {
    if (req.session) {
      req.session.username = null;
      req.session.role = null;
      req.session.view_as = null;
    }
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ msg: 'Unauthorized. Account is disabled or does not exist.' });
    }
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    return res.redirect('/login?expired=1');
  }

  if (u.role !== 'admin' && u.expiry_date) {
    const todayStr = getTodayDateString();
    if (todayStr > u.expiry_date) {
      u.active = false;
      saveUsers();
      if (req.session) {
        req.session.username = null;
        req.session.role = null;
        req.session.view_as = null;
      }
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ msg: `Your account expired on ${u.expiry_date} and has been terminated/disabled. Please contact administrator to renew.` });
      }
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      return res.redirect('/login?expired=1');
    }
  }

  if (req.session) {
    req.session.username = u.username;
    req.session.role = u.role;
  }

  const va = (req.headers['x-view-as']          ) || (req.query.view_as          ) || (req.session?.view_as          );
  if (va && u.role === 'admin') {
    const vu = getUser(va);
    if (vu && vu.active) {
      if (req.session) req.session.view_as = va;
    } else if (req.session) {
      req.session.view_as = null;
    }
  }

  if (req.path === '/admin' || req.path.startsWith('/api/admin')) {
    if (u.role !== 'admin') {
      if (req.path.startsWith('/api/')) {
        return res.status(403).json({ msg: 'Admin access required' });
      }
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      return res.redirect('/login?expired=1');
    }
  }

  next();
});

