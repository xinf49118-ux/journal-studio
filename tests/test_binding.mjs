import test from 'node:test';import assert from 'node:assert/strict';
import {customSize,holePositions,bindingPage,imposePages} from '../web/js/print-layout.js';
import {fitProject} from '../web/js/page-fit.js';import {pageDims} from '../web/js/core.js';import {validateDiy,diyPages} from '../web/js/diy.js';import {validateBundle} from '../web/js/backup.js';
const page=n=>({page:{size:'A6',orientation:'portrait',dpi:300,bleed_mm:0,crop_marks:false},background:{type:'color',value:'#fff'},layers:[{id:'T',kind:'text',text:String(n),x_mm:10,y_mm:10,size_mm:4}],embeddedAssets:{photo:'data:image/png;base64,YQ=='}});
test('booklet imposition reconstructs every logical page from folded front/back sheet pairs',()=>{
 for(let count=1;count<=25;count++){const input=Array.from({length:count},(_,i)=>page(i+1)),snapshot=JSON.stringify(input),out=imposePages(input,'booklet'),n=Math.ceil(count/4)*4;
  assert.equal(out.length,n/2);const order=out.map(p=>p.layers.filter(l=>l.kind==='text').map(l=>Number(l.text)));const values=order.flat().sort((a,b)=>a-b);assert.deepEqual(values,Array.from({length:count},(_,i)=>i+1));
  for(let i=0;i<n/4;i++){assert.deepEqual(order[2*i],[n-2*i,1+2*i].filter(v=>v<=count));assert.deepEqual(order[2*i+1],[2+2*i,n-1-2*i].filter(v=>v<=count));}assert.equal(JSON.stringify(input),snapshot);
 }
 assert.equal(imposePages([{...page(1),page:{size:'A5',orientation:'portrait'}}],'booklet')[0].page.size,'A3');
});
test('duplex padding and hole guides mirror the binding edge without stretching content',()=>{
 const opt={holes:'six',gap:19,groupGap:70,edge:8,diameter:5},p=page(1),a=bindingPage(p,opt),b=bindingPage(p,opt,true);
 const front=a.layers.filter(l=>l.shape==='ellipse'),back=b.layers.filter(l=>l.shape==='ellipse');assert.equal(front.length,6);assert.deepEqual(front.map(l=>l.y_mm),back.map(l=>l.y_mm));assert.ok(front.every(l=>l.x_mm<10)&&back.every(l=>l.x_mm>90));
 assert.equal(imposePages([p,p,p],'a4-duplex',opt).length,4);assert.throws(()=>imposePages([p],'booklet',opt));
 assert.throws(()=>holePositions(90,opt));assert.throws(()=>holePositions(148,{holes:'custom',offsets:'0,0'}));assert.equal(holePositions(148,{holes:'two'}).length,2);
});
test('custom dimensions survive backup, fitting, contents and A4 printing; invalid dimensions fail early',()=>{
 const target=customSize('Custom',120.5,180.5),p=fitProject(page(1),target),bundle={format:'journal-studio-backup',version:1,project:p,assets:[]};assert.deepEqual(pageDims(p.page),[120.5,180.5]);validateBundle(bundle);
 const d={format:'journal-studio-book',version:1,title:'自定义',size:'Custom',width_mm:120.5,height_mm:180.5,pages:[{id:'one',name:'页面',bundle}]};validateDiy(d);assert.deepEqual(pageDims(diyPages(d)[1].page),[120.5,180.5]);assert.equal(imposePages(diyPages(d),'a4')[0].page.size,'A4');
 for(const dims of [[0,180],[220,180],[120,400],[180,120],[NaN,180]])assert.throws(()=>customSize('Custom',...dims));
 assert.throws(()=>imposePages([{...page(1),page:{size:'Custom',w_mm:210,h_mm:297}}],'a4-duplex'));
});
test('imposition keeps independent embedded images when both source pages reuse an asset ID',()=>{
 const a=page(1),b=page(2);a.layers.push({id:'I',kind:'image',ref:'photo',x_mm:10,y_mm:30,w_mm:5,h_mm:5});b.layers.push({...a.layers[1]});b.embeddedAssets.photo='data:image/png;base64,Yg==';const out=imposePages([a,b],'booklet');const photos=out.flatMap(p=>p.layers.filter(l=>l.kind==='image').map(l=>p.embeddedAssets[l.ref]));assert.deepEqual(photos.sort(),['data:image/png;base64,YQ==','data:image/png;base64,Yg=='].sort());
});
