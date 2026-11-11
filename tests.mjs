import assert from 'node:assert/strict';
import {getWorkedMinutes,roundQuarter,lateFine,absenceFine,shiftPay,createLedger,summarizeMonth,officialHoliday,unitBack,INITIAL_MENU} from './calculator.js';

const make=(date,overrides={})=>({date,type:'shift',start:'20:00',end:'02:10',rate:2000,lateMinutes:0,escortMinutes:0,escortCount:0,items:[],...overrides});
assert.equal(getWorkedMinutes('20:00','02:10',0),370);
assert.equal(roundQuarter(370),375); // 6h10min -> 6h15min
assert.equal(shiftPay(make('2026-11-12')).base,12500);
assert.equal(lateFine(0),0);
assert.equal(lateFine(1),300);
assert.equal(lateFine(15),300);
assert.equal(lateFine(16),600);
assert.equal(lateFine(30),600);
assert.equal(lateFine(31),900);
assert.equal(absenceFine({date:'2026-11-09',type:'absence'}),2000); // Monday
assert.equal(absenceFine({date:'2026-11-14',type:'absence'}),4000); // Saturday
assert.equal(absenceFine({date:'2026-11-15',type:'absence'}),4000); // Sunday
assert.equal(officialHoliday('2026-11-23'),'勤労感謝の日');
assert.equal(absenceFine({date:'2026-11-23',type:'absence'}),4000); // holiday Monday
assert.equal(absenceFine({date:'2028-01-03',type:'absence',holidayOverride:true}),4000);
assert.equal(unitBack(INITIAL_MENU.find(x=>x.id==='beer-share')),400);
assert.equal(unitBack(INITIAL_MENU.find(x=>x.id==='original')),3640);
assert.equal(shiftPay(make('2026-11-12',{start:'20:00',end:'21:00',lateMinutes:5,items:[{name:'ショット',price:1300,rate:30,qty:2}],escortCount:1})).net,Math.floor((2000+780+2000-300)*.9));
const r=[{date:'2026-11-29',type:'absence'},{date:'2026-11-30',type:'absence'},make('2026-12-02',{start:'20:00',end:'23:00'}),make('2026-12-03',{start:'20:00',end:'23:00'})];
const ledger=createLedger(r);
assert.equal(ledger.payByDate.get('2026-12-02').absencePenalty,6000);
assert.equal(ledger.payByDate.get('2026-12-03').absencePenalty,0);
assert.equal(ledger.pending.length,0);
assert.equal(summarizeMonth(r,'2026-11').sum.net,0);
assert.equal(summarizeMonth(r,'2026-12').sum.absencePenalty,6000);
const unscheduled=createLedger([{date:'2026-11-29',type:'absence'}]);
assert.equal(unscheduled.pending.length,1);
assert.throws(()=>getWorkedMinutes('20:00','20:00',0));
assert.throws(()=>getWorkedMinutes('20:00','21:00',120));
console.log('✅ 20件の給与計算・祝日・月越え罰金テストが成功しました。');
