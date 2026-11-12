import test from 'node:test';import assert from 'node:assert/strict';
import {elementTypes,designElement,designLine,designBounds,alignDesign} from '../web/js/design-elements.js';import {validateBundle} from '../web/js/backup.js';
test('every structural element is editable, grouped, unique and portable without external assets',()=>{
 for(const type of Object.keys(elementTypes))for(const dashed of [false,true]){const layers=designElement({type,x:12,y:40,w:100,h:60,dashed});assert.ok(layers.length&&layers.length<=900);assert.equal(new Set(layers.map(l=>l.id)).size,layers.length);assert.equal(new Set(layers.map(l=>l.group_id)).size,1);validateBundle({format:'journal-studio-backup',version:1,assets:[],project:{page:{size:'A5',orientation:'portrait'},background:{type:'color',value:'#ffffff'},layers}});}
 for(const o of [{type:'bad'},{type:'dots',gap:1,w:200,h:200},{stroke:0},{rows:2.5},{cols:21}])assert.throws(()=>designElement(o));
});
test('diagonal line endpoints and visual bounding boxes survive reversed drags',()=>{
 for(const p of [[10,20,60,90],[60,90,10,20],[20,20,20,100],[20,100,100,20]]){const b=designBounds(designLine(...p,{stroke:.2}));assert.ok(Math.abs(b.x-Math.min(p[0],p[2]))<.2);assert.ok(Math.abs(b.y-Math.min(p[1],p[3]))<.2);assert.ok(Math.abs(b.w-Math.abs(p[0]-p[2]))<.3);assert.ok(Math.abs(b.h-Math.abs(p[1]-p[3]))<.3);}
 assert.throws(()=>designLine(0,0,0,0));assert.throws(()=>designLine(0,0,10,10,{stroke:-1}));
});
test('alignment treats modules as rigid groups and equal spacing preserves sizes',()=>{
 const groups=[designElement({type:'frame',x:10,y:10,w:20,h:20}),designElement({type:'frame',x:50,y:30,w:20,h:20}),designElement({type:'frame',x:100,y:80,w:20,h:20})],layers=groups.flat();alignDesign(layers,'top');assert.ok(groups.every(g=>Math.abs(designBounds(g).y-designBounds(groups[0]).y)<.001));alignDesign(layers,'distribute-x');const boxes=groups.map(g=>designBounds(g));assert.ok(Math.abs((boxes[1].x-boxes[0].x-boxes[0].w)-(boxes[2].x-boxes[1].x-boxes[1].w))<.001);const group=designBounds(groups[0]);assert.ok(Math.abs(group.w-20)<1);assert.throws(()=>alignDesign(groups[0],'distribute-x'));
});
