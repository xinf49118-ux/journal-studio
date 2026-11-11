"""Original diary/travel stationery in the existing six palettes; idempotent."""
from pathlib import Path
import json
from PIL import Image, ImageDraw
from expand_materials import THEMES
from make_materials import get_font, draw_text_center
ROOT=Path(__file__).resolve().parents[1]/'assets/materials'
SPECS=[('ticket','旅行票根','sticker'),('luggage','行李吊牌','sticker'),('postmark','旅行邮戳','stamp'),('frame','留白相框','frame'),('film','三格胶片框','frame'),('postcard','旅行明信片','sticker'),('tape','照片固定胶带','tape'),('bubble','心情对话框','sticker'),('label','地点日期标签','title'),('coffee','咖啡探店卡','sticker'),('story','今日故事','title'),('moment','值得记住','title'),('journey','旅途片刻','title'),('thanks','今日小确幸','title'),('route','出发与抵达','sticker'),('stampbox','集章留白框','frame')]

def artwork(kind,label,ink,accent,cream):
    w,h=(760,240) if kind in ('tape','label','story','moment','journey','thanks') else (760,500)
    im=Image.new('RGBA',(w,h));d=ImageDraw.Draw(im)
    def line(p,width=4):d.line(p,fill=ink,width=width)
    def text(s,x,y,n=32):draw_text_center(d,x,y,s,get_font(n),ink)
    def rect(b,fill=cream,r=14):d.rounded_rectangle(b,radius=r,fill=fill,outline=ink,width=4)
    if kind=='frame':
        rect((20,20,740,480));d.rectangle((49,49,711,383),fill=(0,0,0,0));text('把这一刻留下',380,437)
    elif kind=='film':
        rect((20,65,740,435),ink)
        for i in range(3):d.rectangle((45+i*238,117,258+i*238,383),fill=(0,0,0,0))
        for x in range(43,720,42):
            for y in (80,403):d.rectangle((x,y,x+20,y+15),fill=cream)
    elif kind=='postmark':
        d.ellipse((155,25,605,475),fill=cream,outline=ink,width=6);d.ellipse((176,46,584,454),outline=ink,width=3)
        text('旅 途 留 念',380,132,44);line([(210,190),(550,190)]);text('__________',380,250,38);text('JOURNAL STUDIO',380,345,27)
    elif kind=='ticket':
        rect((20,45,740,455));d.rectangle((38,65,722,146),fill=accent);text('一段旅程 · 一份回忆',380,107,38)
        for y in range(160,430,24):line([(555,y),(555,y+12)],3)
        text('出发：__________',275,218);text('抵达：__________',275,303);text('日期：__________',275,389);text('收藏',645,270,40)
        for x in (20,740):d.ellipse((x-18,233,x+18,269),fill=(0,0,0,0))
    elif kind=='luggage':
        d.polygon([(100,30),(660,30),(735,100),(735,470),(25,470),(25,100)],fill=cream,outline=ink,width=4)
        d.ellipse((350,52,410,112),fill=(0,0,0,0),outline=ink,width=4);text('带着好奇心出发',380,181,42)
        text('目的地：____________',380,282);text('同行人：____________',380,378)
    elif kind=='postcard':
        rect((20,20,740,480));line([(400,115),(400,440)]);rect((610,50,700,154),accent)
        text('旅 行 来 信',210,80,38)
        for y in (220,300,380):line([(440,y),(700,y)],3)
        for y in (180,250,320,390):line([(60,y),(355,y)],2)
    elif kind=='tape':
        d.polygon([(20,38),(725,20),(705,70),(740,100),(710,140),(730,200),(30,220),(49,170),(20,130),(50,87)],fill=accent)
        for x in range(80,680,80):d.ellipse((x,97,x+20,117),fill=cream)
    elif kind=='bubble':
        rect((25,30,735,390));d.polygon([(125,385),(125,465),(235,385)],fill=cream);text('此刻的心情',380,122,42)
        line([(85,225),(675,225)],3);line([(85,310),(675,310)],3)
    elif kind=='coffee':
        rect((20,20,740,480));text('咖 啡 探 店',380,82,42)
        d.arc((70,151,225,310),0,180,fill=ink,width=7);line([(70,230),(225,230)]);d.arc((220,231,270,285),260,100,fill=ink,width=6)
        for y,s in [(190,'店名：___________'),(275,'饮品：___________'),(360,'风味：___________')]:text(s,460,y,30)
    elif kind=='route':
        rect((20,20,740,480));text('从这里，去那里',380,82,42)
        for x in (130,630):d.ellipse((x-20,195,x+20,235),fill=accent,outline=ink,width=4)
        for x in range(185,585,45):line([(x,215),(x+22,215)])
        text('出发：________',200,330,28);text('抵达：________',560,330,28);text('日期：________________',380,421,28)
    elif kind=='stampbox':
        rect((55,30,705,470));d.rectangle((80,55,680,390),fill=(0,0,0,0));text('城市 / 日期：________________',380,433,28)
    else:
        rect((20,20,w-20,h-20));d.rectangle((35,36,47,h-36),fill=accent)
        text('地点：________    日期：________' if kind=='label' else label,w/2,h/2,32 if kind=='label' else 48)
    return im

def main(out=None):
    root=Path(out) if out else ROOT
    manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
    manifest['items']=[m for m in manifest['items'] if m.get('pack')!='story-travel']
    for theme,name,ink,accent,cream,_ in THEMES:
        for kind,label,cat in SPECS:
            im=artwork(kind,label,ink,accent,cream);ident=f'{cat}_story_{theme}_{kind}'
            rel=f'{cat}/{ident}.png';thumb=f'thumbs/{cat}/{ident}.png'
            for p in (rel,thumb):(root/p).parent.mkdir(parents=True,exist_ok=True)
            im.save(root/rel,optimize=True);small=im.copy();small.thumbnail((220,180));small.save(root/thumb,optimize=True)
            manifest['items'].append(dict(id=ident,name=f'{name} · {label}',cat=cat,tags=[name,label,'日记旅行','日记拼贴','旅行收藏','原创素材'],collection=theme,pack='story-travel',usage='story',file=rel,thumb=thumb,w=im.width,h=im.height,alpha=True,tile=False,dominant=ink.lower(),license='CC0-1.0',author='Journal Studio 原创程序绘制',desc='原创日记与旅行素材；可搭配任意内页，照片框内部透明'))
    for cat in manifest['categories']:cat['count']=sum(m['cat']==cat['id'] for m in manifest['items'])
    for c in manifest['collections']:c['count']=sum(m.get('collection')==c['id'] for m in manifest['items'])
    (root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f"Materials: {len(manifest['items'])}; diary/travel: {len(SPECS)*len(THEMES)}")
if __name__=='__main__':main()
