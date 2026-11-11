import test from 'node:test';import assert from 'node:assert/strict';
import {changeBook,reorderPages,readingSpreads,printSpreads} from '../web/js/book-history.js';
const doc=n=>({title:'我的手账',pages:Array.from({length:n},(_,i)=>({id:String(i),name:'第'+i+'页',bundle:{assets:[{id:'img',data:'data:image/png;base64,YQ=='}]}}))});
test('undo, redo and restore preserve photos, and editing after undo clears redo',()=>{
 const first=changeBook(null,doc(3));first.id='book';const second=changeBook(first,doc(2)),third=changeBook(second,doc(1)),undo=changeBook(third,third.doc,{mode:'undo'});
 assert.equal(undo.doc.pages.length,2);assert.equal(undo.history.future.length,1);assert.equal(undo.doc.pages[0].bundle.assets[0].data,'data:image/png;base64,YQ==');
 assert.equal(changeBook(undo,undo.doc,{mode:'redo'}).doc.pages.length,1);
 const restored=changeBook(third,third.doc,{mode:'restore',index:0});assert.equal(restored.doc.pages.length,3);assert.equal(changeBook(restored,restored.doc,{mode:'undo'}).doc.pages.length,1);
 assert.equal(changeBook(undo,doc(4)).history.future.length,0);assert.equal(first.doc.pages.length,3);
});
test('history keeps bounded steps and rejects unavailable versions',()=>{
 let record=changeBook(null,doc(1));for(let n=2;n<30;n++)record=changeBook(record,doc(n));assert.equal(record.history.past.length,12);assert.throws(()=>changeBook(record,record.doc,{mode:'restore',index:99}));assert.throws(()=>changeBook(null,doc(1),{mode:'undo'}));
});
test('multi-page moves preserve original order and reject stale targets',()=>{
 const pages=doc(5).pages,snapshot=JSON.stringify(pages);assert.deepEqual(reorderPages(pages,['3','1'],'0').map(p=>p.id),['1','3','0','2','4']);assert.deepEqual(reorderPages(pages,['1','2'],null).map(p=>p.id),['0','3','4','1','2']);assert.equal(JSON.stringify(pages),snapshot);assert.throws(()=>reorderPages(pages,['missing']));assert.throws(()=>reorderPages(pages,['1'],'missing'));
});
test('reading and print navigation covers every page, odd cover and blank positions',()=>{
 for(let n=0;n<30;n++){for(const pairs of [readingSpreads(n),printSpreads(n,'native'),printSpreads(n,'booklet')])assert.deepEqual(pairs.flat().filter(v=>v!==null),Array.from({length:n},(_,i)=>i));}
 assert.deepEqual(readingSpreads(4),[[null,0],[1,2],[3,null]]);assert.deepEqual(printSpreads(4,'a4-duplex'),[[0,1],[2,3]]);
});
