import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 10000);
const USERNAME = process.env.APP_USERNAME || 'allen';
const PASSWORD = process.env.APP_PASSWORD || 'allen123';
const sessions = new Map();

app.use(express.json({ limit: '256kb' }));

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(v => {
    const i = v.indexOf('=');
    return [v.slice(0, i).trim(), decodeURIComponent(v.slice(i + 1))];
  }));
}

function auth(req, res, next) {
  const token = cookies(req).allen_session;
  const session = token && sessions.get(token);
  if (!session || session.expires < Date.now()) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function normalizeSymbol(raw = '') {
  const value = String(raw).trim().toUpperCase();
  if (/^\d{6}$/.test(value)) {
    if (/^[569]/.test(value)) return `${value}.SS`;
    return `${value}.SZ`;
  }
  if (/^\d{5}$/.test(value)) return `${value}.HK`;
  return value.replace(/[^A-Z0-9.\-^=]/g, '');
}

async function yahooJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 AllenStock/1.0' } });
  if (!response.ok) throw new Error(`market data ${response.status}`);
  return response.json();
}

app.get('/api/health', (_req, res) => res.json({ ok: true, version: '1.0.0' }));
app.get('/api/session', (req, res) => {
  const session = sessions.get(cookies(req).allen_session);
  res.json({ authenticated: Boolean(session && session.expires > Date.now()), username: USERNAME });
});
app.post('/api/login', (req, res) => {
  const enteredUser = Buffer.from(String(req.body.username || '').slice(0, 64).padEnd(64));
  const expectedUser = Buffer.from(USERNAME.slice(0, 64).padEnd(64));
  const enteredPass = Buffer.from(String(req.body.password || '').slice(0, 128).padEnd(128));
  const expectedPass = Buffer.from(PASSWORD.slice(0, 128).padEnd(128));
  const goodUser = crypto.timingSafeEqual(enteredUser, expectedUser);
  const goodPass = crypto.timingSafeEqual(enteredPass, expectedPass);
  if (!goodUser || !goodPass) return res.status(401).json({ error: '账号或密码错误' });
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { expires: Date.now() + 7 * 864e5 });
  res.setHeader('Set-Cookie', `allen_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
  res.json({ ok: true, username: USERNAME });
});
app.post('/api/logout', (req, res) => {
  sessions.delete(cookies(req).allen_session);
  res.setHeader('Set-Cookie', 'allen_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/search', auth, async (req, res) => {
  try {
    const q = encodeURIComponent(String(req.query.q || '').slice(0, 50));
    const data = await yahooJson(`https://query1.finance.yahoo.com/v1/finance/search?q=${q}&quotesCount=12&newsCount=5`);
    res.json({
      quotes: (data.quotes || []).filter(x => x.symbol).map(x => ({ symbol: x.symbol, name: x.shortname || x.longname || x.symbol, exchange: x.exchDisp || x.exchange || '' })),
      news: (data.news || []).map(x => ({ title: x.title, publisher: x.publisher, link: x.link, published: x.providerPublishTime }))
    });
  } catch (error) { res.status(502).json({ error: '暂时无法获取搜索数据', detail: error.message }); }
});

app.get('/api/stock/:symbol', auth, async (req, res) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return res.status(400).json({ error: '股票代码无效' });
    const [chart, search] = await Promise.all([
      yahooJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=6mo&interval=1d&events=div%2Csplits`),
      yahooJson(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=1&newsCount=8`).catch(() => ({ news: [] }))
    ]);
    const result = chart.chart?.result?.[0];
    if (!result) throw new Error('symbol not found');
    const meta = result.meta || {};
    const closes = (result.indicators?.quote?.[0]?.close || []).filter(Number.isFinite);
    const volumes = (result.indicators?.quote?.[0]?.volume || []).filter(Number.isFinite);
    const timestamps = result.timestamp || [];
    const price = meta.regularMarketPrice ?? closes.at(-1);
    const previous = closes.at(-2) ?? meta.previousClose ?? meta.chartPreviousClose;
    const changePct = previous ? ((price - previous) / previous) * 100 : null;
    const avg = n => closes.slice(-n).reduce((a, b) => a + b, 0) / Math.max(1, closes.slice(-n).length);
    const ma5 = avg(5), ma20 = avg(20), ma60 = avg(60);
    const high20 = Math.max(...closes.slice(-20));
    const low20 = Math.min(...closes.slice(-20));
    const momentum = price && ma20 ? ((price / ma20) - 1) * 100 : 0;
    const score = Math.max(0, Math.min(100, Math.round(60 + momentum * 2 + (ma5 > ma20 ? 8 : -5) + (ma20 > ma60 ? 7 : -4))));
    res.json({
      symbol, name: meta.longName || meta.shortName || symbol, currency: meta.currency || '', exchange: meta.exchangeName || '',
      price, previous, changePct, marketTime: meta.regularMarketTime || null,
      technical: { ma5, ma20, ma60, high20, low20, volume: volumes.at(-1) || null, score },
      history: closes.slice(-90).map((close, i) => ({ close, time: timestamps.slice(-closes.slice(-90).length)[i] || null })),
      news: (search.news || []).map(x => ({ title: x.title, publisher: x.publisher, link: x.link, published: x.providerPublishTime }))
    });
  } catch (error) { res.status(502).json({ error: '暂时无法获取该股票的真实行情', detail: error.message }); }
});

app.get('/styles.css', (_req, res) => res.sendFile(path.join(root, 'styles.css')));
app.get('/app.js', (_req, res) => res.sendFile(path.join(root, 'app.js')));
app.use((_req, res) => res.sendFile(path.join(root, 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`Allen Stock listening on ${PORT}`));
