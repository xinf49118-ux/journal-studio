import {writeFileSync} from 'node:fs';import {join} from 'node:path';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function managerChecks(cdp,check,art){
 await cdp.send('Page.navigate',{url:(await cdp.eval('location.href.split("?")[0]'))+'?tool=diy'});await pause(2300);
 const click=async id=>{await cdp.eval(`document.querySelector('#diy-${id}').click()`);await pause(500);};
 const change=async(id,value)=>{await cdp.eval(`document.querySelector('#diy-${id}').value=${JSON.stringify(value)};document.querySelector('#diy-${id}').dispatchEvent(new Event('change'))`);await pause(400);};
 check('未编辑整册页面时不显示保存回册按钮',await cdp.eval(`document.querySelector('#diy-return').hidden&&document.querySelector('#diy-discard').hidden`));
 await change('template','daily');await click('add');for(let i=0;i<4;i++)await click('copy');
 check('五页均显示真实缩略图',await cdp.eval(`document.querySelectorAll('.diy-thumb').length===5&&[...document.querySelectorAll('.diy-thumb img')].every(i=>i.naturalWidth>0)`));
 await cdp.eval(`window.confirm=()=>true`);await click('delete');check('整册删除可撤销',await cdp.eval(`document.querySelector('#diy-page').options.length===4&&!document.querySelector('#diy-undo-book').disabled`));
 await click('undo-book');check('整册撤销恢复删除页',await cdp.eval(`document.querySelector('#diy-page').options.length===5`));await click('redo-book');check('整册重做恢复删除操作',await cdp.eval(`document.querySelector('#diy-page').options.length===4`));
 await cdp.send('Page.reload');await pause(2200);await click('undo-book');check('刷新后仍可撤销上次删除',await cdp.eval(`document.querySelector('#diy-page').options.length===5`));
 await cdp.eval(`window.confirm=()=>true;document.querySelector('#diy-versions').value='0'`);await click('restore-book');check('可恢复早期历史版本',await cdp.eval(`document.querySelector('#diy-page').options.length===0`));await click('undo-book');check('恢复历史本身也可撤销',await cdp.eval(`document.querySelector('#diy-page').options.length===5`));
 const drag=await cdp.eval(`(()=>{const a=[...document.querySelectorAll('.diy-thumb')],ids=a.map(p=>p.dataset.pageId),data=new DataTransfer();a[0].dispatchEvent(new DragEvent('dragstart',{dataTransfer:data,bubbles:true}));a[3].dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true}));return ids;})()`);await pause(800);
 check('拖动缩略图真正改变整册顺序',await cdp.eval(`(async()=>{const b=await import('./web/js/backup.js');const d=(await b.shelf('list')).find(r=>r.kind==='book').doc;return d.pages[2].id===${JSON.stringify(drag[0])}&&d.pages[0].id===${JSON.stringify(drag[1])};})()`));
 await cdp.eval(`for(const e of [...document.querySelectorAll('.diy-thumb input')].slice(0,2)){e.checked=true;e.dispatchEvent(new Event('change'));}`);await click('batch-copy');check('多选可批量复制',await cdp.eval(`document.querySelector('#diy-page').options.length===7`));
 await click('batch-delete');check('多选可批量删除且能撤销',await cdp.eval(`document.querySelector('#diy-page').options.length===5`));await click('undo-book');
 await cdp.eval(`document.querySelector('#diy-review').open=true`);await pause(700);
 check('阅读预览从右侧封面开始',await cdp.eval(`document.querySelectorAll('#diy-review-pages img').length===1&&document.querySelector('#diy-review-pages figure:last-child img').naturalWidth>0`));
 await click('review-next');check('阅读预览可以翻到左右两页',await cdp.eval(`document.querySelectorAll('#diy-review-pages img').length===2&&document.querySelector('#diy-review-position').value==='1'`));
 await change('paper','a4-duplex');await click('proof');check('双面预览可查看第一张纸正反面',await cdp.eval(`document.querySelector('#diy-review-caption').textContent.includes('PDF输出一致')&&document.querySelectorAll('#diy-review-pages img').length===2&&document.querySelector('#diy-review-pages').textContent.includes('背面')`));
 const count=await cdp.eval(`document.querySelector('#diy-review-position').options.length`);await change('review-position',String(count-1));check('打印预览可以跳到最后一张纸',await cdp.eval(`document.querySelector('#diy-review-position').value===${JSON.stringify(String(count-1))}&&document.querySelector('#diy-review-next').disabled`));
 await cdp.eval(`document.querySelector('#diy-review').scrollIntoView({block:'start'})`);await pause(200);
 writeFileSync(join(art,'manager-desktop.png'),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
 // Revision checks run in an IndexedDB transaction, preventing stale browser windows from overwriting.
 const concurrency=await cdp.eval(`(async()=>{const b=await import('./web/js/backup.js'),{changeBook}=await import('./web/js/book-history.js');const r=(await b.shelf('list')).find(r=>r.kind==='book'),one=changeBook(r,{...r.doc,title:'来自另一个窗口'});await b.commitBook(one,r.revision);try{await b.commitBook(changeBook(r,{...r.doc,title:'旧窗口'}),r.revision);return false;}catch(e){return e.message.includes('其他窗口');}})()`);check('旧窗口无法覆盖其他窗口的新版本',concurrency);
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await pause(350);await cdp.eval(`document.querySelector('#diy-thumbnails').scrollIntoView({block:'start'})`);
 check('手机缩略图和跨页预览无横向溢出',await cdp.eval('document.documentElement.scrollWidth<=innerWidth+1'));
 writeFileSync(join(art,'manager-mobile.png'),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'));await cdp.send('Emulation.clearDeviceMetricsOverride');
}

export async function managerVisual(cdp,check,art){
 await cdp.send('Page.navigate',{url:(await cdp.eval('location.href.split("?")[0]'))+'?tool=diy'});await pause(2000);
 await cdp.eval(`(async()=>{const {bookPlan}=await import('./web/js/book.js');document.dispatchEvent(new CustomEvent('book-to-diy',{detail:bookPlan({type:'monthly',notes:0})}));})()`);await pause(1200);
 await cdp.eval(`document.querySelector('#diy-review').open=true`);await pause(500);
 const bounds=await cdp.eval(`(()=>{const e=document.querySelector('#diy-review');e.scrollIntoView({block:'start'});return {open:e.open,parent:e.closest('#diy-builder').open,tab:document.querySelector('#tab-works').classList.contains('active'),rect:e.getBoundingClientRect().toJSON()};})()`);await pause(700);
 check('完整阅读预览实际可见',bounds.open&&bounds.parent&&bounds.tab&&bounds.rect.top>=0&&bounds.rect.top<500,JSON.stringify(bounds));
 writeFileSync(join(art,'manager-preview-visible.png'),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
}
