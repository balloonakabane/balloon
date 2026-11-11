/** PayNote calculation rules. Pure functions so they can be tested without Firebase. */
export const INITIAL_MENU = [
  {id:'drink',category:'ドリンク',name:'通常ドリンク',price:1000,rate:20},
  {id:'shot',category:'ドリンク',name:'ショット',price:1300,rate:30},
  {id:'1800',category:'ドリンク',name:'1800',price:2000,rate:30},
  {id:'beer-share',category:'ドリンク',name:'瓶ビール（シェア）',price:2000,fixedBack:400},
  {id:'omurice',category:'フード',name:'オムライス',price:1200,rate:30},
  {id:'fried-rice',category:'フード',name:'チャーハン',price:1200,rate:30},
  {id:'other-food',category:'フード',name:'その他フード',price:0,rate:70,customPrice:true,customName:true},
  {id:'asti',category:'シャンパン',name:'アスティ',price:6000,fixedBack:1300},
  {id:'moet-white',category:'シャンパン',name:'モエ白',price:20000,fixedBack:4060},
  {id:'moet-rose',category:'シャンパン',name:'モエロゼ',price:23000,fixedBack:4870},
  {id:'veuve-yellow',category:'シャンパン',name:'ヴーヴイエロー',price:23000,fixedBack:4690},
  {id:'veuve-rose',category:'シャンパン',name:'ヴーヴロゼ',price:25000,fixedBack:5010},
  {id:'dom',category:'シャンパン',name:'ドンペリニヨン',price:65000,fixedBack:11810},
  {id:'armand',category:'シャンパン',name:'アルマンド',price:120000,fixedBack:22930},
  {id:'original',category:'シャンパン',name:'オリシャン',price:13000,fixedBack:3640},
  {id:'original-gold',category:'シャンパン',name:'オリシャン（金）',price:40000,fixedBack:11410},
  {id:'veuve-white-ice',category:'シャンパン',name:'ヴーヴ白（リッチオンアイス）',price:24000,fixedBack:5010}
];
export const initialSettings = () => ({hourlyRate:0, menu:INITIAL_MENU.map(x=>({...x}))});
export const yen = value => {
  const n = Math.round(Number(value) || 0);
  return `${n < 0 ? '−' : ''}¥${Math.abs(n).toLocaleString('ja-JP')}`;
};
export const unitBack = m => Object.hasOwn(m,'fixedBack') ? Number(m.fixedBack) : Math.round(Number(m.price)*Number(m.rate)/100);
const mins = t => {const [h,m]=t.split(':').map(Number); return h*60+m;};
export function getWorkedMinutes(start,end,escortMinutes=0) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start||'') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end||'')) throw Error('出勤・退勤時刻を入力してください');
  const elapsed=(mins(end)-mins(start)+1440)%1440;
  if (!elapsed) throw Error('出勤と退勤を同じ時刻にできません');
  if (!Number.isInteger(escortMinutes) || escortMinutes<0 || escortMinutes>elapsed) throw Error('中抜け時間を確認してください');
  return elapsed-escortMinutes;
}
export const roundQuarter = m => Math.ceil(m/15)*15;
export const lateFine = m => Math.ceil(Number(m)/15)*300;
export function dayOfWeek(iso) {return new Date(`${iso}T12:00:00`).getDay();}
/** Official Japanese national holiday/holiday dates from the Cabinet Office, 2026 and 2027. */
export const HOLIDAYS = {
 '2026':{'01-01':'元日','01-12':'成人の日','02-11':'建国記念の日','02-23':'天皇誕生日','03-20':'春分の日','04-29':'昭和の日','05-03':'憲法記念日','05-04':'みどりの日','05-05':'こどもの日','05-06':'振替休日','07-20':'海の日','08-11':'山の日','09-21':'敬老の日','09-22':'国民の休日','09-23':'秋分の日','10-12':'スポーツの日','11-03':'文化の日','11-23':'勤労感謝の日'},
 '2027':{'01-01':'元日','01-11':'成人の日','02-11':'建国記念の日','02-23':'天皇誕生日','03-21':'春分の日','03-22':'振替休日','04-29':'昭和の日','05-03':'憲法記念日','05-04':'みどりの日','05-05':'こどもの日','07-19':'海の日','08-11':'山の日','09-20':'敬老の日','09-23':'秋分の日','10-11':'スポーツの日','11-03':'文化の日','11-23':'勤労感謝の日'}
};
export function officialHoliday(iso) {return HOLIDAYS[iso.slice(0,4)]?.[iso.slice(5)] || '';}
export const dayName = date => ['日','月','火','水','木','金','土'][dayOfWeek(date)];
export const isWeekend = iso => [0,6].includes(dayOfWeek(iso));
export function absenceFine(record) {
  if(record.type!=='absence') return 0;
  return isWeekend(record.date) || !!record.holidayOverride || !!officialHoliday(record.date) ? 4000 : 2000;
}
export function shiftPay(record, absencePenalty=0) {
  const actual = getWorkedMinutes(record.start,record.end,Number(record.escortMinutes)||0);
  const rounded=roundQuarter(actual);
  const base=Math.round(rounded*Number(record.rate)/60);
  const menuBack=(record.items||[]).reduce((total,m)=>total+unitBack(m)*Number(m.qty),0);
  const escortBack=2000*Number(record.escortCount||0);
  const latePenalty=lateFine(record.lateMinutes||0);
  const beforeTax=base+menuBack+escortBack-latePenalty-absencePenalty;
  const net=Math.floor(beforeTax*0.9);
  return {actual,rounded,base,menuBack,escortBack,latePenalty,absencePenalty,beforeTax,discount:beforeTax-net,net};
}
/** Fine from an absence is applied to the FIRST subsequent attendance day; can cross months. */
export function createLedger(records) {
  const ordered=[...records].sort((a,b)=>a.date.localeCompare(b.date));
  const payByDate=new Map();
  let pending=[];
  for(const r of ordered){
    if(r.type==='absence'){
      const fine=absenceFine(r);
      pending.push({date:r.date,fine});
      payByDate.set(r.date,{type:'absence',fine});
    }else if(r.type==='shift'){
      const applicable=pending.filter(x=>x.date<r.date);
      pending=pending.filter(x=>x.date>=r.date);
      payByDate.set(r.date,{type:'shift',...shiftPay(r, applicable.reduce((sum,x)=>sum+x.fine,0)), applied:applicable});
    }
  }
  return {payByDate,pending};
}
export function summarizeMonth(records, month) {
  const ledger=createLedger(records);
  const listed=records.filter(x=>x.date.startsWith(month)).sort((a,b)=>b.date.localeCompare(a.date));
  const sum={net:0,base:0,menuBack:0,escortBack:0,latePenalty:0,absencePenalty:0,discount:0,days:0,absences:0};
  for(const r of listed){
    if(r.type==='absence'){sum.absences++;continue;}
    const pay=ledger.payByDate.get(r.date);if(!pay) continue;
    for(const k of ['net','base','menuBack','escortBack','latePenalty','absencePenalty','discount'])sum[k]+=pay[k];
    sum.days++;
  }
  return {sum,listed,ledger};
}
