import test from 'node:test';import assert from 'node:assert/strict';
import {designElement,designBox,elementTypes} from '../web/js/design-elements.js';import {tableMerges,advancedTypes} from '../web/js/advanced-elements.js';import {sectorPoints} from '../web/js/radial-geometry.js';import {validateBundle} from '../web/js/backup.js';
test('radial timelines contain exact independent cells with configurable clock, spacing and rotation',()=>{
 assert.equal(Object.keys(elementTypes).length,72);assert.equal(Object.keys(advancedTypes).length,14);
 for(const cycleHours of [12,24])for(const stepMinutes of [15,30,60,120]){const layers=designElement({type:'radial',cycleHours,stepMinutes,rotationOffset:45,startHour:6}),cells=layers.filter(l=>l.shape==='sector');assert.equal(cells.length,cycleHours*60/stepMinutes);assert.equal(cells[0].start_deg,45);assert.equal(cells.at(-1).end_deg,405);assert.equal(cells[0].name,'06:00');assert.ok(cells.every(l=>l.inner_ratio>0&&l.fill==='#ffffff00'));}
 assert.throws(()=>designElement({type:'radial',stepMinutes:70}));
 const timeline=designElement({type:'timeline',startHour:23.5,stepMinutes:30,rows:3});assert.deepEqual(timeline.filter(l=>l.kind==='text').map(l=>l.text),['23:30','00:00','00:30']);assert.equal(timeline[0].design_config.options.startHour,23.5);assert.equal(timeline[0].design_config.options.stepMinutes,30);assert.throws(()=>designElement({type:'timeline',startHour:'invalid'}));
});
test('monthly rings and yearly grids distinguish leap years and absent dates',()=>{
 for(const [month,days] of [['2024-02',29],['2100-02',28],['2026-04',30],['2026-01',31]])assert.equal(designElement({type:'radial_habits',month,rings:3}).filter(l=>l.shape==='sector').length,days*3);
 for(const [year,days] of [[2024,366],[2100,365]]){const layers=designElement({type:'year_pixels',year});assert.equal(layers.filter(l=>l.design_role==='cell').length,days);assert.equal(layers.filter(l=>l.design_role==='disabled-cell').length,372-days);}
 assert.throws(()=>designElement({type:'radial_habits',month:'2026-13'}));
});
test('merged tables remove interior edges, retain separate editable cells and reject overlapping ranges',()=>{
 const layers=designElement({type:'custom_table',x:10,y:20,w:100,h:60,rows:2,cols:2,merges:'1,1,1,2'});assert.equal(layers.filter(l=>l.design_role==='cell').length,3);
 const vertical=layers.filter(l=>l.kind==='shape'&&Math.abs(l.rotate||0)>80).map(l=>designBox(l));assert.ok(vertical.some(b=>Math.abs(b.x-60)<.2&&b.h<31));assert.ok(!vertical.some(b=>Math.abs(b.x-60)<.2&&b.h>50));
 for(const s of ['1,1,1,2\n1,2,1,1','2,2,2,2','x,1,1,1','0,1,1,1'])assert.throws(()=>tableMerges(s,2,2));
});
test('all advanced structures preserve parameters and fit the backup contract; 15-minute grids remain bounded',()=>{
 for(const type of Object.keys(advancedTypes)){const layers=designElement({type,month:'2024-02',year:2024});assert.ok(layers[0].design_config&&layers[0].design_config.count===layers.length);validateBundle({format:'journal-studio-backup',version:1,assets:[],project:{page:{size:'A5',orientation:'portrait'},background:{type:'color',value:'#fff'},layers}});}
 assert.equal(designElement({type:'time_blocks',stepMinutes:15}).filter(l=>l.design_role==='cell').length,96*7);
});
test('sector geometry stays normalized and malformed sector backups fail before restoration',()=>{
 for(const l of designElement({type:'radial',cycleHours:24}).filter(l=>l.shape==='sector'))assert.ok(sectorPoints(l).every(p=>p.every(v=>v>=0&&v<=1)));
 assert.throws(()=>sectorPoints({start_deg:10,end_deg:0,inner_ratio:.5}));const project={page:{size:'A5',orientation:'portrait'},background:{type:'color',value:'#fff'},layers:designElement({type:'radial'})};project.layers[0].inner_ratio=2;assert.throws(()=>validateBundle({format:'journal-studio-backup',version:1,assets:[],project}));
});
