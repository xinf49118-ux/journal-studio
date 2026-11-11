import test from 'node:test';
import assert from 'node:assert/strict';
import {bookPlan,bookPage,bookPrintPage,bookSizes} from '../web/js/book.js';
import {fitProject} from '../web/js/page-fit.js';
import {PAGE_SIZES} from '../web/js/core.js';
import {plannerLayouts,plannerProject} from '../web/js/planner.js';
import {validateBundle} from '../web/js/backup.js';
import {exportBook} from '../web/js/book-export.js';
test('books include exact days, leap centuries, a real table of contents and sequential page numbers',()=>{
 for(const [year,days] of [[1900,365],[2000,366],[2024,366],[2100,365],[2199,365]]){
  const b=bookPlan({year,type:'daily'}),day=b.pages.filter(p=>p.kind==='day');
  assert.equal(day.length,days);assert.equal(new Set(day.map(p=>p.date)).size,days);
  assert.equal(day[0].date,year+'-01-01');assert.equal(day.at(-1).date,year+'-12-31');
  b.pages.forEach((p,i)=>assert.equal(p.number,i+1));b.contents.forEach(r=>assert.ok(b.pages[r.page-1].label.includes(r.label)));
 }
 const b=bookPlan({mode:'range',start:'2024-02-29',end:'2024-03-01',type:'daily',front:false,notes:0});assert.deepEqual(b.pages.map(p=>p.kind),['month','day','month','day']);
});
test('weekly pages cover every selected day once, including partial weeks crossing months and years',()=>{
 for(const weekStart of [0,1])for(const [start,end] of [['2026-12-30','2027-01-08'],['1900-01-01','1900-01-08'],['2199-12-30','2199-12-31']]){
  const b=bookPlan({mode:'range',start,end,weekStart,notes:0}),weeks=b.pages.filter(p=>p.kind==='week');
  assert.equal(new Set(weeks.map(p=>p.date)).size,weeks.length);
  for(let d=+new Date(start);d<=+new Date(end);d+=86400000)assert.equal(weeks.filter(w=>d>=+new Date(w.date)&&d<+new Date(w.date)+7*86400000).length,1);
 }
 for(const o of [{year:1899},{year:2200},{year:''},{mode:'range',start:'2024-02-30',end:'2024-03-01'},{mode:'range',start:'2024-03-02',end:'2024-03-01'},{mode:'range',start:'2024-01-01',end:'2025-01-01'},{notes:-1},{notes:1.5},{notes:21},{size:'fake'},{type:'fake'},{theme:'fake'},{title:'长'.repeat(25)}])assert.throws(()=>bookPlan(o));
});
test('all four book sizes keep content in bounds and A4 imposition retains exact millimetres',()=>{
 for(const size of Object.keys(bookSizes))for(const type of ['monthly','weekly','daily']){
  const b=bookPlan({year:2024,size,type,title:'最'.repeat(24)}),[w,h]=PAGE_SIZES[size];
  for(let i=0;i<b.pages.length;i++){
   const p=bookPage(b,i);validateBundle({format:'journal-studio-backup',version:1,project:p,assets:[]},new Set());
   for(const l of p.layers){assert.ok(l.x_mm>=7&&l.y_mm>=7);if(l.kind==='shape')assert.ok(l.x_mm+l.w_mm<w-7&&l.y_mm+l.h_mm<h-7);}
   const a=bookPrintPage(p,'a4'),x=(210-w)/2,y=(297-h)/2;assert.equal(a.page.size,'A4');
   p.layers.forEach((l,j)=>{assert.equal(a.layers[j].x_mm,l.x_mm+x);assert.equal(a.layers[j].y_mm,l.y_mm+y);assert.equal(a.layers[j].w_mm,l.w_mm);assert.equal(a.layers[j].size_mm,l.size_mm);});
  }
 }
});
test('87 editable layouts resize proportionally without mutating drafts and restore from backups',()=>{
 for(const l of plannerLayouts)for(const size of ['A5','A6','B6']){
  const before=plannerProject({layout:l.id,date:'2024-02-29',month:'2024-02'}),snapshot=JSON.stringify(before),p=fitProject(before,size),[w,h]=PAGE_SIZES[size];
  assert.equal(JSON.stringify(before),snapshot);assert.equal(p.page.size,size);
  validateBundle({format:'journal-studio-backup',version:1,project:p,assets:[]},new Set());
  for(const layer of p.layers){assert.ok(layer.x_mm>=0&&layer.y_mm>=0);if(layer.kind==='shape')assert.ok(layer.x_mm+layer.w_mm<w&&layer.y_mm+layer.h_mm<h);}
  before.layers.forEach((layer,i)=>{if(layer.kind==='text')assert.equal(p.layers[i].text,layer.text);else assert.ok(Math.abs(p.layers[i].w_mm/p.layers[i].h_mm-layer.w_mm/layer.h_mm)<1e-9);});
 }
});
test('export cancellation and renderer failures stop before returning a partial PDF',async()=>{
 const b=bookPlan({year:2024,type:'monthly',notes:0}),controller=new AbortController();let calls=0;
 await assert.rejects(exportBook(b,{signal:controller.signal,render:async()=>{calls++;return {jpeg:new Uint8Array([1,2,3]),width:1,height:1};},onProgress:()=>controller.abort()}),{name:'AbortError'});assert.equal(calls,1);
 await assert.rejects(exportBook(b,{render:async()=>{throw new Error('render failed');}}),/render failed/);
});
