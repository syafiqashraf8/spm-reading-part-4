/* Shared connector: no roster records or credentials belong in this file. */
const SHEETS = {
  endpoint: 'PASTE_APPS_SCRIPT_EXEC_URL_HERE',
  exerciseId: 'spm-p1-part4-reading-sets-1-6-v1',
  exerciseVersion: '2026-10-18',
  queueKey: 'SMTAS_SHARED_RESULTS_OUTBOX_v1'
};
const freshId = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
let roster = [], rosterError = '', bridgeSource = null, bridgeOrigin = '', bridgeFrame = null;
let bridgeReady = null, pendingCalls = new Map(), syncBusy = false, syncMessage = '';
let outbox = [];
try {outbox = JSON.parse(localStorage.getItem(SHEETS.queueKey)||'[]'); if(!Array.isArray(outbox))outbox=[];}catch(e){}
function persistOutbox(){
  try {localStorage.setItem(SHEETS.queueKey,JSON.stringify(outbox));return true;}
  catch(e){syncMessage='Storage unavailable. Keep this tab open and retry saving before leaving.';return false;}
}
function configured(){return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(SHEETS.endpoint);}
function connectBridge(){
  if(bridgeSource)return Promise.resolve();
  if(bridgeReady)return bridgeReady;
  bridgeReady=new Promise((resolve,reject)=>{
    if(!configured())return reject(new Error('Teacher setup needed: add the Apps Script deployment URL in sheets-connector.js.'));
    if(!/^https?:$/.test(location.protocol))return reject(new Error('Open this app through a web host, not as a local file.'));
    const channel=freshId();
    const timer=setTimeout(()=>{window.removeEventListener('message',hello);bridgeReady=null;if(bridgeFrame)bridgeFrame.remove();reject(new Error('Cannot reach Google. Check internet, deployment access and allowed site origin.'));},25000);
    function hello(e){
      let host;try{host=new URL(e.origin).hostname;}catch(_){return;}
      if(!(host==='script.google.com'||host.endsWith('.googleusercontent.com')))return;
      if(e.data?.channel!==channel||e.data?.type!=='smtas-ready')return;
      clearTimeout(timer);window.removeEventListener('message',hello);
      bridgeSource=e.source;bridgeOrigin=e.origin;resolve();
    }
    window.addEventListener('message',hello);
    bridgeFrame=document.createElement('iframe');bridgeFrame.hidden=true;bridgeFrame.title='Google Sheets save connection';
    bridgeFrame.src=SHEETS.endpoint+'?origin='+encodeURIComponent(location.origin)+'&channel='+encodeURIComponent(channel);
    document.body.appendChild(bridgeFrame);
  }).catch(e=>{bridgeReady=null;throw e;});
  return bridgeReady;
}
window.addEventListener('message',e=>{
  if(e.source!==bridgeSource||e.origin!==bridgeOrigin||e.data?.type!=='smtas-response')return;
  const p=pendingCalls.get(e.data.id);if(!p)return;
  clearTimeout(p.timer);pendingCalls.delete(e.data.id);
  e.data.ok?p.resolve(e.data.result):p.reject(new Error(e.data.error||'Google could not save this result.'));
});
async function sheetsCall(action,payload){
  await connectBridge();
  return new Promise((resolve,reject)=>{
    const id=freshId();const timer=setTimeout(()=>{pendingCalls.delete(id);reject(new Error('No save confirmation. Your result remains pending; retry is safe.'));},30000);
    pendingCalls.set(id,{resolve,reject,timer});bridgeSource.postMessage({type:'smtas-request',id,action,payload},bridgeOrigin);
  });
}
async function loadRoster(){
  rosterError='';try {const r=await sheetsCall('roster',{});roster=r.students;if(!Array.isArray(roster)||!roster.length)throw new Error('No active students in the roster. Ask your teacher.');}
  catch(e){rosterError=e.message;roster=[];}
  if(!S.studentId)renderStart();paintSync();
}
function ensureAttempt(){if(!S.attemptId)S.attemptId=freshId();if(!S.studentId)throw new Error('Choose your class and name first.');}
function queueSet(set){
  ensureAttempt();const submissionId=S.attemptId+':'+SHEETS.exerciseId+':'+set.id;
  if(outbox.some(x=>x.submissionId===submissionId))return;
  const result=S.sets[set.id];
  outbox.push({submissionId,attemptId:S.attemptId,studentId:S.studentId,exerciseId:SHEETS.exerciseId,exerciseVersion:SHEETS.exerciseVersion,setId:set.id,
    clientSubmittedAt:new Date().toISOString(),answers:result.answers,
    proof:Object.fromEntries(QS(set).filter(q=>q.n!==0).map(q=>[q.n,proofOf(set.id,q.n)])),support:!!S.support});
  persistOutbox();paintSync();flushQueue();
}
async function flushQueue(){
  if(syncBusy)return;syncBusy=true;syncMessage='';paintSync();
  try{
    while(outbox.length){
      const current=outbox[0];const ack=await sheetsCall('save',current);
      if(!ack?.saved||ack.submissionId!==current.submissionId)throw new Error('No matching save receipt. Please retry.');
      outbox.shift();persistOutbox();
      if(S.attemptId===current.attemptId){S.receipts=S.receipts||{};S.receipts[current.setId]=ack.receivedAt;save();}
      paintSync();
    }
  }catch(e){syncMessage=e.message;}
  finally{syncBusy=false;paintSync();}
}
function paintSync(){
  const el=document.getElementById('cloud-status');if(!el)return;
  const count=outbox.length;
  const receipts=Object.keys(S.receipts||{}).length;
  let text=!configured()?'Teacher setup needed — Google Sheets is not connected.':
    syncBusy?'Saving to Google Sheets…':count?count+' result'+(count>1?'s':'')+' pending — keep this browser open or retry here.':
    receipts?'Saved to Google Sheets — '+receipts+' set'+(receipts>1?'s':'')+' confirmed.':
    S.studentId?'Ready. Results save after each submitted set.':roster.length?'Roster connected. Choose your class and name.':'Connecting to roster…';
  if(syncMessage)text+=' '+syncMessage;
  el.textContent=text;
  const retry=document.getElementById('cloud-retry');retry.disabled=syncBusy;retry.hidden=!count&&!rosterError;
  const change=document.getElementById('cloud-change');change.hidden=!S.studentId;
}
function installCloudBar(){
  const bar=document.createElement('section');bar.className='cloudbar no-print';bar.setAttribute('aria-label','Result saving');
  bar.innerHTML='<div id="cloud-status" role="status" aria-live="polite"></div><div class="cloud-actions"><button class="ghost" id="cloud-retry" type="button">Retry connection / save</button><button class="ghost" id="cloud-change" type="button">Change student</button></div>';
  document.querySelector('.wrap').prepend(bar);
  document.getElementById('cloud-retry').onclick=async()=>{await loadRoster();flushQueue();};
  document.getElementById('cloud-change').onclick=()=>{
    if(!confirm('Change student? This clears the current practice from this device. Any pending submitted results stay queued for saving.'))return;
    wipe();S={name:'',klass:'',idx:0,sets:{},done:false,support:false,unlocked:{},draft:{},pencil:{},proof:{},preview:{},hl:{}};save();render();paintSync();loadRoster();
  };
  paintSync();
}
window.addEventListener('online',()=>{if(!roster.length)loadRoster();flushQueue();});
window.addEventListener('beforeunload',e=>{if(outbox.length){e.preventDefault();e.returnValue='';}});
