import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {atelierLayouts} from '../web/js/atelier.js';import {plannerProject} from '../web/js/planner.js';import {validateBundle} from '../web/js/backup.js';
const m=JSON.parse(readFileSync(new URL('../assets/materials/manifest.json',import.meta.url))),ids=new Set(m.items.map(i=>i.id));
test('original page workflows remain editable, optional art and portable',()=>{
 for(const l of atelierLayouts){const p=plannerProject({layout:l.id,undated:true},m.items);validateBundle({format:'journal-studio-backup',version:1,project:p,assets:[]},ids);assert.ok(p.layers.filter(l=>l.kind==='shape').length>10);assert.ok(p.layers.filter(l=>l.kind==='text').length>7);assert.ok(!p.layers.some(l=>l.locked));assert.equal(p.layers.filter(l=>l.kind==='material').length,1);assert.ok(!p.layers.some(l=>l.text?.includes('2026')));const without=plannerProject({layout:l.id,undated:true},[]);assert.equal(without.layers.length,p.layers.length-1);}
 const text=id=>plannerProject({layout:'atelier_'+id,undated:true},m.items).layers.filter(l=>l.kind==='text').map(l=>l.text);
 assert.ok(text('parallel').includes('实际'));assert.ok(text('start').includes('最小动作'));assert.ok(text('senses').includes('闻到'));assert.ok(text('restore').includes('15 分钟'));assert.ok(text('meal').includes('下一餐怎么用？'));
});
test('original date labels follow month input and real week start across years',()=>{
 const texts=o=>plannerProject(o).layers.map(l=>l.text).filter(Boolean);
 assert.ok(texts({layout:'atelier_capacity',month:'2024-02',date:'bad'}).includes('2024-02'));
 assert.ok(texts({layout:'atelier_buffer',date:'2027-01-01',weekStart:0}).includes('本周起点 2026-12-27'));
 assert.throws(()=>plannerProject({layout:'atelier_parallel',date:'2026-02-29'}));
});
test('three coordinated collections have separately attributed illustration and native designs',()=>{
 const items=m.items.filter(i=>i.pack==='atelier-original');assert.equal(items.length,30);
 for(const theme of ['calm','collect','home']){const group=items.filter(i=>i.collection==='atelier_'+theme);assert.equal(group.filter(i=>i.cat==='stamp').length,6);assert.equal(group.filter(i=>i.cat==='sticker').length,4);assert.equal(group.filter(i=>i.author.includes('AI')).length,1);for(const i of group){assert.ok(!i.author.includes('品牌'));assert.ok(i.alpha);assert.ok(readFileSync(new URL('../assets/materials/'+i.file,import.meta.url)).length>2000);}}
});
