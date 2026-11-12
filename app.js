import {initializeApp} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';
import {getAuth,onAuthStateChanged,createUserWithEmailAndPassword,signInWithEmailAndPassword,sendPasswordResetEmail,signOut,EmailAuthProvider,reauthenticateWithCredential,updatePassword} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';
import {getFirestore,doc,setDoc,deleteDoc,collection,onSnapshot} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';
import {firebaseConfig} from './firebase-config.js';
import {INITIAL_MENU,initialSettings,yen,unitBack,getWorkedMinutes,roundQuarter,lateFine,officialHoliday,isWeekend,dayName,absenceFine,shiftPay,createLedger,summarizeMonth} from './calculator.js';

const $=id=>document.getElementById(id);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today=()=>new Intl.DateTimeFormat('sv-SE',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Tokyo'}).format(new Date());
const validNum=(v,max=100000000)=>v!=='' && Number.isFinite(Number(v)) && Number(v)>=0 && Number(v)<=max;
const positiveInt=(v,max=1000000)=>validNum(v,max) && Number.isInteger(Number(v));
const pad=n=>String(n).padStart(2,'0');
const months=(month,step)=>{const [y,m]=month.split('-').map(Number);const x=new Date(Date.UTC(y,m-1+step,1));return `${x.getUTCFullYear()}-${pad(x.getUTCMonth()+1)}`;};
const clone=x=>JSON.parse(JSON.stringify(x));
const newId=()=>globalThis.crypto?.randomUUID?.() || ('id-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,11));
const state={mode:'none',user:null,month:today().slice(0,7),day:today(),kind:'shift',category:'ドリンク',records:[],settings:initialSettings(),items:[],editingMenu:null,unsubscribeEntries:null,unsubscribeSettings:null};
let auth,db,toaster;
function toast(message){$('toast').textContent=message;$('toast').classList.add('shown');clearTimeout(toaster);toaster=setTimeout(()=>$('toast').classList.remove('shown'),3300);}
function friendlyError(error,otherwise='操作に失敗しました'){
  console.error(error);
  const map={'auth/invalid-email':'メールアドレスを確認してください','auth/invalid-credential':'メールアドレスまたはパスワードが違います','auth/email-already-in-use':'このメールアドレスは登録済みです','auth/weak-password':'パスワードは8文字以上・英大文字・数字を含めてください','auth/password-does-not-meet-requirements':'パスワードは8文字以上・英大文字・数字を含めてください','auth/too-many-requests':'試行回数が多いため、時間をおいて再試行してください','auth/operation-not-allowed':'Firebaseでメール／パスワード認証を有効にしてください','permission-denied':'データの読み書き権限がありません。Firestoreルールを確認してください'};
  toast(map[error?.code]||otherwise);return map[error?.code]||otherwise;
}
function visibleApp(show){$('authScreen').classList.toggle('hidden',show);$('appScreen').classList.toggle('hidden',!show);}
function showPanel(panel){
  ['home','entry','menu','settings'].forEach(n=>$(n+'Panel').classList.toggle('hidden',n!==panel));
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.panel===panel));
  $('floatingAdd').classList.toggle('hidden',panel==='entry');
  scrollTo({top:0,behavior:'instant'});
}
function showEntry(day){
  if(day)loadDay(day);showPanel('entry');
}
function setMonth(month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return;state.month=month;$('monthInput').value=month;renderHome();}
function showModeBadge(){
  $('modeBadge').textContent=state.mode==='demo'?'デモ版':(state.user?.email||'ログイン中');
  $('demoBanner').classList.toggle('hidden',state.mode!=='demo');
  $('demoReset').classList.toggle('hidden',state.mode!=='demo');
  $('accountSecurityCard').classList.toggle('hidden',state.mode!=='cloud');
  $('accountEmail').textContent=state.mode==='cloud'?(state.user?.email||'登録メールアドレスを取得できません'):'デモモード';
  resetChangePasswordForm();
  $('accountSecurityMessage').textContent='';
}
function unsubscribe(){state.unsubscribeEntries?.();state.unsubscribeSettings?.();state.unsubscribeEntries=state.unsubscribeSettings=null;}
function startDemo(){
  unsubscribe();state.user=null;state.mode='demo';
  try{const stored=JSON.parse(localStorage.getItem('paynote_demo_v2')||'null');state.records=Array.isArray(stored?.records)?stored.records:[];state.settings=stored?.settings?.menu?stored.settings:initialSettings();}
  catch{state.records=[];state.settings=initialSettings();}
  activate();
}
function saveDemo(){localStorage.setItem('paynote_demo_v2',JSON.stringify({records:state.records,settings:state.settings}));}
function activate(){
  visibleApp(true);showModeBadge();setMonth(state.month);loadDay(today());renderMenus();$('settingRate').value=state.settings.hourlyRate;showPanel('home');
}
function startCloud(user){
  unsubscribe();state.mode='cloud';state.user=user;state.records=[];state.settings=initialSettings();activate();
  const uid=user.uid;
  state.unsubscribeSettings=onSnapshot(doc(db,'users',uid,'settings','profile'),async snap=>{
    if(state.mode!=='cloud'||state.user?.uid!==uid)return;
    if(!snap.exists()){
      try{await setDoc(snap.ref,initialSettings());}catch(e){friendlyError(e,'初期設定を保存できませんでした');}
      return;
    }
    const next=snap.data();state.settings={hourlyRate:Number(next.hourlyRate||0),menu:Array.isArray(next.menu)?next.menu:clone(INITIAL_MENU)};
    $('settingRate').value=state.settings.hourlyRate;renderMenus();renderQuickMenu();
    if(!$('hourlyRate').value)$('hourlyRate').value=state.settings.hourlyRate;
  },e=>friendlyError(e,'設定を取得できませんでした'));
  state.unsubscribeEntries=onSnapshot(collection(db,'users',uid,'entries'),snap=>{
    if(state.mode!=='cloud'||state.user?.uid!==uid)return;
    state.records=snap.docs.map(x=>({...x.data(),date:x.id}));renderHome();
    // A remote update may affect the next-shift absent-fine assignment.
    renderPreview();
  },e=>friendlyError(e,'勤務記録を読み込めませんでした'));
}
async function persistSettings(){
  if(state.mode==='demo'){saveDemo();return;}
  await setDoc(doc(db,'users',state.user.uid,'settings','profile'),state.settings);
}
async function putRecord(record){
  if(state.mode==='demo'){
    state.records=state.records.filter(r=>r.date!==record.date).concat(record);
    saveDemo();renderHome();return;
  }
  await setDoc(doc(db,'users',state.user.uid,'entries',record.date),record);
}
async function removeRecord(date){
  if(state.mode==='demo'){state.records=state.records.filter(r=>r.date!==date);saveDemo();renderHome();return;}
  await deleteDoc(doc(db,'users',state.user.uid,'entries',date));
}
function getDateRecord(date){return state.records.find(r=>r.date===date);}
function renderHome(){
  if(!state.mode||state.mode==='none')return;
  const {sum,listed,ledger}=summarizeMonth(state.records,state.month);
  $('monthNet').textContent=yen(sum.net);$('monthDays').textContent=`${sum.days}日`;
  $('monthBack').textContent=yen(sum.menuBack+sum.escortBack);
  $('monthFines').textContent=yen(sum.latePenalty+sum.absencePenalty);
  const [year,month]=state.month.split('-').map(Number);
  const first=new Date(Date.UTC(year,month-1,1));
  const offset=(first.getUTCDay()+6)%7;
  const cells=Math.ceil((offset+new Date(Date.UTC(year,month,0)).getUTCDate())/7)*7;
  const dateMap=new Map(state.records.map(r=>[r.date,r]));
  const buttons=[];
  for(let index=0;index<cells;index++){
    const d=new Date(Date.UTC(year,month-1,1-offset+index));
    const iso=`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
    const rec=dateMap.get(iso);const pay=ledger.payByDate.get(iso);const isToday=iso===today();
    const holiday=officialHoliday(iso),weekend=isWeekend(iso);
    const note=rec?.type==='absence'?'<span class="day-absence">当欠</span>':rec?.type==='shift'?`<span class="day-money">${escape(yen(pay?.net||0))}</span>`:holiday?`<span class="holiday-label">${escape(holiday)}</span>`:'';
    buttons.push(`<button type="button" data-date="${iso}" aria-label="${iso}${rec?.type==='absence'?' 当日欠勤':rec?.type==='shift'?' 出勤記録':''}" class="${iso.slice(0,7)!==state.month?'other ':''}${isToday?'today ':''}${rec?.type==='shift'?'has-shift ':''}${rec?.type==='absence'?'has-absence ':''}"><span class="day-number" style="${weekend&&!rec?'color:#c7777c':''}">${d.getUTCDate()}</span>${note}</button>`);
  }
  $('calendar').innerHTML=buttons.join('');
  $('calendar').querySelectorAll('button').forEach(el=>el.addEventListener('click',()=>{setMonth(el.dataset.date.slice(0,7));showEntry(el.dataset.date);}));
  $('csvBtn').disabled=listed.length===0;
  if(!listed.length){$('history').innerHTML='<div class="empty-state">まだ記録がありません</div>';}
  else $('history').innerHTML=listed.map(r=>{
    const pay=ledger.payByDate.get(r.date);
    const absence=r.type==='absence';
    const summary=absence?`次回罰金 ${yen(pay?.fine)}`:`${escape(r.start||'')}〜${escape(r.end||'')} ｜ バック ${yen(pay?.menuBack+pay?.escortBack)}`;
    return `<button type="button" class="history-item ${absence?'absence':''}" data-day="${r.date}"><span class="history-date"><strong>${Number(r.date.slice(8))}</strong><small>${dayName(r.date)}曜日</small></span><span class="history-main"><b>${escape(r.date.slice(5,7))}/${escape(r.date.slice(8))} ${absence?'当日欠勤':'出勤'}</b><small>${summary}</small></span><span class="history-amount">${absence?'−'+yen(pay?.fine):yen(pay?.net)}</span><span class="history-chevron">›</span></button>`;
  }).join('');
  $('history').querySelectorAll('button').forEach(el=>el.addEventListener('click',()=>showEntry(el.dataset.day)));
  const pending=ledger.pending.filter(x=>x.date<=`${state.month}-31`);
  $('pendingBox').classList.toggle('hidden',!pending.length);
  if(pending.length)$('pendingBox').innerHTML=`当欠罰金：<b>${yen(pending.reduce((a,b)=>a+b.fine,0))}</b>（次回出勤日に反映）`;
}
function setKind(kind){
  state.kind=kind;
  document.querySelectorAll('.segment').forEach(b=>b.classList.toggle('active',b.dataset.kind===kind));
  $('shiftFields').classList.toggle('hidden',kind!=='shift');
  $('absenceFields').classList.toggle('hidden',kind!=='absence');
  $('breakdownCard').classList.toggle('hidden',kind!=='shift');
  $('startTime').required=kind==='shift';$('endTime').required=kind==='shift';$('hourlyRate').required=kind==='shift';
  renderAbsenceFine();renderPreview();
}
function loadDay(iso){
  state.day=iso;$('workDate').value=iso;
  const record=getDateRecord(iso);
  $('startTime').value=record?.type==='shift'?record.start||'':'';
  $('endTime').value=record?.type==='shift'?record.end||'':'';
  $('hourlyRate').value=record?.type==='shift'?record.rate:state.settings.hourlyRate;
  $('lateMinutes').value=record?.type==='shift'?record.lateMinutes||0:0;
  $('escortCount').value=record?.type==='shift'?record.escortCount||0:0;
  $('escortMinutes').value=record?.type==='shift'?record.escortMinutes||0:0;
  $('note').value=record?.note||'';
  $('holidayOverride').checked=!!record?.holidayOverride;
  state.items=record?.type==='shift'?clone(record.items||[]).map((m,i)=>({...m,_key:`saved-${i}`})):[];
  $('deleteDayBtn').classList.toggle('hidden',!record);
  setKind(record?.type||'shift');renderSelected();renderAbsenceFine();renderPreview();
}
function renderAbsenceFine(){
  const day=$('workDate').value||today();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return;
  const official=officialHoliday(day);const weekend=isWeekend(day);
  const candidate={date:day,type:'absence',holidayOverride:$('holidayOverride').checked};
  const amt=absenceFine(candidate);
  $('absenceFineLabel').textContent=yen(amt);
  const hint=official?`祝日・休日：${official}`:weekend?'土日':'平日';
  $('absenceDayHint').textContent=hint;
  $('holidayHelp').textContent=official||weekend?'土日祝として判定':day.slice(0,4) in {'2026':1,'2027':1}?'平日：¥2,000':'祝日は手動でチェック';
}
function renderQuickMenu(){
  document.querySelectorAll('.filter').forEach(el=>el.classList.toggle('active',el.dataset.cat===state.category));
  const matches=state.settings.menu.filter(x=>x.category===state.category);
  $('quickMenu').innerHTML=matches.length?matches.map(m=>`<button type="button" class="quick-item" data-id="${escape(m.id)}"><b>${escape(m.name)} <span class="plus">＋</span></b><small>${m.customPrice?'金額を入力':yen(m.price)} / バック ${'fixedBack'in m?yen(m.fixedBack):Number(m.rate)+'%'}</small></button>`).join(''):'<div class="empty-state" style="grid-column:1/-1">メニュー未登録</div>';
  $('quickMenu').querySelectorAll('button[data-id]').forEach(b=>b.addEventListener('click',()=>addItem(b.dataset.id)));
}
function addItem(id){
  const item=state.settings.menu.find(x=>x.id===id);if(!item)return;
  const existed=!item.customName&&!item.customPrice?state.items.find(x=>x.id===id):null;
  if(existed){existed.qty++;}
  else state.items.push({...clone(item),_key:`item-${newId()}`,qty:1,...(item.customName?{name:''}:{}),...(item.customPrice?{price:''}:{})});
  renderSelected();renderPreview();
}
function renderSelected(){
  const el=$('selectedItems');
  if(!state.items.length){el.innerHTML='';return;}
  el.innerHTML='<div class="selected-heading">追加済みの品目</div>'+state.items.map(m=>`<div class="selected-row" data-key="${escape(m._key)}"><div class="selected-info"><b>${escape(m.customName?(m.name||'その他フード'):m.name)}</b><small>バック ${'fixedBack' in m?yen(m.fixedBack):Number(m.rate)+'%'} ／ 1点 ${m.customPrice?'金額を入力':yen(m.price)}</small></div><div class="stepper"><button type="button" data-step="-1" aria-label="${escape(m.name||'その他フード')}を1点減らす">−</button><strong>${m.qty}</strong><button type="button" data-step="1" aria-label="${escape(m.name||'その他フード')}を1点増やす">＋</button></div>${m.customName||m.customPrice?`<div class="selected-custom">${m.customName?`<label>商品名<input class="custom-name" maxlength="60" placeholder="例：ポテト" value="${escape(m.name)}"></label>`:''}${m.customPrice?`<label>販売価格（円）<input class="custom-price" type="number" min="0" max="100000000" step="1" inputmode="numeric" placeholder="例：1500" value="${escape(m.price)}"></label>`:''}</div>`:''}</div>`).join('');
  el.querySelectorAll('.selected-row').forEach(row=>{
    row.querySelectorAll('[data-step]').forEach(btn=>btn.addEventListener('click',()=>{
      const item=state.items.find(x=>x._key===row.dataset.key);
      item.qty+=Number(btn.dataset.step);
      if(item.qty<=0)state.items=state.items.filter(x=>x!==item);
      renderSelected();renderPreview();
    }));
    row.querySelectorAll('.custom-name,.custom-price').forEach(input=>input.addEventListener('input',()=>{
      const item=state.items.find(x=>x._key===row.dataset.key);
      if(input.classList.contains('custom-name'))item.name=input.value;
      else item.price=input.value;
      renderPreview();
    }));
  });
}
function buildDraft(validate=true){
  const date=$('workDate').value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date)))throw Error('日付を入力してください');
  if(state.kind==='absence')return {date,type:'absence',holidayOverride:$('holidayOverride').checked,note:$('note').value.trim()};
  const start=$('startTime').value,end=$('endTime').value,rate=$('hourlyRate').value;
  const late=$('lateMinutes').value,escorts=$('escortCount').value,escortMinutes=$('escortMinutes').value;
  if(!positiveInt(rate,1000000))throw Error('時給を正しく入力してください');
  if(!positiveInt(late,1440)||!positiveInt(escorts,100)||!positiveInt(escortMinutes,1440))throw Error('遅刻・同伴の数字を確認してください');
  getWorkedMinutes(start,end,Number(escortMinutes));
  const items=state.items.map(m=>{
    if(!positiveInt(String(m.qty),1000)||Number(m.qty)<1)throw Error('品目の数量を確認してください');
    if(!String(m.name).trim())throw Error('その他フードの商品名を入力してください');
    if(!positiveInt(String(m.price),100000000))throw Error('その他フードの金額を確認してください');
    const { _key,...withoutKey}=m;
    return {...withoutKey,name:String(m.name).trim(),price:Number(m.price),qty:Number(m.qty)};
  });
  return {date,type:'shift',start,end,rate:Number(rate),lateMinutes:Number(late),escortCount:Number(escorts),escortMinutes:Number(escortMinutes),items,note:$('note').value.trim()};
}
function draftPay(record){
  const others=state.records.filter(x=>x.date!==record.date);
  const ledger=createLedger([...others,record]);
  return ledger.payByDate.get(record.date);
}
function renderPreview(){
  if(state.kind==='absence'){
    $('previewLabel').textContent='次回出勤時に差し引く罰金';
    $('previewNet').textContent='−'+yen(absenceFine({date:$('workDate').value||today(),type:'absence',holidayOverride:$('holidayOverride').checked}));
    $('previewDetails').textContent='当欠：給与なし';return;
  }
  $('previewLabel').textContent='見込み給与';
  let draft,pay;
  try{draft=buildDraft(false);pay=draftPay(draft);}
  catch(e){$('previewNet').textContent='¥0';$('previewDetails').textContent='出退勤・時給を入力';$('breakdown').innerHTML='<div>出退勤・時給を入力</div>';return;}
  $('previewNet').textContent=yen(pay.net);
  $('previewDetails').textContent=`実働 ${pay.actual}分 → 給与対象 ${pay.rounded}分（15分単位）`;
  const lines=[['時給分',pay.base],['ドリンク・フード等のバック',pay.menuBack],['中抜け同伴バック',pay.escortBack],['遅刻罰金',-pay.latePenalty],['次回勤務分の当欠罰金',-pay.absencePenalty],['10%控除',-pay.discount],['見込み給与',pay.net]];
  $('breakdown').innerHTML=lines.map(([name,value],i)=>`<div class="${value<0?'negative':''} ${i===lines.length-1?'final':''}"><span>${name}</span><strong>${yen(value)}</strong></div>`).join('');
}
async function saveDay(event){
  event.preventDefault();
  let draft;
  try{draft=buildDraft();}catch(e){toast(e.message);return;}
  $('saveDayBtn').disabled=true;
  try{await putRecord(draft);state.day=draft.date;setMonth(draft.date.slice(0,7));$('deleteDayBtn').classList.remove('hidden');showPanel('home');toast(draft.type==='absence'?'当日欠勤を登録しました':'勤務を保存しました');}
  catch(e){friendlyError(e,'保存できませんでした');}
  finally{$('saveDayBtn').disabled=false;}
}
async function deleteDay(){
  const date=$('workDate').value;if(!getDateRecord(date))return;
  if(!confirm(`${date} の記録を削除しますか？\nこれ以降の当欠罰金の計上日が変更される場合があります。`))return;
  try{await removeRecord(date);loadDay(date);showPanel('home');toast('記録を削除しました');}
  catch(e){friendlyError(e,'削除できませんでした');}
}
function renderMenus(){
  const group=['ドリンク','フード','シャンパン','その他'];
  $('menuList').innerHTML=group.map(cat=>{
    const items=state.settings.menu.filter(m=>m.category===cat);if(!items.length)return'';
    return `<div class="catalog-group"><h3>${escape(cat)}（${items.length}件）</h3>${items.map(m=>`<div class="catalog-item"><div class="catalog-item-content"><b>${escape(m.name)}</b><small>${m.customPrice?'金額は入力時に指定':yen(m.price)} ／ ${'fixedBack'in m?'固定バック '+yen(m.fixedBack):'バック率 '+m.rate+'%'}</small></div><button type="button" class="icon-action" data-edit="${escape(m.id)}">編集</button><button type="button" class="icon-action danger" data-delete="${escape(m.id)}">削除</button></div>`).join('')}</div>`;
  }).join('')||'<p class="muted">まだメニューがありません。</p>';
  $('menuList').querySelectorAll('[data-edit]').forEach(btn=>btn.addEventListener('click',()=>editMenu(btn.dataset.edit)));
  $('menuList').querySelectorAll('[data-delete]').forEach(btn=>btn.addEventListener('click',()=>deleteMenu(btn.dataset.delete)));
  renderQuickMenu();
}
function menuMode(){const fixed=$('menuMode').value==='fixed';$('rateGroup').classList.toggle('hidden',fixed);$('fixedGroup').classList.toggle('hidden',!fixed);$('menuRate').required=!fixed;$('menuFixed').required=fixed;}
function resetMenuForm(){
  state.editingMenu=null;$('menuForm').reset();$('menuRate').value='20';$('menuFormTitle').textContent='メニューを追加';$('saveMenuBtn').textContent='＋ メニューを保存';$('cancelMenuEdit').classList.add('hidden');menuMode();
}
function editMenu(id){
  const m=state.settings.menu.find(x=>x.id===id);if(!m)return;state.editingMenu=id;
  $('menuCategory').value=m.category;$('menuName').value=m.name;$('menuPrice').value=m.price;
  $('menuMode').value='fixedBack'in m?'fixed':'rate';$('menuRate').value=m.rate??20;$('menuFixed').value=m.fixedBack??0;
  $('menuCustomName').checked=!!m.customName;$('menuCustomPrice').checked=!!m.customPrice;
  $('menuFormTitle').textContent='メニューを編集';$('saveMenuBtn').textContent='変更を保存';$('cancelMenuEdit').classList.remove('hidden');menuMode();
  $('menuForm').scrollIntoView({behavior:'smooth',block:'start'});
}
async function saveMenu(e){
  e.preventDefault();const fixed=$('menuMode').value==='fixed';
  const name=$('menuName').value.trim(),price=$('menuPrice').value,back=fixed?$('menuFixed').value:$('menuRate').value;
  if(!name||!positiveInt(price,100000000)||(fixed?!positiveInt(back,100000000):!validNum(back,100))){toast('メニュー名・価格・バックを確認してください');return;}
  const m={id:state.editingMenu||'menu-'+newId(),category:$('menuCategory').value,name,price:Number(price),...(fixed?{fixedBack:Number(back)}:{rate:Number(back)}),customPrice:$('menuCustomPrice').checked,customName:$('menuCustomName').checked};
  const was=clone(state.settings);
  state.settings.menu=state.editingMenu?state.settings.menu.map(x=>x.id===m.id?m:x):[...state.settings.menu,m];
  try{await persistSettings();resetMenuForm();renderMenus();toast('メニューを保存しました');}
  catch(e){state.settings=was;friendlyError(e,'メニューの保存に失敗しました');}
}
async function deleteMenu(id){
  const m=state.settings.menu.find(x=>x.id===id);if(!m||!confirm(`「${m.name}」を削除しますか？\n過去の記録は変更されません。`))return;
  const old=clone(state.settings);state.settings.menu=state.settings.menu.filter(x=>x.id!==id);
  try{await persistSettings();renderMenus();toast('メニューを削除しました');}
  catch(e){state.settings=old;friendlyError(e,'削除に失敗しました');}
}
async function restoreMenu(){
  const ids=new Set(state.settings.menu.map(x=>x.id));const names=new Set(state.settings.menu.map(x=>x.name));
  const missing=INITIAL_MENU.filter(m=>!ids.has(m.id)&&!names.has(m.name));
  if(!missing.length){toast('初期メニューは登録済みです');return;}
  if(!confirm(`${missing.length}品目の初期メニューを追加しますか？`))return;
  const old=clone(state.settings);state.settings.menu.push(...clone(missing));
  try{await persistSettings();renderMenus();toast('初期メニューを追加しました');}
  catch(e){state.settings=old;friendlyError(e,'追加に失敗しました');}
}
async function saveSettings(e){
  e.preventDefault();const value=$('settingRate').value;
  if(!positiveInt(value,1000000)){toast('時給を正しく入力してください');return;}
  const old=state.settings.hourlyRate;state.settings.hourlyRate=Number(value);
  try{await persistSettings();toast('標準時給を保存しました');}
  catch(e){state.settings.hourlyRate=old;friendlyError(e,'設定を保存できませんでした');}
}
function exportCsv(){
  const {listed,ledger}=summarizeMonth(state.records,state.month);
  if(!listed.length)return toast('この月に記録はありません');
  const rows=[['日付','区分','出勤','退勤','時給','実働分','給与対象分','時給分','メニューバック','同伴バック','遅刻罰金','当欠罰金（次勤務適用）','10%控除額','見込み給与','内容','メモ']];
  listed.forEach(r=>{
    const pay=ledger.payByDate.get(r.date),attendance=r.type==='shift';
    rows.push([r.date,attendance?'出勤':'当日欠勤',r.start||'',r.end||'',r.rate??'',attendance?pay.actual:'',attendance?pay.rounded:'',attendance?pay.base:'',attendance?pay.menuBack:'',attendance?pay.escortBack:'',attendance?pay.latePenalty:'',attendance?pay.absencePenalty:pay.fine,attendance?pay.discount:'',attendance?pay.net:'',(r.items||[]).map(m=>`${m.name} ${m.qty}点`).join(' / '),r.note||'']);
  });
  const csv='\ufeff'+rows.map(row=>row.map(v=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s)&&!/^\-?\d+(?:\.\d+)?$/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`balloon_${state.month}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
// 新規登録だけにFirebaseで設定したパスワード条件を適用。
// 既存アカウントのログインはクライアント側で強制しない。
let authMode='login';
function passwordCriteria(value){
  return {length:value.length>=8,uppercase:/[A-Z]/.test(value),number:/[0-9]/.test(value)};
}
function updatePasswordRules(){
  const criteria=passwordCriteria($('password').value);
  document.querySelectorAll('[data-password-rule]').forEach(element=>{
    element.classList.toggle('ok',Boolean(criteria[element.dataset.passwordRule]));
  });
  return Object.values(criteria).every(Boolean);
}
function setAuthMode(mode){
  authMode=mode;
  const registering=mode==='register';
  $('authHeading').textContent=registering?'新規登録':'ログイン';
  $('loginBtn').textContent=registering?'登録する':'ログイン';
  $('registerBtn').textContent=registering?'ログインに戻る':'新規アカウント作成';
  $('resetPasswordBtn').classList.toggle('hidden',registering);
  $('passwordRules').classList.toggle('hidden',!registering);
  $('confirmGroup').classList.toggle('hidden',!registering);
  $('confirmPassword').required=registering;
  $('password').minLength=registering?8:0;
  $('password').autocomplete=registering?'new-password':'current-password';
  $('password').placeholder=registering?'8文字以上・英大文字・数字':'パスワード';
  $('password').value='';
  $('confirmPassword').value='';
  $('authMessage').textContent='';
  updatePasswordRules();
}
async function submitAuth(){
  if(!$('loginForm').reportValidity())return;
  const registering=authMode==='register';
  if(registering){
    if(!updatePasswordRules()){
      $('authMessage').textContent='8文字以上・英大文字・数字を含めてください';
      $('password').focus();
      return;
    }
    if($('password').value!==$('confirmPassword').value){
      $('authMessage').textContent='確認用パスワードが一致しません';
      $('confirmPassword').focus();
      return;
    }
  }
  if(!auth){$('authMessage').textContent='Firebaseの接続設定を確認してください';return;}
  $('authMessage').textContent='';
  $('loginBtn').disabled=$('registerBtn').disabled=true;
  try{
    if(registering)await createUserWithEmailAndPassword(auth,$('email').value.trim(),$('password').value);
    else await signInWithEmailAndPassword(auth,$('email').value.trim(),$('password').value);
    setAuthMode('login');
  }catch(e){$('authMessage').textContent=friendlyError(e,registering?'登録できませんでした':'ログインできませんでした');}
  finally{$('loginBtn').disabled=$('registerBtn').disabled=false;}
}
// 設定画面内で直接パスワードを変更。既存のFirebase/Firestoreデータは変更しない。
function resetChangePasswordForm(){
  const form=$('changePasswordForm');
  if(!form)return;
  form.reset();
  ['currentPassword','changeNewPassword','changeConfirmPassword'].forEach(id=>$(id).type='password');
  form.classList.add('hidden');
  const button=$('accountResetPasswordBtn');
  button.setAttribute('aria-expanded','false');
  button.textContent='パスワードを変更';
  $('changePwStatus').textContent='';
  $('changePwSubmit').disabled=false;
  document.querySelectorAll('[data-change-pw-rule]').forEach(el=>el.classList.remove('ok'));
}
function showChangePasswordForm(show){
  const form=$('changePasswordForm');
  if(!show){resetChangePasswordForm();return;}
  form.classList.remove('hidden');
  $('accountResetPasswordBtn').textContent='入力欄を閉じる';
  $('accountResetPasswordBtn').setAttribute('aria-expanded','true');
  $('accountSecurityMessage').textContent='';
  $('currentPassword').focus();
}
function checkChangedPasswordRules(){
  const rules=passwordCriteria($('changeNewPassword').value);
  document.querySelectorAll('[data-change-pw-rule]').forEach(el=>{
    el.classList.toggle('ok',Boolean(rules[el.dataset.changePwRule]));
  });
  return Object.values(rules).every(Boolean);
}
async function submitPasswordChange(e){
  e.preventDefault();
  if(state.mode!=='cloud'||!auth?.currentUser?.email){
    $('changePwStatus').textContent='ログイン状態を確認できません。再ログインしてください。';return;
  }
  const current=$('currentPassword').value;
  const updated=$('changeNewPassword').value;
  const confirmed=$('changeConfirmPassword').value;
  const status=$('changePwStatus');
  status.textContent='';
  if(!current){status.textContent='現在のパスワードを入力してください。';return;}
  if(!checkChangedPasswordRules()){
    status.textContent='新しいパスワードは8文字以上・英大文字・数字を含めてください。';return;
  }
  if(updated!==confirmed){status.textContent='新しいパスワードが一致しません。';return;}
  if(current===updated){status.textContent='現在とは異なるパスワードを設定してください。';return;}
  const user=auth.currentUser;
  const submit=$('changePwSubmit');
  submit.disabled=true;submit.textContent='変更中…';
  try{
    const credential=EmailAuthProvider.credential(user.email,current);
    await reauthenticateWithCredential(user,credential);
    await updatePassword(user,updated);
    resetChangePasswordForm();
    $('accountSecurityMessage').textContent='パスワードを変更しました。次回から新しいパスワードでログインしてください。';
    toast('パスワードを変更しました');
  }catch(error){
    console.error('パスワード変更に失敗:',error?.code||'unknown');
    const messages={
      'auth/wrong-password':'現在のパスワードが違います。',
      'auth/invalid-credential':'現在のパスワードが違います。',
      'auth/weak-password':'新しいパスワードが条件を満たしていません。',
      'auth/password-does-not-meet-requirements':'新しいパスワードがFirebaseの条件を満たしていません。',
      'auth/requires-recent-login':'認証を確認できません。再ログインしてからお試しください。',
      'auth/too-many-requests':'試行回数が多いため、時間をおいてお試しください。',
      'auth/network-request-failed':'ネットワークに接続できません。通信状況を確認してください。',
      'auth/user-disabled':'このアカウントは無効になっています。',
      'auth/user-token-expired':'ログインの有効期限が切れました。再ログインしてください。'
    };
    status.textContent=messages[error?.code]||'変更できませんでした。入力内容を確認してもう一度お試しください。';
    // 誤った現在のパスワードを残さない。
    $('currentPassword').value='';
  }finally{
    submit.disabled=false;submit.textContent='パスワードを変更する';
  }
}
function bind(){
  $('loginForm').addEventListener('submit',e=>{e.preventDefault();submitAuth();});
  $('registerBtn').addEventListener('click',()=>{
    setAuthMode(authMode==='login'?'register':'login');
    $('email').focus();
  });
  $('password').addEventListener('input',()=>{
    updatePasswordRules();
    if($('authMessage').textContent) $('authMessage').textContent='';
  });
  $('confirmPassword').addEventListener('input',()=>{$('authMessage').textContent='';});
  $('resetPasswordBtn').addEventListener('click',async()=>{
    const email=$('email').value.trim();
    if(!email){$('authMessage').textContent='先にメールアドレスを入力してください';$('email').focus();return;}
    if(!$('email').checkValidity()){$('email').reportValidity();return;}
    if(!auth){$('authMessage').textContent='Firebaseの接続設定を確認してください';return;}
    $('resetPasswordBtn').disabled=true;
    try{
      await sendPasswordResetEmail(auth,email);
      $('authMessage').textContent='パスワード再設定メールを送信しました';
    }catch(error){
      $('authMessage').textContent=friendlyError(error,'再設定メールを送信できませんでした');
    }finally{$('resetPasswordBtn').disabled=false;}
  });

  $('showPasswordBtn').addEventListener('click',()=>{
    const currentlyHidden=$('password').type==='password';
    $('password').type=currentlyHidden?'text':'password';
    $('confirmPassword').type=currentlyHidden?'text':'password';
    $('showPasswordBtn').textContent=currentlyHidden?'隠す':'表示';
    $('showPasswordBtn').setAttribute('aria-label',currentlyHidden?'パスワードを隠す':'パスワードを表示');
    $('showPasswordBtn').setAttribute('aria-pressed',String(currentlyHidden));
  });
  $('demoBtn').addEventListener('click',startDemo);
  $('logoutBtn').addEventListener('click',async()=>{unsubscribe();if(state.mode==='cloud')try{await signOut(auth);}catch(e){friendlyError(e,'ログアウトに失敗しました');}state.mode='none';state.user=null;state.records=[];setAuthMode('login');visibleApp(false);});
  document.querySelectorAll('.nav-item').forEach(el=>el.addEventListener('click',()=>showPanel(el.dataset.panel)));
  $('floatingAdd').addEventListener('click',()=>showEntry(today()));
  $('monthInput').addEventListener('change',()=>setMonth($('monthInput').value));
  $('prevMonth').addEventListener('click',()=>setMonth(months(state.month,-1)));
  $('nextMonth').addEventListener('click',()=>setMonth(months(state.month,1)));
  $('todayBtn').addEventListener('click',()=>setMonth(today().slice(0,7)));
  $('csvBtn').addEventListener('click',exportCsv);
  $('workDate').addEventListener('change',()=>loadDay($('workDate').value));
  document.querySelectorAll('.segment').forEach(el=>el.addEventListener('click',()=>setKind(el.dataset.kind)));
  document.querySelectorAll('.filter').forEach(el=>el.addEventListener('click',()=>{state.category=el.dataset.cat;renderQuickMenu();}));
  document.querySelectorAll('[data-late]').forEach(el=>el.addEventListener('click',()=>{$('lateMinutes').value=Math.min(1440,Number($('lateMinutes').value||0)+Number(el.dataset.late));renderPreview();}));
  $('resetLate').addEventListener('click',()=>{$('lateMinutes').value=0;renderPreview();});
  $('dayForm').addEventListener('input',()=>{renderAbsenceFine();renderPreview();});
  $('dayForm').addEventListener('submit',saveDay);
  $('deleteDayBtn').addEventListener('click',deleteDay);
  $('menuMode').addEventListener('change',menuMode);
  $('menuForm').addEventListener('submit',saveMenu);
  $('cancelMenuEdit').addEventListener('click',resetMenuForm);
  $('restoreMenu').addEventListener('click',restoreMenu);
  $('settingsForm').addEventListener('submit',saveSettings);
  $('accountResetPasswordBtn').addEventListener('click',()=>{
    if(state.mode!=='cloud')return;
    showChangePasswordForm($('changePasswordForm').classList.contains('hidden'));
  });
  $('changePwCancel').addEventListener('click',()=>showChangePasswordForm(false));
  $('changePasswordForm').addEventListener('submit',submitPasswordChange);
  $('changeNewPassword').addEventListener('input',()=>{
    checkChangedPasswordRules();
    $('changePwStatus').textContent='';
  });
  $('changeConfirmPassword').addEventListener('input',()=>{$('changePwStatus').textContent='';});
  $('changePwShow').addEventListener('change',()=>{
    const type=$('changePwShow').checked?'text':'password';
    ['currentPassword','changeNewPassword','changeConfirmPassword'].forEach(id=>$(id).type=type);
  });
  $('demoReset').addEventListener('click',()=>{if(!confirm('デモで入力した全データを削除しますか？'))return;localStorage.removeItem('paynote_demo_v2');startDemo();toast('デモデータを削除しました');});
}
function boot(){
  bind();$('monthInput').value=state.month;menuMode();renderAbsenceFine();
  if(!firebaseConfig.apiKey||!firebaseConfig.projectId||!firebaseConfig.appId){
    $('authMessage').textContent='Firebase未設定のため、まず「設定なしで試す」を利用できます。';
    $('loginBtn').disabled=$('registerBtn').disabled=true;
    return;
  }
  try{
    const app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);
    onAuthStateChanged(auth,user=>{
      if(user)startCloud(user);
      else if(state.mode!=='demo'){unsubscribe();state.mode='none';visibleApp(false);}
    },e=>friendlyError(e,'認証状態を確認できませんでした'));
  }catch(e){$('authMessage').textContent=friendlyError(e,'Firebaseの接続設定を確認してください');}
}
boot();
