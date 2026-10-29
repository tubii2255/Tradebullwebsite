import { openDatabase } from './server.mjs';
import { randomBytes,createHash } from 'node:crypto';
import { resolve } from 'node:path';
const [action,email]=process.argv.slice(2);
if (!['promote','reset'].includes(action) || !email) { console.error('Usage: npm run admin -- promote|reset email'); process.exit(1); }
const db=openDatabase(process.env.DB_PATH || resolve('data/tradebull.sqlite'));
try {
  const user=db.prepare('SELECT id FROM users WHERE email=?').get(email.trim().toLowerCase());
  if (!user) throw Error('Register the account first.');
  if(action==='promote') { db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id); console.log('Administrator role assigned.'); }
  else {
    const token=randomBytes(32).toString('hex');
    db.prepare('DELETE FROM resets WHERE user_id=?').run(user.id);
    db.prepare('INSERT INTO resets VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),user.id,Date.now()+30*60000);
    console.log(`One-time recovery link (expires in 30 minutes; share privately after verifying ownership):\n${process.env.APP_ORIGIN || 'http://localhost:3000'}/reset.html#${token}`);
  }
} finally { db.close(); }
