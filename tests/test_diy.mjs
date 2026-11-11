import test from 'node:test';import assert from 'node:assert/strict';
import {validateDiy,diyPages} from '../web/js/diy.js';import {plannerProject} from '../web/js/planner.js';import {loadProject,state,PAGE_SIZES} from '../web/js/core.js';
const doc=()=>({format:'journal-studio-book',version:1,title:'我的手账',size:'A5',pages:[{id:'one',name:'月计划',bundle:{format:'journal-studio-backup',version:1,project:plannerProject({layout:'monthly',month:'2024-02'}),assets:[]}}]});
test('DIY backups reject malformed pages and missing image assets before restoration',()=>{
 const d=doc();assert.equal(validateDiy(d),d);
 for(const mutate of [d=>d.size='fake',d=>d.pages.push(structuredClone(d.pages[0])),d=>d.pages[0].bundle.project.layers.push({id:'bad',kind:'image',ref:'missing',x_mm:0,y_mm:0,w_mm:5,h_mm:5})]){const bad=doc();mutate(bad);assert.throws(()=>validateDiy(bad));}
});
test('DIY contents paginate and number every source page after reordering',()=>{
 const d=doc();d.pages=Array.from({length:23},(_,i)=>({...structuredClone(d.pages[0]),id:String(i),name:'第'+i+'页'}));d.pages.reverse();const snapshot=JSON.stringify(d),out=diyPages(d);assert.equal(out.length,25);assert.ok(out[0].layers.some(l=>l.text==='第22页'));assert.ok(out[0].layers.some(l=>l.text==='3'));assert.ok(out.at(-1).layers.some(l=>l.text==='25 / 25'));assert.equal(JSON.stringify(d),snapshot);
});
test('landscape pages fit within all four portrait book sizes and retain embedded assets',()=>{
 for(const size of ['A5','A6','B6','Weeks']){const d=doc();d.size=size;d.pages[0].bundle.project.page.orientation='landscape';d.pages[0].bundle.assets=[{id:'img',data:'data:image/png;base64,YQ=='}];const p=diyPages(d,{toc:false})[0],[w,h]=PAGE_SIZES[size];assert.equal(p.embeddedAssets.img,'data:image/png;base64,YQ==');assert.equal(p.page.orientation,'portrait');for(const l of p.layers)if(l.kind==='shape')assert.ok(l.x_mm+l.w_mm<=w&&l.y_mm+l.h_mm<=h);assert.equal(diyPages(d,{paper:'a4'})[0].page.size,'A4');}
});
test('opening another project clears DIY editing identity',()=>{loadProject({page:{size:'A5',diy_session:'session'},layers:[]});assert.equal(state.page.diy_session,'session');loadProject({page:{size:'A6'},layers:[]});assert.equal(state.page.diy_session,undefined);});
