// ---------------- APP SETUP ----------------
const app = express();
const secretKey = getSecretKey();

// Trust reverse proxy (nginx / cloud run) so secure cookies & protocol headers work
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  cookieSession({
    name: 'telebot_sess',
    keys: [secretKey],
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days session
    sameSite: 'lax', // 'lax' prevents cookie dropping on mobile browsers on HTTP & HTTPS
    secure: false, // allows mobile browsers to store cookie over plain VPS HTTP IP without silent drops
    httpOnly: true
  })
);

// Prevent mobile browser and proxy aggressive caching of HTML and auth pages
app.use((req, res, next) => {
  const p = req.path;
  if (
    p === '/' ||
    p === '/login' ||
    p === '/login.html' ||
    p === '/dashboard' ||
    p === '/dashboard.html' ||
    p === '/admin' ||
    p === '/admin.html' ||
    p === '/index.html' ||
    p === '/whoami' ||
    p.startsWith('/api/')
  ) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }
  next();
});

const SYSTEM_DOMAIN_FILE = path.join(__dirname, 'system_domain.json');
let systemConfiguredDomain = '';
try {
  if (fs.existsSync(SYSTEM_DOMAIN_FILE)) {
    const raw = fs.readFileSync(SYSTEM_DOMAIN_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    systemConfiguredDomain = (parsed.domain || parsed.custom_web_url || '').trim();
  }
} catch (e) {}

let globalDetectedWebUrl = '';

function setSystemConfiguredDomain(domainUrl: string) {
  if (!domainUrl) return;
  let clean = domainUrl.trim();
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    clean = 'https://' + clean;
  }
  clean = clean.replace(/\/$/, '');
  systemConfiguredDomain = clean;
  try {
    fs.writeFileSync(SYSTEM_DOMAIN_FILE, JSON.stringify({ domain: clean, updatedAt: new Date().toISOString() }), 'utf8');
  } catch (e) {}
}

function updateDetectedWebUrl(req: any) {
  if (!req) return;
  try {
    const rawHost = (req.get('x-forwarded-host') || req.get('host') || '').trim();
    const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').trim();
    if (rawHost && !rawHost.includes('localhost') && !rawHost.includes('127.0.0.1')) {
      const isRawIp = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(rawHost);
      const hostUrl = `${proto}://${rawHost}`;
      if (!isRawIp) {
        // High-priority real domain detected from active web traffic
        globalDetectedWebUrl = hostUrl;
        if (!systemConfiguredDomain) {
          setSystemConfiguredDomain(hostUrl);
        }
      } else if (!globalDetectedWebUrl && !systemConfiguredDomain) {
        globalDetectedWebUrl = hostUrl;
      }
    }
  } catch (e) {}
}

app.use((req, res, next) => {
  updateDetectedWebUrl(req);
  next();
});

// Serve HTML & PWA files
app.use('/icons', express.static(path.join(__dirname, 'icons')));
app.get('/manifest.json', (req: any, res: any) => {
  res.sendFile(path.join(__dirname, 'manifest.json'));
});
app.get('/sw.js', (req: any, res: any) => {
  res.setHeader('Service-Worker-Allowed', '/');
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'sw.js'));
});
app.get('/favicon.ico', (req: any, res: any) => {
  res.sendFile(path.join(__dirname, 'icons', 'favicon.png'));
});
app.get('/api/download/flutter-app', (req: any, res: any) => {
  const zipPath = path.join(__dirname, 'telebot_flutter.tar.gz');
  if (fs.existsSync(zipPath)) {
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', 'attachment; filename="telebot_flutter.tar.gz"');
    return res.sendFile(zipPath);
  }
  res.status(404).send('Flutter project archive not found');
});
function getAdminTelegramBotUrl(): string {
  const adminUser = usersList.find((u: any) => u.role === 'admin' || u.username === 'admin');
  const botUsername = (adminUser as any)?.alert_bot_username || cachedAdminBotUsername || '';
  if (botUsername) {
    return `https://t.me/${botUsername}?start=request_id`;
  }
  return 'https://t.me/';
}

function sendInjectedHtml(filePath: string, res: any) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    const botUrl = getAdminTelegramBotUrl();
    if (botUrl && botUrl !== 'https://t.me/') {
      content = content.replace(/https:\/\/t\.me\/(?![\w_]+)/g, botUrl);
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.send(content);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.sendFile(filePath);
  }
}

app.use('/admin.html', (req: any, res: any) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});
app.use('/dashboard.html', (req: any, res: any) => {
  sendInjectedHtml(path.join(__dirname, 'dashboard.html'), res);
});
app.use('/login.html', (req: any, res: any) => {
  sendInjectedHtml(path.join(__dirname, 'login.html'), res);
});

