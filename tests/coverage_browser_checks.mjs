import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function coverageChecks(cdp,check,art){
 const before=await cdp.eval(`(async()=>JSON.stringify((await import('./web/js/core.js')).serializeProject()))()`);
 await cdp.eval(`document.querySelector('[data-tab="coverage"]').click()`);
 check('核查目录按实际数据展示，所有条目有来源与状态',await cdp.eval(`(async()=>{const {coverageEntries}=await import('./web/js/coverage-catalog.js');return document.querySelectorAll('.coverage-card').length===coverageEntries.length&&[...document.querySelectorAll('.coverage-card')].every(c=>c.querySelector('a[href^="https://"]')&&c.querySelector('.coverage-badge'))})()`));
 await cdp.eval(`document.querySelector('#coverage-brand').value='陌墨 MO.CARD';document.querySelector('#coverage-brand').dispatchEvent(new Event('change'))`);
 check('未核实的陌墨系列没有虚假的使用按钮',await cdp.eval(`document.querySelectorAll('.coverage-card').length>1&&[...document.querySelectorAll('.coverage-card')].every(c=>c.dataset.status==='unknown'&&!c.querySelector('button'))`));
 await cdp.eval(`document.querySelector('#coverage-clear').click();document.querySelector('#coverage-status').value='missing';document.querySelector('#coverage-status').dispatchEvent(new Event('change'))`);
 check('待补充筛选只显示真实缺口',await cdp.eval(`document.querySelectorAll('.coverage-card').length>0&&[...document.querySelectorAll('.coverage-card')].every(c=>c.dataset.status==='missing'&&!c.querySelector('button'))`));
 await cdp.eval(`document.querySelector('#coverage-clear').click();document.querySelector('#coverage-brand').value='MIDORI';document.querySelector('#coverage-status').value='ready';document.querySelector('#coverage-search').value='睡眠';document.querySelector('#coverage-search').dispatchEvent(new Event('input'))`);
 check('品牌、状态、关键词组合筛选准确',await cdp.eval(`document.querySelectorAll('.coverage-card').length===1&&document.querySelector('.coverage-card').textContent.includes('睡眠')`));
 writeFileSync(join(art,'coverage-desktop.png'),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await cdp.eval(`document.querySelector('.coverage-card button').click()`);await pause(450);
 check('核查表进入睡眠页预览且保护当前草稿',await cdp.eval(`document.querySelector('#planner-layout').value==='sleep_log'&&!document.querySelector('#apply-planner').disabled`)&&(await cdp.eval(`(async()=>JSON.stringify((await import('./web/js/core.js')).serializeProject()))()`))===before);
 await cdp.eval(`document.querySelector('[data-tab="coverage"]').click();document.querySelector('#coverage-clear').click();document.querySelector('#coverage-brand').value='kinbor';document.querySelector('#coverage-brand').dispatchEvent(new Event('change'))`);
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await pause(300);
 check('390px手机核查页没有横向溢出',await cdp.eval(`document.documentElement.scrollWidth<=innerWidth+1`));
 writeFileSync(join(art,'coverage-mobile.png'),Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await cdp.send('Emulation.clearDeviceMetricsOverride');
 check('可打印核查表与数据同步且明确不等于全部SKU',await cdp.eval(`(async()=>{const {coverageEntries}=await import('./web/js/coverage-catalog.js');const data=await(await fetch('./docs/coverage-data.json')).json();const html=await(await fetch('./docs/coverage.html')).text();return data.entries.length===coverageEntries.length&&html.includes('81 种可编辑内页')&&html.includes('无法计算')&&html.includes('?layout=sleep_log')})()`));
 await cdp.eval(`document.querySelector('[data-tab="works"]').click()`);
}
