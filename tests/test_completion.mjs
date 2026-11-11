import test from 'node:test';
import assert from 'node:assert/strict';
import {foldSheets,foldSizes} from '../web/js/fold.js';
import {validateBundle} from '../web/js/backup.js';
import {plannerProject} from '../web/js/planner.js';
import {coverageEntries} from '../web/js/coverage-catalog.js';
const words=p=>p.layers.filter(l=>l.kind==='text').map(l=>l.text);
test('age lookup uses the chosen year and never implies birthday has already occurred',()=>{
 const t=words(plannerProject({layout:'age_lookup',year:2027}));
 assert.ok(t.includes('2027 / 00')&&t.includes('1928 / 99'));assert.ok(t.some(s=>s.includes('生日未到时减1')));
 assert.ok(words(plannerProject({layout:'age_lookup',undated:true})).includes('____ / 99'));
});
test('monthly comparisons label impossible dates and 21-day plans cross years exactly',()=>{
 assert.equal(words(plannerProject({layout:'same_day_months',date:'2024-01-31'})).filter(s=>s==='本月无此日').length,5);
 assert.equal(words(plannerProject({layout:'same_day_months',date:'2024-02-29'})).filter(s=>s==='本月无此日').length,0);
 assert.equal(words(plannerProject({layout:'same_day_months',date:'2100-01-29'})).filter(s=>s==='本月无此日').length,1);
 const t=words(plannerProject({layout:'challenge21',date:'2026-12-25'}));assert.ok(t.includes('12/25')&&t.includes('1/14'));assert.equal(t.filter(s=>/^\d+\/\d+$/.test(s)).length,21);
 assert.throws(()=>plannerProject({layout:'challenge21',date:'2199-12-12'}));assert.doesNotThrow(()=>plannerProject({layout:'challenge21',date:'2199-12-11'}));
});
test('fold sheets preserve exact panel size, numbered continuity, joining tabs and alternate folds',()=>{
 for(const size of Object.keys(foldSizes))for(const panels of [3,6,9,12])for(const style of ['blank','grid','story']){
  const sheets=foldSheets({size,panels,style}),s=foldSizes[size];assert.equal(sheets.length,Math.ceil(panels/s.perSheet));
  const all=sheets.flatMap(words);for(let n=1;n<=panels;n++)assert.equal(all.filter(t=>t===String(n).padStart(2,'0')).length,1);
  for(let n=1;n<panels;n++)assert.equal(all.filter(t=>t===`${n%2?'谷折':'山折'} ${n}`).length,1);
  assert.equal(all.filter(t=>t==='接').length,sheets.length-1);
  for(const p of sheets){validateBundle({format:'journal-studio-backup',version:1,project:p,assets:[]},new Set());
   for(const l of p.layers){assert.ok(l.x_mm>=7&&l.y_mm>=7);if(l.kind==='shape'){assert.ok(l.x_mm+l.w_mm<=203&&l.y_mm+l.h_mm<=291);}}
   // Vertical full-height boundaries remain the exact physical panel height.
   assert.ok(p.layers.some(l=>l.kind==='shape'&&l.h_mm===s.h));
  }
 }
 for(const o of [{size:'fake'},{panels:0},{panels:100},{style:'fake'}])assert.throws(()=>foldSheets(o));
});
test('new evidence upgrades exact MO items and keeps remaining uncertainty visible',()=>{
 for(const n of ['02','03','05','07']){const r=coverageEntries.find(r=>r.id==='k-mo-'+n);assert.equal(r.status,'partial');assert.ok(r.url.includes('ey100.com')&&r.layouts.length);}
 for(const n of ['01','04','06'])assert.equal(coverageEntries.find(r=>r.id==='k-mo-'+n).status,'unknown');
 assert.equal(coverageEntries.find(r=>r.id==='m-gate12').status,'partial');
 for(const id of ['t-regular-032','t-passport-018'])assert.equal(coverageEntries.find(r=>r.id===id).tool,'fold');
 assert.equal(coverageEntries.filter(r=>r.status==='missing').length,2);
});
