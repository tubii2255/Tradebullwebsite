const $ = selector => document.querySelector(selector);
const message = (text, error = false) => { $('#message').textContent = text; $('#message').classList.toggle('error',error); };
async function api(path, data) {
  const response = await fetch(path, data === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json','X-Tradebull-Request':'1'},body:JSON.stringify(data)});
  const result = await response.json(); if (!response.ok) throw Error(result.error || 'Request failed.'); return result;
}
function el(tag, text, className) { const node=document.createElement(tag); if(text!==undefined) node.textContent=text; if(className) node.className=className; return node; }
const currency = value => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(value/100);
function form(id, action) {
  $(id)?.addEventListener('submit',async event=>{
    event.preventDefault(); const button=event.target.querySelector('button'); button.disabled=true; message('Working…');
    try { await action(Object.fromEntries(new FormData(event.target)),event.target); } catch(error) { message(error.message,true); } finally { button.disabled=false; }
  });
}
function detail(entry) {
  const card=el('article',undefined,'card');
  card.append(el('h3',`${entry.name ? entry.name+' · ' : ''}Week of ${entry.week}`),el('p',`${currency(entry.pnl)} · ${(100*entry.pnl/entry.capital).toFixed(2)}%`,entry.pnl>=0?'positive':'negative'),el('p',entry.strategy),el('p',`Status: ${entry.status}`,'badge'));
  if(entry.reason) card.append(el('p',`Review note: ${entry.reason}`,'muted'));
  return card;
}
async function history() {
  const {entries}=await api('/api/submissions'); $('#history').replaceChildren();
  if(!entries.length) $('#history').append(el('p','No submissions yet. Your first week starts here.','muted'));
  for(const entry of entries) { const card=detail(entry); const link=el('a','Download my evidence'); link.href=`/api/evidence/${entry.id}`; card.append(link); $('#history').append(card); }
}
async function leaderboard(week='') {
  const data=await api(`/api/leaderboard${week?'?week='+encodeURIComponent(week):''}`);
  $('#weeks').replaceChildren(); for(const value of data.weeks) { const option=el('option',value); option.value=value; $('#weeks').append(option); } $('#weeks').value=data.week || ''; $('#weeks').disabled=!data.weeks.length;
  $('#board').replaceChildren(); $('#winner').replaceChildren();
  if(!data.entries.length) { $('#board').append(el('h3','The next chapter starts with you.'),el('p','No approved results for this week yet. Submit a completed week to join the board.','muted')); return; }
  const leaders=data.entries.filter(x=>x.rank===1).map(x=>x.name).join(', ');
  $('#winner').append(el('div',`Highest reported return · ${leaders} · ${data.entries[0].returnPercent.toFixed(2)}%`,'winner'));
  const table=el('table'); const caption=el('caption',`Week beginning ${data.week} · reviewed submissions`); const head=el('thead'); const row=el('tr');
  for(const title of ['Rank','Trader','Net PnL','Return','Review']) { const cell=el('th',title); cell.scope='col'; row.append(cell); } head.append(row); table.append(caption,head);
  const tbody=el('tbody'); for(const entry of data.entries) { const tr=el('tr'); tr.append(el('td',String(entry.rank),'rank'),el('td',entry.name),el('td',currency(entry.pnl),entry.pnl>=0?'positive':'negative'),el('td',entry.returnPercent.toFixed(2)+'%'),el('td','Reviewed · self-reported')); tbody.append(tr); } table.append(tbody); $('#board').append(table);
}
async function reviews() {
  const {entries}=await api('/api/admin/submissions'); $('#reviews').replaceChildren();
  if(!entries.length) $('#reviews').append(el('p','No submissions to review.'));
  for(const entry of entries) {
    const card=detail(entry); const link=el('a','Download private evidence'); link.href=`/api/evidence/${entry.id}`; card.append(link);
    const reviewForm=el('form'); const label=el('label','Review reason'); const input=el('textarea'); input.required=true; input.minLength=5; input.maxLength=500; input.value=entry.reason; label.append(input); reviewForm.append(label);
    const actions=el('div',undefined,'review-actions'); for(const [value,title] of [['approved','Approve'],['rejected','Reject / revoke']]) { const button=el('button',title,value==='rejected'?'secondary':undefined); button.type='submit'; button.value=value; actions.append(button); } reviewForm.append(actions);
    reviewForm.addEventListener('submit',async event=>{ event.preventDefault(); const status=event.submitter.value; reviewForm.querySelectorAll('button').forEach(b=>b.disabled=true); try { await api(`/api/admin/submissions/${entry.id}/review`,{status,reason:input.value}); await reviews(); message('Review saved.'); } catch(error) {message(error.message,true); reviewForm.querySelectorAll('button').forEach(b=>b.disabled=false);} });
    card.append(reviewForm); $('#reviews').append(card);
  }
}
$('#menu').addEventListener('click',()=>{const open=$('#nav').classList.toggle('open');$('#menu').setAttribute('aria-expanded',String(open));});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){$('#nav').classList.remove('open');$('#menu').setAttribute('aria-expanded','false');}});
$('#logout').addEventListener('click',async()=>{try{await api('/api/logout',{});location.href='/';}catch(error){message(error.message,true);}});
form('#signup',async data=>{const result=await api('/api/signup',{...data,consent:data.consent==='on'}); message(result.message); $('#signup').reset();});
form('#signin',async data=>{await api('/api/login',data);location.href='/upload.html';});
let resetToken=location.hash.slice(1); if($('body').dataset.page==='reset') historyReplace();
function historyReplace(){window.history.replaceState(null,'',location.pathname);}
form('#reset',async data=>{const result=await api('/api/reset',{...data,token:resetToken});resetToken='';message(result.message);$('#reset').reset();});
form('#submission',async(data,node)=>{
  const file=data.evidence; if(file.size>2*1024*1024 || !['image/png','image/jpeg'].includes(file.type)) throw Error('Select a PNG or JPEG smaller than 2 MB.');
  const evidence=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('Unable to read file.'));reader.readAsDataURL(file);});
  const result=await api('/api/submissions',{...data,evidence,noCashFlows:data.noCashFlows==='on',consent:data.consent==='on'}); node.reset(); await history();message(result.message);
});
$('#weeks')?.addEventListener('change',async event=>{try{await leaderboard(event.target.value);}catch(error){message(error.message,true);}});
async function boot(){
  const {user,currentMonday}=await api('/api/me');
  $('#login-link').hidden=!!user;$('#signup-link').hidden=!!user;$('#logout').hidden=!user;$('#admin-link').hidden=user?.role!=='admin';
  const page=$('body').dataset.page;
  if(page==='index') await leaderboard();
  if(page==='upload') {$('#auth-required').hidden=!!user;$('#submission-area').hidden=!user;if(user){const date=new Date(currentMonday+'T00:00:00Z');date.setUTCDate(date.getUTCDate()-7);const input=$('[name=week]');input.max=input.value=date.toISOString().slice(0,10);await history();}}
  if(page==='admin') {if(user?.role!=='admin') throw Error('Sign in with an administrator account to review submissions.');await reviews();}
}
boot().catch(error=>message(error.message,true));
