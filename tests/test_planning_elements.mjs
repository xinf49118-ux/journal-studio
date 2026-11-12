import test from 'node:test';import assert from 'node:assert/strict';
import {planningSpecs,planningTypes,planningExample,planningDate,planningValues,planningLinks} from '../web/js/planning-elements.js';
import {designElement,elementTypes} from '../web/js/design-elements.js';
import {validateBundle} from '../web/js/backup.js';
const texts=layers=>layers.filter(l=>l.kind==='text').map(l=>l.text);
const cells=layers=>layers.filter(l=>l.design_role==='cell');

test('47 additional components cover 12 purposes and remain editable portable layers with regenerable inputs',()=>{
 assert.equal(Object.keys(planningTypes).length,47);assert.equal(new Set(Object.values(planningSpecs).map(s=>s.category)).size,12);assert.equal(Object.keys(elementTypes).length,72);
 for(const type of Object.keys(planningTypes))for(const direction of ['horizontal','vertical']){
  const options={...planningExample(type),direction},layers=designElement(options);assert.ok(layers.length>5&&layers.length<=900,type);assert.equal(new Set(layers.map(l=>l.id)).size,layers.length);assert.equal(new Set(layers.map(l=>l.group_id)).size,1);
  validateBundle({format:'journal-studio-backup',version:1,assets:[],project:{page:{size:'A5',orientation:'portrait'},background:{type:'color',value:'#fff'},layers}});
  const restored=designElement(JSON.parse(JSON.stringify(layers[0].design_config.options)));assert.equal(restored.length,layers.length);assert.deepEqual(texts(restored),texts(layers));
  assert.ok(layers.every(l=>l.kind==='shape'||l.kind==='text'));assert.equal(layers[0].design_config.count,layers.length);
 }
});

test('graph connections reject malformed and cyclic dependencies, while relation maps allow cycles',()=>{
 assert.throws(()=>planningLinks('1,1',3));assert.throws(()=>planningLinks('1,4',3));assert.throws(()=>planningLinks('1,2\n1,2',3));assert.throws(()=>planningLinks('1,2\n2,1',3,{acyclic:true}));
 const l=designElement({type:'goal_tree',rowLabels:'目标\n行动一\n行动二',links:'1,2\n1,3'});assert.ok(texts(l).includes('行动二'));
 assert.throws(()=>designElement({type:'dependencies',rows:3,links:'1,2\n2,3\n3,1'}));
 assert.doesNotThrow(()=>designElement({type:'relationship_map',rows:3,links:'1,2\n2,3\n3,1'}));
});

test('weighted decisions calculate complete columns and never assign a score to missing values',()=>{
 const base={type:'decision_matrix',rowLabels:'成本\n质量',colLabels:'A\nB',target:10};
 const a=texts(designElement({...base,values:'2,6,9\n3,9,6'}));assert.ok(a.includes('7.8'));assert.ok(a.includes('7.2'));
 const b=texts(designElement({...base,values:'2,6,9\n3,,6'}));assert.ok(b.includes('未填全'));assert.ok(b.includes('7.2'));assert.ok(!b.includes('2.4'));
 assert.throws(()=>designElement({...base,values:'-1,6,9\n3,9,6'}));assert.throws(()=>designElement({...base,values:'1,11,9'}));
 assert.ok(texts(designElement({...base,values:'0,6,9\n0,9,6'})).includes('权重为0'));
});

test('sleep bands preserve overnight duration, midnight starts and unknown records',()=>{
 const base={type:'sleep_band',rows:3,values:'23,8\n0,7\n,'},l=designElement(base),bars=cells(l).filter(l=>l.fill!=='#ffffff00');assert.equal(bars.length,3);
 const first=bars.filter(l=>l.design_label.startsWith('睡眠1'));assert.equal(first.length,2);assert.ok(Math.abs(first.reduce((sum,l)=>sum+l.w_mm,0)-100*8/24)<.001);
 assert.throws(()=>designElement({...base,values:'23,'}));assert.throws(()=>designElement({...base,values:'24,8'}));assert.throws(()=>designElement({...base,values:'23,0'}));
});

