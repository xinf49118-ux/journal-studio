import test from 'node:test';
import assert from 'node:assert/strict';
import {DraftSaver} from '../web/js/draft.js';
import {validateBundle,restoreBundle} from '../web/js/backup.js';
import {templates,templateProject} from '../web/js/templates.js';
import {readFileSync} from 'node:fs';

const manifest=JSON.parse(readFileSync(new URL('../assets/materials/manifest.json',import.meta.url),'utf8'));
const materials=new Set(manifest.items.map(m=>m.id));
const bundle=()=>({format:'journal-studio-backup',version:1,project:templateProject(templates[0],manifest.items),assets:[]});

test('failed saves are retried for identical content, never marked saved',async()=>{
 let attempts=0;const states=[];const saver=new DraftSaver(async()=>({ok:++attempts>1}),s=>states.push(s));
 await assert.rejects(saver.save({a:1}));assert.equal(states.at(-1),'error');
 await saver.save({a:1});assert.equal(attempts,2);assert.equal(states.at(-1),'saved');
});
test('out-of-order network timing cannot overwrite latest draft',async()=>{
 const writes=[];const saver=new DraftSaver(async p=>{await new Promise(r=>setTimeout(r,p.n===1?20:0));writes.push(p.n);return {ok:true};});
 await Promise.all([saver.save({n:1}),saver.save({n:2})]);assert.deepEqual(writes,[1,2]);
});
test('all six templates resolve their real built-in art and valid geometry',()=>{
 for(const t of templates){const b={...bundle(),project:templateProject(t,manifest.items)};validateBundle(b,materials);assert.ok(b.project.layers.filter(l=>l.kind==='material').length>=3);}
});
test('reject malformed backups before importing any images',async()=>{
 const b=bundle();b.assets=[{id:'x',data:'https://example.com/private.png'}];let called=false;
 await assert.rejects(restoreBundle(b,()=>{called=true;},materials));assert.equal(called,false);
});
test('reject missing images, unknown built-ins, invalid coordinates and duplicate ids',()=>{
 for(const mutate of [b=>b.project.layers.push({id:'new',kind:'image',ref:'missing',x_mm:0,y_mm:0,w_mm:20,h_mm:20}),b=>b.project.layers[0].x_mm=Infinity,b=>b.project.layers.push({...b.project.layers[0]}),b=>b.project.background={type:'material',value:'missing'}]){
  const b=bundle();mutate(b);assert.throws(()=>validateBundle(b,materials));
 }
});
test('portable import remaps image references, preserves original and empty project',async()=>{
 const b=bundle();b.project.layers=[{id:'pic',kind:'image',ref:'old',x_mm:1,y_mm:2,w_mm:30,h_mm:20}];b.assets=[{id:'old',data:'data:image/png;base64,YQ=='}];
 const p=await restoreBundle(b,async()=> 'new',materials);assert.equal(p.layers[0].ref,'new');assert.equal(b.project.layers[0].ref,'old');
 const empty=bundle();empty.project.layers=[];assert.equal((await restoreBundle(empty,()=>{},materials)).layers.length,0);
});
test('collections retain decorative art plus 32 functional stickers in each theme',()=>{
 assert.equal(manifest.items.length,469);
 for(const c of manifest.collections){const items=manifest.items.filter(m=>m.collection===c.id);assert.equal(items.length,48);assert.equal(items.filter(m=>m.usage==='functional').length,32);assert.equal(new Set(items.map(m=>m.file)).size,48);for(const m of items)assert.ok(m.id.startsWith(m.cat+'_'));}
});
