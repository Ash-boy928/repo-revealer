// ---------------- ROUTES ----------------
app.get(['/api/health', '/health'], (req, res) => {
  res.json({ ok: true, status: 'healthy', uptime: Math.round(process.uptime()), timestamp: Date.now() });
});

app.get('/', (req, res) => {
  sendInjectedHtml(path.join(__dirname, 'index.html'), res);
});

app.get('/index.html', (req, res) => {
  sendInjectedHtml(path.join(__dirname, 'index.html'), res);
});

app.get('/login', (req         , res          ) => {
  sendInjectedHtml(path.join(__dirname, 'login.html'), res);
});

app.get('/landing', (req         , res          ) => {
  res.sendFile(path.join(__dirname, 'landing.html'));
});

app.get('/landing.html', (req         , res          ) => {
  res.sendFile(path.join(__dirname, 'landing.html'));
});

app.get('/dashboard', (req         , res          ) => {
  sendInjectedHtml(path.join(__dirname, 'dashboard.html'), res);
});

app.get('/mobile-demo', (req: any, res: any) => {
  res.sendFile(path.join(__dirname, 'mobile-demo.html'));
});

app.get('/mobile-demo.html', (req: any, res: any) => {
  res.sendFile(path.join(__dirname, 'mobile-demo.html'));
});

app.get('/prd', (req         , res          ) => {
  res.sendFile(path.join(__dirname, 'prd.html'));
});

app.get('/prd.html', (req         , res          ) => {
  res.sendFile(path.join(__dirname, 'prd.html'));
});

app.get('/PRD.md', (req         , res          ) => {
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="Leo_TeleGm_Bot_PRD.md"');
  res.sendFile(path.join(__dirname, 'PRD.md'));
});

app.get('/api/download/prd-doc', (req         , res          ) => {
  const prdPath = path.join(__dirname, 'prd.html');
  if (fs.existsSync(prdPath)) {
    res.setHeader('Content-Type', 'application/msword');
    res.setHeader('Content-Disposition', 'attachment; filename="Leo_TeleGm_Bot_PRD.doc"');
    return res.sendFile(prdPath);
  }
  res.status(404).send('PRD not found');
});

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req         , res          ) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/logout', (req         , res          ) => {
  if (req.session) {
    req.session.username = null;
    req.session.role = null;
    req.session.view_as = null;
  }
  res.redirect('/login');
});

app.get('/whoami', (req         , res          ) => {
  const sessionUser = getSessionUser(req);
  const va = (req.headers['x-view-as']          ) || (req.query.view_as          ) || (req.session?.view_as          ) || '';
  res.json({
    username: sessionUser?.username || '',
    view_as: va,
    role: sessionUser?.role || 'user'
  });
});

app.get('/back-to-admin', (req         , res          ) => {
  if (req.session) {
    req.session.view_as = null;
  }
  res.redirect('/admin');
});

// POST /login & /api/login
const handleAuthLogin = (req         , res          ) => {
  try {
    const { username, password } = req.body || {};
    const uname = (username || '').trim();
    const pwd = (password || '').trim();
    const now = Date.now();

    if (!uname || !pwd) {
      return res.status(400).json({ ok: false, msg: 'Please provide both username and password' });
    }

    const isExplicitAdmin = uname.toLowerCase() === 'admin';

    if (!isExplicitAdmin) {
      const att = loginAttempts.get(uname) || { count: 0, until: 0 };
      if (att.until > now) {
        const wait = Math.ceil((att.until - now) / 1000);
        return res.status(429).json({ ok: false, msg: `Too many failed attempts! Try again in ${wait} seconds.` });
      }
    } else {
      // Clear any lockout for admin
      loginAttempts.delete(uname);
    }

    const u = getUser(uname);
    let isValid = false;

    if (u) {
      if (verifyVal(u.password, pwd)) {
        isValid = true;
      }
    }

    if (!u || !isValid) {
      const clientIp = getClientIp(req);
      const lock = recordFailedLoginAttempt(clientIp);
      if (lock.locked) {
        return res.status(429).json({ ok: false, msg: `🛡️ Security Lockout: Too many failed login attempts. Temporarily blocked for ${lock.lockoutMins} minutes.` });
      }
      if (!isExplicitAdmin) {
        const att = loginAttempts.get(uname) || { count: 0, until: 0 };
        att.count = (att.count || 0) + 1;
        if (att.count >= MAX_ATTEMPTS) {
          att.count = 0;
          att.until = now + LOCK_SECONDS * 1000;
        }
        loginAttempts.set(uname, att);
      }
      return res.status(401).json({ ok: false, msg: `Wrong username or password! (${lock.remainingAttempts} attempts remaining)` });
    }

    loginAttempts.delete(uname);
    recordSuccessfulLogin(getClientIp(req));

    // Platform Authorization Check (Mobile App vs Web Browser)
    const rawPlat = (
      req.headers['x-client-platform'] ||
      req.body?.platform ||
      (/LeoTeleBot|okhttp|dart:io/i.test(req.headers['user-agent'] || '') ? 'android' : 'web')
    ).toString().toLowerCase();
    const isAppClient = rawPlat === 'android' || rawPlat === 'app' || rawPlat === 'mobile';
    const userAccessType = (u.access_type || 'both').toLowerCase();

    if (u.role !== 'admin') {
      if (isAppClient && userAccessType === 'web_only') {
        return res.status(403).json({
          ok: false,
          msg: '🚫 Access Denied: Yeh user account sirf Web Dashboard ke liye authorized hai (Mobile App not allowed). Please login from Web Browser or contact Admin.'
        });
      }
      if (!isAppClient && userAccessType === 'app_only') {
        return res.status(403).json({
          ok: false,
          msg: '🚫 Access Denied: Yeh user account sirf Mobile App ke liye authorized hai (Web Browser login not allowed). Please use LeoTeleBot Android App or contact Admin.'
        });
      }
    }

    // Record login platform telemetry
    (u as any).last_platform = isAppClient ? 'Mobile App' : 'Web Browser';
    (u as any).last_login = Date.now();
    saveUsers();

    if (u.role !== 'admin' && u.expiry_date) {
      const todayStr = getTodayDateString();
      if (todayStr > u.expiry_date) {
        u.active = false;
        saveUsers();
        return res.status(401).json({ ok: false, msg: `Your account expired on ${u.expiry_date} and has been disabled/terminated. Please contact administrator to renew.` });
      }
    }

    if (!u.active) {
      return res.status(401).json({ ok: false, msg: 'This account has been disabled/terminated by admin!' });
    }

    const token = createToken(u.username, u.role);

    if (req.session) {
      req.session.username = u.username;
      req.session.role = u.role;
    }

    return res.json({
      ok: true,
      msg: 'ok',
      role: u.role,
      username: u.username,
      token,
      redirect: u.role === 'admin' ? '/admin' : '/dashboard'
    });
  } catch (err: any) {
    console.error('Login route error:', err);
    return res.status(500).json({ ok: false, msg: 'Server error during authentication. Please retry.' });
  }
};

app.post('/login', checkLoginBruteForce, handleAuthLogin);
app.post('/api/login', checkLoginBruteForce, handleAuthLogin);