test('record charts distinguish zero from unknown, and invalid or extra input is rejected',()=>{
 assert.deepEqual(planningValues('0,,3\n'),[[0,null,3],[null]]);assert.throws(()=>planningValues('not a number'));
 const grid=cells(designElement({type:'energy_map',rows:1,cols:3,values:'0,,10'}));assert.equal(grid.length,3);assert.equal(grid.filter(l=>l.design_label==='未记录').length,1);assert.notEqual(grid[0].fill,'#ffffff00');
 const curve=designElement({type:'mood_curve',rows:3,values:'0\n\n10'});assert.equal(cells(curve).length,2);
 assert.throws(()=>designElement({type:'mood_curve',rows:1,values:'1,2'}));assert.throws(()=>designElement({type:'energy_map',rows:1,cols:1,values:'-1'}));
 assert.throws(()=>designElement({type:'retro',rows:1,values:'一,二,三,多余内容'}));
});

test('date layouts handle leap years and UTC month boundaries with real dates and reverse countdowns',()=>{
 assert.throws(()=>planningDate('2026-02-29'));assert.throws(()=>planningDate('2100-02-29'));assert.throws(()=>planningDate('2026-13-01'));
 assert.equal(cells(designElement({type:'bill_calendar',month:'2024-02'})).length,29);assert.equal(cells(designElement({type:'publish_calendar',month:'2100-02'})).length,28);
 assert.throws(()=>designElement({type:'bill_calendar',month:'2026-02',rowLabels:'29:到期'}));
 const count=texts(designElement({type:'countdown',startDate:'2026-12-31',periodDays:3,cols:3}));assert.ok(count.includes('1/1'));assert.ok(count.includes('D-2'));assert.ok(count.includes('D0'));
 const review=texts(designElement({type:'spaced_review',startDate:'2024-02-28',rows:1,values:'1,2'}));assert.ok(review.includes('2/29'));assert.ok(review.includes('3/1'));
});

test('budgets, debt, points and savings use actual supplied values with explicit incomplete totals',()=>{
 assert.ok(texts(designElement({type:'budget_actual',rows:1,values:'100,120'})).includes('-20'));
 assert.ok(texts(designElement({type:'debt_plan',rows:1,values:'1000,200'})).includes('800'));
 assert.throws(()=>designElement({type:'debt_plan',rows:1,values:'100,120'}));
 assert.ok(texts(designElement({type:'habit_points',rows:1,values:'3,2'})).includes('总积分 6'));
 assert.ok(texts(designElement({type:'budget_actual',rows:2,values:'100,80'})).some(s=>s.includes('未填项')));
 const filled=cells(designElement({type:'savings_grid',rows:10,cols:10,progress:35})).filter(l=>l.fill!=='#ffffff00');assert.equal(filled.length,35);
});

test('ring areas reflect numeric allocation while empty input generates an editable blank diagram',()=>{
 const sectors=designElement({type:'time_ring',colLabels:'A\nB\nC',values:'1,2,3'}).filter(l=>l.shape==='sector');assert.equal(sectors.length,3);assert.ok(Math.abs(sectors[0].end_deg-60)<.001);assert.ok(Math.abs(sectors.at(-1).end_deg-360)<.001);
 assert.throws(()=>designElement({type:'time_ring',cols:3,values:'0,0,0'}));assert.throws(()=>designElement({type:'habit_wheel',periodDays:63}));assert.throws(()=>designElement({type:'habit_chain',periodDays:121}));
 assert.equal(cells(designElement({type:'pomodoro',rows:1,cols:4,values:'0'})).filter(l=>l.fill!=='#ffffff00').length,0);
});
