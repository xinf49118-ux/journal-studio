"""Official source links only. Never copies personal-use brand files to the site."""
from pathlib import Path
from html import escape
import json
root=Path(__file__).resolve().parents[1]
rows=[
 ('KING JIM / HITOTOKI','设计纸①','剪贴设计纸','个人下载已核实','https://www.kingjim.co.jp/download/other/hitotoki/','官方A4设计纸，可用标签纸打印；限个人使用，禁止擅自转载。'),
 ('KING JIM / HITOTOKI','设计纸②','剪贴设计纸','个人下载已核实','https://www.kingjim.co.jp/download/other/hitotoki/','官方A4设计纸，搭配KITTA使用；不是KITTA全部商品图案。'),
 ('KING JIM / KITTA','moogy×KITTA','剪贴设计纸','个人下载已核实','https://www.kingjim.co.jp/download/other/kitta/','官方提供手账剪贴的PDF文件；内容是联名特别下载设计，不代表当前所有在售款。'),
 ('MIDORI','贴纸与印章','贴纸／印章','未确认原版电子文件','https://www.midori-store.net/SHOP/183572/list.html','已核对官方实物印章目录，尚未取得可导入的原版电子印面。'),
 ('BGM','贴纸、胶带、透明印章','贴纸／印章','未确认原版电子文件','https://www.bgmlife.jp/products/','官网有碎片贴、透明贴和透明印章等分类，商品展示未计为已加入素材。'),
 ('Mind Wave','角色与主题贴纸','贴纸','未确认原版电子文件','https://www.mindwave-store.com/c/all/seal','官方贴纸目录；未把角色商品图片作为可下载贴纸包。'),
 ('KODOMO NO KAO','手账用印章','印章','未确认原版电子文件','https://www.kodomonokao.com/','已核对品牌与官方商店介绍；未取得原版印面下载文件。'),
 ('Shachihata','装饰印章与印台','印章','未确认原版电子文件','https://www.shachihata.jp/products/list.php?category_id=11480','已核对官方商品入口；数字集章服务不等同可导出的手账印章图。'),
 ('bande','逐枚剥取卷装贴纸','贴纸','未确认原版电子文件','https://bande.ne.jp/?mode=f3','官方目录有花、动物、食物、人物等；未取得整套电子贴纸。'),
 ('古川纸工','和纸碎片贴纸','贴纸','未确认原版电子文件','https://www.furukawashiko-online.shop/c/furukawa-product/item-fp/flakesticker-fp','已核对官方碎片贴纸目录，未取得原版电子图案包。'),
 ('mt / KAMOI','纸胶带','胶带','本轮连接超时','https://shop.masking-tape.jp/','保留此前官方入口，本轮页面连接超时，不推定电子素材可取得。')
]
data={'checked':'2026-11-13','personal_download_sheets_verified':3,'publicly_bundled_brand_artwork':0,'included_original_stamp_files':0,'entries':[dict(zip(['brand','name','kind','status','source','note'],r)) for r in rows]}
(root/'docs/brand-original-data.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
cards=''.join(f'<article><p>{escape(r[0])} · {escape(r[2])}</p><h2>{escape(r[1])}</h2><strong>{escape(r[3])}</strong><p>{escape(r[5])}</p><a href="{escape(r[4])}" target="_blank" rel="noopener noreferrer">打开官方来源 ↗</a></article>' for r in rows)
html=f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>品牌原版贴纸与印章 · 手账工坊</title><style>body{{margin:0;background:#f6f2eb;color:#4b5048;font:15px/1.8 system-ui}}main{{max-width:1180px;margin:auto;padding:24px 18px}}a{{color:#55785e}}h1{{font-weight:500}}section{{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}}article{{min-width:0;padding:18px;background:white;border:1px solid #ded8cb;border-radius:12px}}article[hidden]{{display:none}}h2{{font-size:19px}}input{{max-width:90%;padding:10px;font:inherit}}.note{{padding:16px;background:#ece4d6;border-radius:10px}}strong{{font-size:14px}}</style><main><p>手账工坊 · 2026-11-13核对</p><h1>品牌原版贴纸与印章</h1><p>这里查找品牌官方原版文件。工坊内置的369张贴纸、103枚印章未计作这些品牌的原版素材。</p><div class="note"><b>已落实：KING JIM／HITOTOKI／KITTA 的3份原版剪贴设计纸，可从官方页面个人下载。</b><p>公开站点只提供官方入口。个人使用文件不打包到公共GitHub素材库；请在官方页面点击下载按钮并阅读使用说明。其余条目目前是商品目录，尚未取得可导入的原版电子图案。品牌原版印面文件当前为0份。</p></div><p><a href="../?tab=library">打开素材库导入自己的原版PNG</a> · <a href="../?tab=editor">打开裁切与印章工坊</a> · <a href="brand-original-data.json">核查数据</a></p><p>取得可使用的PNG／JPG后，在“素材库→导入自己的素材”导入，再加入画布。整页图可以用局部裁切选取所需部分；原版印章图可换墨色或调整缺墨效果。PDF应直接打印，或先转换成图片再导入。页面上的品牌入口本身不会自动导入素材。</p><label>搜索品牌或类型 <input id="search" placeholder="例如：MIDORI、印章、贴纸"></label><p id="count" role="status"></p><section>{cards}</section><script>const q=document.querySelector('#search'),cards=[...document.querySelectorAll('article')];q.oninput=()=>{{let n=0;for(const card of cards){{card.hidden=!card.textContent.toLowerCase().includes(q.value.toLowerCase().trim());if(!card.hidden)n++;}}document.querySelector('#count').textContent='显示 '+n+' / '+cards.length+' 项官方来源';}};q.oninput();</script></main></html>'''
(root/'docs/brand-original.html').write_text(html,encoding='utf-8')
print(json.dumps({'source_entries':len(rows),'verified_personal_download_sheets':3,'original_stamp_files':0}))
