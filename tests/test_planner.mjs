import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {plannerProject,plannerLayouts,monthCells,weekDates,parseDate,todayString} from '../web/js/planner.js';
import {templates} from '../web/js/templates.js';
import {validateBundle,restoreBundle} from '../web/js/backup.js';
const manifest=JSON.parse(readFileSync(new URL('../assets/materials/manifest.json',import.meta.url),'utf8'));
const ids=new Set(manifest.items.map(m=>m.id));
test('calendar handles leap centuries, 4/5/6-row months and both week starts',()=>{
 assert.equal(monthCells('2024-02').filter(Boolean).length,29);
 assert.equal(monthCells('2100-02').filter(Boolean).length,28);
 assert.equal(monthCells('2000-02').filter(Boolean).length,29);
 assert.equal(monthCells('2021-02').indexOf(1),0);
 assert.equal(monthCells('2026-08').indexOf(31),35);
 assert.equal(monthCells('2026-11',0).indexOf(1),0);
 assert.equal(monthCells('2026-11',1).indexOf(1),6);
});
test('weeks cross month and year boundaries without timezone arithmetic',()=>{
 assert.deepEqual(weekDates('2027-01-01',1).map(d=>d.toISOString().slice(0,10)),['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']);
 assert.equal(weekDates('2027-01-01',0)[0].toISOString().slice(0,10),'2026-12-27');
 assert.equal(todayString(new Date(2026,0,1,0,1)),'2026-01-01');
});
test('bad inputs fail before changing a draft, unused date inputs do not interfere',()=>{
 for(const s of ['2026-02-29','2024-13-01','1899-01-01','2200-01-01','garbage','2024-1-2'])assert.throws(()=>parseDate(s));
 assert.throws(()=>plannerProject({month:'2026-13',layout:'monthly'}));
 assert.doesNotThrow(()=>plannerProject({month:'2026-11',date:'bad',layout:'monthly'}));
 assert.doesNotThrow(()=>plannerProject({date:'2026-11-11',month:'bad',layout:'daily'}));
 assert.doesNotThrow(()=>plannerProject({date:'',month:'',undated:true}));
});
test('all layout/theme/date-mode combinations fit A5 and survive portable backup',async()=>{
 for(const l of plannerLayouts)for(const t of templates)for(const undated of [false,true]){
  const p=plannerProject({layout:l.id,theme:t.id,month:'2024-02',date:'2024-02-29',undated},manifest.items);
  validateBundle({format:'journal-studio-backup',version:1,project:p,assets:[]},ids);
  assert.equal(p.layers.filter(l=>l.kind==='material').length,1);
  for(const layer of p.layers){
   assert.ok(layer.x_mm>=10&&layer.y_mm>=8);
   if(layer.kind!=='text'){assert.ok(layer.x_mm+layer.w_mm<=138.3);assert.ok(layer.y_mm+layer.h_mm<=202);}
   else assert.ok(layer.y_mm+layer.size_mm*1.35<=203);
  }
  const restored=await restoreBundle({format:'journal-studio-backup',version:1,project:p,assets:[]},()=>{},ids);
  assert.deepEqual(restored,p);
 }
});
test('habit page excludes nonexistent days and undated calendar has blank cells',()=>{
 const text=p=>p.layers.filter(l=>l.kind==='text').map(l=>l.text);
 assert.ok(text(plannerProject({layout:'habits',month:'2024-02'})).includes('29'));
 assert.ok(!text(plannerProject({layout:'habits',month:'2024-02'})).includes('30'));
 assert.ok(!text(plannerProject({layout:'habits',month:'2100-02'})).includes('29'));
 assert.ok(text(plannerProject({layout:'habits',undated:true})).includes('31'));
 assert.ok(!text(plannerProject({layout:'monthly',undated:true})).some(s=>/^\d+$/.test(s)));
});
