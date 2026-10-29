import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createApp,currentMonday} from '../server.mjs';
const origin='http://localhost:3000';
const evidence='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
test('signup → submission → review → leaderboard; permissions and recovery',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tradebull-')); const dbPath=join(dir,'test.sqlite');const {server,db}=createApp({dbPath,origin});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 async function call(path,data,cookie='',extra={}){const res=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Tradebull-Request':'1',Cookie:cookie,...extra},body:data===undefined?undefined:JSON.stringify(data)});const body=res.headers.get('content-type')?.includes('application/json')?await res.json():await res.text();return{status:res.status,body,cookie:res.headers.get('set-cookie')?.split(';')[0]};}
 const pwd='a-long-test-password';
 try{
  for(const email of ['trader@example.com','other@example.com','admin@example.com']) assert.equal((await call('/api/signup',{email,name:email.split('@')[0],password:pwd,consent:true})).status,201);
  const trader=(await call('/api/login',{email:'trader@example.com',password:pwd})).cookie;
  const other=(await call('/api/login',{email:'other@example.com',password:pwd})).cookie;
  db.prepare("UPDATE users SET role='admin' WHERE email='admin@example.com'").run();
  const admin=(await call('/api/login',{email:'admin@example.com',password:pwd})).cookie;
  const date=new Date(currentMonday()+'T00:00:00Z');date.setUTCDate(date.getUTCDate()-7);const week=date.toISOString().slice(0,10);
  const entry={week,pnl:'500.25',capital:'10000',strategy:'Patient entries with fixed risk.',evidence,noCashFlows:true,consent:true};
  assert.equal((await call('/api/submissions',entry)).status,401);
  assert.equal((await call('/api/submissions',entry,trader,{Origin:'https://evil.example'})).status,403);
  assert.equal((await call('/api/submissions',{...entry,capital:'0'},trader)).status,400);
  assert.equal((await call('/api/submissions',{...entry,week:currentMonday()},trader)).status,400);
  assert.equal((await call('/api/submissions',{...entry,evidence:Buffer.from('<svg onload="alert(1)"></svg>').toString('base64')},trader)).status,400);
  assert.equal((await call('/api/submissions',entry,trader)).status,201);
  assert.equal((await call('/api/submissions',entry,trader)).status,409);
  assert.equal((await call('/api/leaderboard')).body.entries.length,0);
  const id=(await call('/api/submissions',undefined,trader)).body.entries[0].id;
  assert.equal((await call(`/api/evidence/${id}`,undefined,other)).status,404);
  assert.equal((await call(`/api/evidence/${id}`,undefined,trader)).status,200);
  assert.equal((await call(`/api/evidence/${id}`,undefined,admin)).status,200);
  assert.equal((await call('/api/admin/submissions',undefined,trader)).status,403);
  const review={status:'approved',reason:'Checked dates and figures against evidence.'};
  assert.equal((await call(`/api/admin/submissions/${id}/review`,review,trader)).status,403);
  assert.equal((await call(`/api/admin/submissions/${id}/review`,review,admin)).status,200);
  const board=(await call('/api/leaderboard')).body;assert.equal(board.entries.length,1);assert.equal(board.entries[0].pnl,50025);assert.equal(board.entries[0].returnPercent,5.0025);assert.equal(board.entries[0].rank,1);assert.equal(board.entries[0].email,undefined);
  assert.equal((await call('/api/submissions',{...entry,pnl:'-100'},other)).status,201);
  const otherId=(await call('/api/submissions',undefined,other)).body.entries[0].id;
  await call(`/api/admin/submissions/${otherId}/review`,review,admin);
  assert.equal((await call('/api/leaderboard')).body.entries[1].returnPercent,-1);
  assert.equal((await call('/api/submissions',entry,admin)).status,201);
  const adminId=(await call('/api/submissions',undefined,admin)).body.entries[0].id;
  assert.equal((await call(`/api/admin/submissions/${adminId}/review`,review,admin)).status,403);
  await call(`/api/admin/submissions/${id}/review`,{status:'rejected',reason:'Revoke while correcting reporting dates.'},admin);
  assert.equal((await call('/api/leaderboard')).body.entries.length,1);
  assert.equal(db.prepare('SELECT count(*) n FROM reviews WHERE submission_id=?').get(id).n,2);
  const token='a'.repeat(64);const user=db.prepare("SELECT id,password FROM users WHERE email='trader@example.com'").get();assert.ok(!user.password.includes(pwd));
  db.prepare('INSERT INTO resets VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),user.id,Date.now()+60000);
  assert.equal((await call('/api/reset',{token,password:'replacement-test-password'})).status,200);
  assert.equal((await call('/api/me',undefined,trader)).body.user,null);
  assert.equal((await call('/api/reset',{token,password:'replacement-test-password'})).status,400);
  await call('/api/logout',{},other);assert.equal((await call('/api/me',undefined,other)).body.user,null);
  for(const path of ['/server.mjs','/data/tradebull.sqlite','/.env','/../package.json']) assert.equal((await call(path)).status,404);
  for(const path of ['/','/upload.html','/signin.html','/signup.html','/admin.html','/rules.html','/reset.html'])assert.equal((await call(path)).status,200);
 } finally {await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true});}
});
test('IST week boundary',()=>{assert.equal(currentMonday(new Date('2026-10-25T18:29:59Z')),'2026-10-19');assert.equal(currentMonday(new Date('2026-10-25T18:30:00Z')),'2026-10-26');});
test('production refuses insecure origin',()=>assert.throws(()=>createApp({production:true,origin:'http://example.com'}),/HTTPS/));
test('persistence, tied ranks, archive filtering, request limits and secure cookies',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tradebull-persist-'));const dbPath=join(dir,'test.sqlite');let app=createApp({dbPath,origin});
 app.db.prepare('INSERT INTO users(email,name,password) VALUES(?,?,?)').run('one@example.com','One','unused');
 app.db.prepare('INSERT INTO users(email,name,password) VALUES(?,?,?)').run('two@example.com','Two','unused');
 const insert=app.db.prepare("INSERT INTO submissions(user_id,week,pnl,capital,strategy,evidence,mime,status) VALUES(?,?,?,?,?,?,?,'approved')");
 insert.run(1,'2026-01-05',10000,100000,'Example strategy',Buffer.from(evidence,'base64'),'image/png');
 insert.run(2,'2026-01-05',20000,200000,'Example strategy',Buffer.from(evidence,'base64'),'image/png');
 insert.run(1,'2025-12-29',-500,100000,'Example strategy',Buffer.from(evidence,'base64'),'image/png');app.db.close();
 app=createApp({dbPath,origin,production:false});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.server.address().port}`;
 try{
  const board=await (await fetch(base+'/api/leaderboard')).json();assert.deepEqual(board.entries.map(x=>x.rank),[1,1]);assert.equal(board.weeks.length,2);
  const archived=await (await fetch(base+'/api/leaderboard?week=2025-12-29')).json();assert.equal(archived.entries.length,1);assert.equal(archived.entries[0].pnl,-500);
  for(let i=0;i<16;i++){const res=await fetch(base+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Tradebull-Request':'1'},body:'{}'});assert.equal(res.status,i===15?429:400);await res.text();}
 }finally{await new Promise(resolve=>app.server.close(resolve));app.db.close();}
 const secure=createApp({dbPath,origin:'https://tradebull.example',production:true});await new Promise(resolve=>secure.server.listen(0,'127.0.0.1',resolve));
 try{const res=await fetch(`http://127.0.0.1:${secure.server.address().port}/api/logout`,{method:'POST',headers:{Origin:'https://tradebull.example','Content-Type':'application/json','X-Tradebull-Request':'1'},body:'{}'});assert.match(res.headers.get('set-cookie'),/__Host-session=.*HttpOnly; SameSite=Strict; Max-Age=0; Secure/);await res.text();}
 finally{await new Promise(resolve=>secure.server.close(resolve));secure.db.close();rmSync(dir,{recursive:true,force:true});}
});
