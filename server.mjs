import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const derive = promisify(scrypt);
const hash = value => createHash('sha256').update(value).digest('hex');
export async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  const key = await derive(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 });
  return `${salt}:${key.toString('hex')}`;
}
async function passwordMatches(password, stored) {
  const candidate = await passwordHash(password, stored.split(':')[0]);
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(stored));
}
export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'trader' CHECK(role IN ('trader','admin')));
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS resets(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS submissions(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), week TEXT NOT NULL, pnl INTEGER NOT NULL, capital INTEGER NOT NULL CHECK(capital>0), strategy TEXT NOT NULL, evidence BLOB NOT NULL, mime TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), reason TEXT NOT NULL DEFAULT '', created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id,week));
    CREATE TABLE IF NOT EXISTS reviews(id INTEGER PRIMARY KEY, submission_id INTEGER NOT NULL REFERENCES submissions(id), reviewer_id INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL, reason TEXT NOT NULL, created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
    PRAGMA user_version=1;`);
  return db;
}
export function currentMonday(now = new Date()) {
  const date = new Date(now.getTime() + 330 * 60000);
  date.setUTCHours(0,0,0,0);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0,10);
}
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function text(value, label, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(400, `${label} must contain ${min}–${max} characters.`);
  return value.trim();
}
function password(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) fail(400, 'Use a password of 12–128 characters.');
  return value;
}
function money(value, label, positive = false) {
  if (typeof value !== 'string' || !/^-?\d{1,10}(\.\d{1,2})?$/.test(value)) fail(400, `${label} must be a number with at most two decimal places.`);
  const amount = Math.round(Number(value) * 100);
  if (positive && amount <= 0) fail(400, `${label} must be greater than zero.`);
  return amount;
}
function weekValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, 'Select a valid Monday.');
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0,10) !== value || date.getUTCDay() !== 1 || value >= currentMonday() || value < '2020-01-01') fail(400, 'Choose the Monday of a completed week (IST).');
  return value;
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'Send JSON.');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 3 * 1024 * 1024) fail(413, 'Request is too large.'); chunks.push(chunk); }
  try { const parsed = JSON.parse(Buffer.concat(chunks)); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw Error(); return parsed; } catch { fail(400, 'Invalid JSON.'); }
}
function image(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail(400, 'Upload a PNG or JPEG.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < 32 || bytes.length > 2 * 1024 * 1024) fail(400, 'Image must be smaller than 2 MB.');
  const png = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  if (!png && !jpeg) fail(400, 'Only PNG and JPEG evidence is accepted.');
  return { bytes, mime: png ? 'image/png' : 'image/jpeg' };
}
export function createApp({ dbPath = process.env.DB_PATH || resolve(root, 'data/tradebull.sqlite'), origin = process.env.APP_ORIGIN || 'http://localhost:3000', production = process.env.NODE_ENV === 'production' } = {}) {
  if (production && !origin.startsWith('https://')) throw Error('Production requires an HTTPS APP_ORIGIN.');
  if (new URL(origin).origin !== origin) throw Error('APP_ORIGIN must be an origin without a trailing slash.');
  const db = openDatabase(dbPath);
  const dummyPassword = passwordHash(randomBytes(32).toString('hex'));
  const cookieName = production ? '__Host-session' : 'session';
  function cookie(token, seconds) { return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${production ? '; Secure' : ''}`; }
  function session(req) {
    const token = (req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
    return token ? db.prepare('SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(hash(token), Date.now()) || null : null;
  }
  function requireUser(req, admin = false) { const user = session(req); if (!user) fail(401, 'Please sign in.'); if (admin && user.role !== 'admin') fail(403, 'Administrator access required.'); return user; }
  function throttle(key, max, duration) {
    const now = Date.now();
    db.prepare('DELETE FROM limits WHERE expires < ?').run(now);
    db.prepare('INSERT INTO limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key, now + duration);
    if (db.prepare('SELECT count FROM limits WHERE key=?').get(key).count > max) fail(429, 'Too many attempts. Please try again later.');
  }
  const server = http.createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Cache-Control','no-store');
    if (production) res.setHeader('Strict-Transport-Security','max-age=31536000');
    const json = (data, status = 200) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, origin); const path = url.pathname;
      if (req.method === 'POST') {
        if (req.headers.origin !== origin || req.headers['x-tradebull-request'] !== '1') fail(403, 'Request origin rejected.');
        throttle(`post:${req.socket.remoteAddress}`, 120, 60000);
      }
      if (req.method === 'GET' && path === '/api/health') return json({status:'ok'});
      if (req.method === 'GET' && path === '/api/me') return json({user:session(req),currentMonday:currentMonday()});
      if (req.method === 'POST' && ['/api/signup','/api/login'].includes(path)) {
        throttle(`auth:${req.socket.remoteAddress}`, 15, 15*60000);
        const b = await body(req); const email = text(b.email,'Email',3,254).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400,'Enter a valid email.');
        const pwd = password(b.password);
        if (path === '/api/signup') {
          const name = text(b.name,'Display name',2,60);
          if (b.consent !== true) fail(400,'Accept the publication and privacy rules.');
          const encoded = await passwordHash(pwd);
          try { db.prepare('INSERT INTO users(email,name,password) VALUES(?,?,?)').run(email,name,encoded); } catch (e) { if (e.code?.includes('SQLITE')) fail(409,'Unable to register this email. Try signing in.'); throw e; }
          return json({message:'Account created. You can now sign in.'},201);
        }
        const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
        const match = await passwordMatches(pwd,user?.password || await dummyPassword);
        if (!user || !match) fail(401,'Email or password is incorrect.');
        db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
        const token = randomBytes(32).toString('hex');
        db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token),user.id,Date.now()+86400000);
        res.setHeader('Set-Cookie',cookie(token,86400)); return json({message:'Signed in.'});
      }
      if (req.method === 'POST' && path === '/api/logout') {
        const token = (req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
        if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token));
        res.setHeader('Set-Cookie',cookie('',0)); return json({message:'Signed out.'});
      }
      if (req.method === 'POST' && path === '/api/reset') {
        throttle(`reset:${req.socket.remoteAddress}`,10,15*60000);
        const b=await body(req); const token=text(b.token,'Reset token',40,100); const encoded=await passwordHash(password(b.password));
        db.exec('BEGIN IMMEDIATE');
        try {
          const row=db.prepare('SELECT * FROM resets WHERE token=? AND expires>?').get(hash(token),Date.now());
          if (!row) fail(400,'Reset link is invalid or expired.');
          db.prepare('UPDATE users SET password=? WHERE id=?').run(encoded,row.user_id);
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.user_id);
          db.prepare('DELETE FROM resets WHERE user_id=?').run(row.user_id); db.exec('COMMIT');
        } catch(e) { db.exec('ROLLBACK'); throw e; }
        return json({message:'Password changed. Sign in with your new password.'});
      }
      if (req.method === 'GET' && path === '/api/leaderboard') {
        const weeks=db.prepare("SELECT DISTINCT week FROM submissions WHERE status='approved' ORDER BY week DESC").all().map(x=>x.week);
        const week=url.searchParams.get('week') || weeks[0] || null;
        if (week) weekValue(week);
        const entries=week ? db.prepare("SELECT u.name,s.pnl,s.capital,s.strategy,s.week,100.0*s.pnl/s.capital AS returnPercent FROM submissions s JOIN users u ON u.id=s.user_id WHERE status='approved' AND week=? ORDER BY returnPercent DESC,u.name ASC,s.id ASC").all(week) : [];
        let previous, rank=0; entries.forEach((entry,i)=>{ if (entry.returnPercent !== previous) rank=i+1; entry.rank=rank; previous=entry.returnPercent; });
        return json({weeks,week,entries});
      }
      if (req.method === 'GET' && path === '/api/submissions') {
        const user=requireUser(req);
        return json({entries:db.prepare('SELECT id,week,pnl,capital,strategy,status,reason,created FROM submissions WHERE user_id=? ORDER BY week DESC').all(user.id)});
      }
      if (req.method === 'POST' && path === '/api/submissions') {
        const user=requireUser(req); throttle(`upload:${user.id}`,20,3600000);
        const b=await body(req); const week=weekValue(b.week); const pnl=money(b.pnl,'PnL'); const capital=money(b.capital,'Starting capital',true);
        const strategy=text(b.strategy,'Strategy',10,2000);
        if (b.noCashFlows !== true || b.consent !== true) fail(400,'Confirm the no-cash-flow rule and publication consent.');
        const evidence=image(b.evidence);
        try { db.prepare('INSERT INTO submissions(user_id,week,pnl,capital,strategy,evidence,mime) VALUES(?,?,?,?,?,?,?)').run(user.id,week,pnl,capital,strategy,evidence.bytes,evidence.mime); }
        catch(e) { if (e.code?.includes('SQLITE') && db.prepare('SELECT id FROM submissions WHERE user_id=? AND week=?').get(user.id,week)) fail(409,'You already submitted this week. Contact an admin for a correction.'); throw e; }
        return json({message:'Submitted for review. Track the status below.'},201);
      }
      if (req.method === 'GET' && path === '/api/admin/submissions') {
        requireUser(req,true);
        return json({entries:db.prepare('SELECT s.id,u.name,s.week,s.pnl,s.capital,s.strategy,s.status,s.reason,s.created FROM submissions s JOIN users u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 200').all()});
      }
      const evidenceMatch=path.match(/^\/api\/evidence\/(\d+)$/);
      if(req.method==='GET' && evidenceMatch) {
        const user=requireUser(req); const row=db.prepare('SELECT user_id,evidence,mime FROM submissions WHERE id=?').get(Number(evidenceMatch[1]));
        if (!row || (row.user_id!==user.id && user.role!=='admin')) fail(404,'Evidence not found.');
        res.writeHead(200,{'Content-Type':row.mime,'Content-Disposition':`attachment; filename="evidence.${row.mime==='image/png'?'png':'jpg'}"`}); return res.end(Buffer.from(row.evidence));
      }
      const reviewMatch=path.match(/^\/api\/admin\/submissions\/(\d+)\/review$/);
      if(req.method==='POST' && reviewMatch) {
        const user=requireUser(req,true); const b=await body(req); const id=Number(reviewMatch[1]);
        if (!['approved','rejected'].includes(b.status)) fail(400,'Choose approve or reject.');
        const reason=text(b.reason,'Review reason',5,500);
        db.exec('BEGIN IMMEDIATE');
        try {
          const row=db.prepare('SELECT user_id FROM submissions WHERE id=?').get(id);
          if (!row) fail(404,'Submission not found.');
          if (row.user_id===user.id) fail(403,'An admin cannot review their own submission.');
          db.prepare('UPDATE submissions SET status=?,reason=? WHERE id=?').run(b.status,reason,id);
          db.prepare('INSERT INTO reviews(submission_id,reviewer_id,status,reason) VALUES(?,?,?,?)').run(id,user.id,b.status,reason); db.exec('COMMIT');
        } catch(e) { db.exec('ROLLBACK'); throw e; }
        return json({message:'Review saved.'});
      }
      if (path.startsWith('/api/')) fail(404,'Endpoint not found.');
      if (!['GET','HEAD'].includes(req.method)) fail(405,'Method not allowed.');
      const assets={'/':'index.html','/index.html':'index.html','/about.html':'about.html','/contact.html':'contact.html','/signin.html':'signin.html','/signup.html':'signup.html','/upload.html':'upload.html','/admin.html':'admin.html','/reset.html':'reset.html','/rules.html':'rules.html','/css/style.css':'css/style.css','/js/main.js':'js/main.js','/favicon.svg':'favicon.svg'};
      const file=assets[path]; if (!file) fail(404,'Page not found.');
      const type=file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.svg')?'image/svg+xml':'text/html';
      res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`}); res.end(req.method==='HEAD'?undefined:readFileSync(resolve(root,'public',file)));
    } catch(e) { if (!res.headersSent) json({error:e.status?e.message:'Unexpected server error.'},e.status || 500); else res.end(); if (!e.status) console.error('Request failed:',e.code || e.name); }
  });
  server.requestTimeout=30000; server.headersTimeout=15000;
  return {server,db};
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {server,db}=createApp();
  server.listen(Number(process.env.PORT || (process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port')+1] : 3000)),process.env.HOST || (process.argv.includes('--host') ? process.argv[process.argv.indexOf('--host')+1] : '127.0.0.1'),()=>console.log('Trade Bull server is ready.'));
  const stop=()=>server.close(()=>{db.close();process.exit(0);}); process.on('SIGTERM',stop); process.on('SIGINT',stop);
}
