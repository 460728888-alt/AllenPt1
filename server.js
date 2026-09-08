import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 10000);
const USERNAME = process.env.APP_USERNAME || 'allen';
const PASSWORD = process.env.APP_PASSWORD || 'allen123';
const sessions = new Map();
const memoryUsers = new Map();
const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 }) : null;
const CN_NAMES = {
  '601138.SS':'工业富联','000977.SZ':'浪潮信息','688981.SS':'中芯国际','300750.SZ':'宁德时代','0700.HK':'腾讯控股',
  '600519.SS':'贵州茅台','000001.SZ':'平安银行','000858.SZ':'五粮液','002594.SZ':'比亚迪','600036.SS':'招商银行'
};

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
async function initUsers() {
  const adminHash = hashPassword(PASSWORD);
  if (!pool) {
    memoryUsers.set(USERNAME, { id:1, username:USERNAME, display_name:'Allen', password_hash:adminHash, role:'admin', active:true });
    return;
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY, username VARCHAR(40) UNIQUE NOT NULL, display_name VARCHAR(80) NOT NULL,
    password_hash TEXT NOT NULL, role VARCHAR(10) NOT NULL DEFAULT 'user', active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`INSERT INTO users (username,display_name,password_hash,role) VALUES ($1,'Allen',$2,'admin') ON CONFLICT (username) DO NOTHING`,[USERNAME,adminHash]);
}
async function findUser(username) {
  if (!pool) return memoryUsers.get(username) || null;
  return (await pool.query('SELECT * FROM users WHERE username=$1',[username])).rows[0] || null;
}

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
  req.user = session.user;
  next();
}
function admin(req,res,next){return req.user?.role==='admin'?next():res.status(403).json({error:'仅管理员可操作'})}

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
  const valid = Boolean(session && session.expires > Date.now());
  res.json({ authenticated:valid, user:valid?session.user:null });
});
app.post('/api/login', async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase().slice(0,40);
  const user = await findUser(username);
  if (!user || !user.active || !verifyPassword(String(req.body.password || ''),user.password_hash)) return res.status(401).json({ error: '账号、密码错误或账号已停用' });
  const token = crypto.randomBytes(32).toString('hex');
  const safeUser={id:user.id,username:user.username,displayName:user.display_name,role:user.role};
  sessions.set(token, { expires: Date.now() + 7 * 864e5, user:safeUser });
  res.setHeader('Set-Cookie', `allen_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
  res.json({ ok: true, user:safeUser });
});
app.post('/api/logout', (req, res) => {
  sessions.delete(cookies(req).allen_session);
  res.setHeader('Set-Cookie', 'allen_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/admin/users',auth,admin,async(_req,res)=>{
  const users=pool?(await pool.query('SELECT id,username,display_name AS "displayName",role,active,created_at AS "createdAt" FROM users ORDER BY id')).rows:[...memoryUsers.values()].map(({password_hash,...u})=>({...u,displayName:u.display_name}));
  res.json({users});
});
app.post('/api/admin/users',auth,admin,async(req,res)=>{
  const username=String(req.body.username||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,40);
  const displayName=String(req.body.displayName||username).trim().slice(0,80), password=String(req.body.password||'');
  if(username.length<3||password.length<6)return res.status(400).json({error:'用户名至少3位，密码至少6位'});
  const passwordHash=hashPassword(password);
  try{if(pool)await pool.query(`INSERT INTO users(username,display_name,password_hash,role) VALUES($1,$2,$3,'user')`,[username,displayName,passwordHash]);else{if(memoryUsers.has(username))throw new Error('duplicate');memoryUsers.set(username,{id:Date.now(),username,display_name:displayName,password_hash:passwordHash,role:'user',active:true})}res.json({ok:true})}catch{return res.status(409).json({error:'用户名已存在'})}
});
app.patch('/api/admin/users/:id',auth,admin,async(req,res)=>{
  const id=String(req.params.id), action=req.body.action;
  if(String(req.user.id)===id)return res.status(400).json({error:'不能停用或修改自己的管理员账号'});
  if(action==='toggle'){if(pool)await pool.query('UPDATE users SET active=NOT active WHERE id=$1',[id]);else{const u=[...memoryUsers.values()].find(x=>String(x.id)===id);if(u)u.active=!u.active}}
  else if(action==='reset'){const p=String(req.body.password||'');if(p.length<6)return res.status(400).json({error:'密码至少6位'});const h=hashPassword(p);if(pool)await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2',[h,id]);else{const u=[...memoryUsers.values()].find(x=>String(x.id)===id);if(u)u.password_hash=h}}
  else return res.status(400).json({error:'操作无效'});res.json({ok:true});
});

app.get('/api/search', auth, async (req, res) => {
  try {
    const q = encodeURIComponent(String(req.query.q || '').slice(0, 50));
    const data = await yahooJson(`https://query1.finance.yahoo.com/v1/finance/search?q=${q}&quotesCount=12&newsCount=5`);
    res.json({
      quotes: (data.quotes || []).filter(x => x.symbol).map(x => ({ symbol: x.symbol, name: CN_NAMES[x.symbol] || x.shortname || x.longname || x.symbol, exchange: x.exchDisp || x.exchange || '' })),
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
      symbol, name: CN_NAMES[symbol] || meta.longName || meta.shortName || symbol, currency: meta.currency || '', exchange: meta.exchangeName || '',
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
initUsers().then(()=>app.listen(PORT, '0.0.0.0', () => console.log(`Allen Stock listening on ${PORT}`))).catch(error=>{console.error('Database initialization failed',error);process.exit(1)});
