import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {coverageEntries as rows,coverageStatuses,brandCoverage,filterCoverage} from '../web/js/coverage-catalog.js';
import {plannerProject,plannerLayouts} from '../web/js/planner.js';
const words=o=>plannerProject(o).layers.filter(l=>l.kind==='text').map(l=>l.text);
test('coverage separates products, unsupported leads and implemented functions',()=>{
 assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);
 assert.equal(brandCoverage.length,10);
 for(const r of rows){
  assert.ok(brandCoverage.some(b=>b.brand===r.brand));assert.ok(coverageStatuses[r.status]);assert.ok(r.remaining&&r.evidence);assert.match(r.url,/^https:\/\//);
  if(r.status==='ready'){assert.equal(r.kind,'功能');assert.ok(r.layouts.length>0);}
  if(['missing','unknown','reference'].includes(r.status))assert.deepEqual(r.layouts,[]);
  for(const id of r.layouts)assert.ok(plannerLayouts.some(l=>l.id===id));
 }
 assert.equal(filterCoverage({brand:'陌墨 MO.CARD',status:'ready'}).length,0);
 assert.equal(filterCoverage({brand:'KOKUYO',query:'MO 替芯'}).length,7);
 assert.ok(filterCoverage({status:'missing'}).length>0);
 assert.equal(filterCoverage({brand:'kinbor',status:'unknown',query:'樱花'}).length,1);
 const saved=JSON.parse(readFileSync(new URL('../docs/coverage-data.json',import.meta.url)));
 assert.deepEqual(saved.entries,rows);
});
test('new calendar pages honor leap days, two-week spans and both week starts',()=>{
 assert.ok(words({layout:'sleep_log',month:'2024-02'}).includes('29'));
 assert.ok(!words({layout:'sleep_log',month:'2024-02'}).includes('30'));
 assert.ok(!words({layout:'sleep_log',month:'2100-02'}).includes('29'));
 const fort=words({layout:'fortnight_diary',date:'2027-01-01'});
 assert.ok(fort.includes('12/28  周一'));assert.ok(fort.includes('1/10  周日'));assert.ok(fort.some(s=>s.includes('2027-01-10')));
 assert.ok(words({layout:'fortnight_diary',date:'2027-01-01',weekStart:0}).includes('12/27  周日'));
 for(const start of [0,1])assert.equal(words({layout:'dual_month',month:'2024-02',weekStart:start}).filter(s=>s==='29').length,2);
 assert.equal(words({layout:'dual_month',undated:true}).filter(s=>/^\d+$/.test(s)).length,0);
});
test('three and ten year diaries preserve non-leap dates and enforce supported end year',()=>{
 for(const [layout,n] of [['three_year',3],['ten_year',10]]){
  const t=words({layout,date:'2024-02-29'});
  assert.ok(t.includes(`${2024+n-1} 年`));assert.equal(t.filter(s=>s==='本年无2月29日').length,n===3?2:7);
  assert.throws(()=>plannerProject({layout,date:`${2201-n}-01-01`}));
  assert.doesNotThrow(()=>plannerProject({layout,date:`${2200-n}-01-01`}));
  assert.ok(words({layout,undated:true}).includes(`第 ${n} 年：____`));
 }
});
