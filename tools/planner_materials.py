"""Original functional stationery. Run alone or via make_materials.py; idempotent."""
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw
from expand_materials import THEMES
from make_materials import get_font, draw_text_center

ROOT = Path(__file__).resolve().parents[1] / 'assets' / 'materials'

def artwork(kind, value, ink, accent, cream):
    size = (600, 180) if kind in ('weekday','month') else (360,360) if kind in ('weather','mood') else (720,420)
    im=Image.new('RGBA',size); d=ImageDraw.Draw(im); w,h=size
    d.rounded_rectangle((12,12,w-12,h-12),radius=35,fill=cream,outline=ink,width=4)
    def label(s,x,y,n=36): draw_text_center(d,x,y,s,get_font(n),ink)
    def line(points,width=5): d.line(points,fill=ink,width=width,joint='curve')
    def check(x,y): d.rounded_rectangle((x,y,x+30,y+30),radius=5,outline=ink,width=3)
    if kind=='weekday':
        cn=['周一','周二','周三','周四','周五','周六','周日'][value]
        en=['MON','TUE','WED','THU','FRI','SAT','SUN'][value]
        label(cn,180,86,48);label(en,420,90,32)
    elif kind=='month':
        label(f'{value:02d}',120,84,72);label('月 / MONTH',375,90,36)
    elif kind=='weather':
        if value==0:
            d.ellipse((124,85,236,197),fill=accent,outline=ink,width=5)
            for i in range(8):
                a=i*math.pi/4;line([(180+math.cos(a)*72,141+math.sin(a)*72),(180+math.cos(a)*95,141+math.sin(a)*95)])
        elif value in (1,2,3):
            for x,y,r in [(117,153,43),(169,125,54),(223,151,40)]:d.ellipse((x-r,y-r,x+r,y+r),fill=accent)
            d.rounded_rectangle((76,147,265,191),radius=20,fill=accent)
            if value==2:
                for x in (118,180,242):line([(x,209),(x-13,240)])
            if value==3:
                for x in (118,180,242):
                    line([(x-12,223),(x+12,223)]);line([(x,211),(x,235)])
        else:
            for x,y,wid in [(76,104,180),(102,151,150),(76,198,140)]:
                line([(x,y),(x+wid,y)]);d.arc((x+wid-30,y-30,x+wid,y),270,90,fill=ink,width=5)
        label(['晴天','多云','下雨','下雪','有风'][value],180,292,32)
    elif kind=='mood':
        d.ellipse((97,57,263,223),fill=accent,outline=ink,width=4)
        for x in (148,212):d.ellipse((x-5,115,x+5,125),fill=ink)
        if value==0:d.arc((144,124,217,183),0,180,fill=ink,width=5)
        elif value==1:line([(151,163),(209,163)])
        else:d.arc((144,157,217,202),180,360,fill=ink,width=5)
        label(['开心','平静','有点累'][value],180,292,32)
    elif value=='todo':
        label('待办清单',w/2,64,36)
        for y in (125,215,305):check(60,y);line([(120,y+27),(650,y+27)],3)
    elif value=='habit':
        label('一周小坚持',w/2,68,36)
        for i,s in enumerate('一二三四五六日'):
            x=68+i*96;label(s,x,170,28);d.rounded_rectangle((x-30,230,x+30,290),radius=10,outline=ink,width=3)
    elif value=='water':
        label('今天也要喝水',w/2,68,36)
        for i in range(8):
            x=72+i*82;d.polygon([(x-23,157),(x+23,157),(x+16,262),(x-16,262)],outline=ink,width=4)
            line([(x-18,216),(x+18,216)],3)
        label('按照自己的需要，慢慢补充',w/2,343,25)
    elif value=='priority':
        label('今天最重要的三件事',w/2,64,36)
        for i in range(3):label(f'0{i+1}',75,150+i*87,30);line([(120,172+i*87),(650,172+i*87)],3)
    elif value=='date':
        label('把日子记下来',w/2,78,34);label('____ 年  ____ 月  ____ 日',w/2,205,36)
        label('天气：______    心情：______',w/2,320,29)
    return im

def main(out=None):
    root=Path(out) if out is not None else ROOT
    manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
    manifest['items']=[m for m in manifest['items'] if m.get('usage')!='functional']
    specs=[('weekday',i,['周一','周二','周三','周四','周五','周六','周日'][i],'title') for i in range(7)]
    specs += [('month',i,f'{i}月标题','title') for i in range(1,13)]
    specs += [('weather',i,s,'icon') for i,s in enumerate(['晴天','多云','下雨','下雪','有风'])]
    specs += [('mood',i,s,'icon') for i,s in enumerate(['开心','平静','有点累'])]
    specs += [('functional',key,name,'sticker') for key,name in [('todo','待办清单'),('habit','一周习惯打卡'),('water','喝水记录'),('priority','今日三件事'),('date','日期天气心情条')]]
    for theme,name,ink,accent,cream,_ in THEMES:
        for kind,value,label,cat in specs:
            im=artwork(kind,value,ink,accent,cream)
            ident=f'{cat}_planner_{theme}_{kind}_{value}'
            rel=f'{cat}/{ident}.png'; thumb=f'thumbs/{cat}/{ident}.png'
            for p in (rel,thumb):(root/p).parent.mkdir(parents=True,exist_ok=True)
            im.save(root/rel,optimize=True);small=im.copy();small.thumbnail((220,180));small.save(root/thumb,optimize=True)
            manifest['items'].append(dict(id=ident,name=f'{name} · {label}',cat=cat,tags=[name,label,'功能贴纸','手账计划',{'weekday':'星期','month':'月份','weather':'天气','mood':'心情','functional':'打卡待办'}[kind]],collection=theme,usage='functional',file=rel,thumb=thumb,w=im.width,h=im.height,alpha=True,tile=False,dominant=ink.lower(),license='CC0-1.0',author='Journal Studio 原创程序绘制',desc=f'{name}配套功能素材：{label}；按300dpi添加，可调整尺寸'))
    for cat in manifest['categories']:cat['count']=sum(m['cat']==cat['id'] for m in manifest['items'])
    for c in manifest['collections']:c['count']=sum(m.get('collection')==c['id'] for m in manifest['items'])
    (root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f"Materials: {len(manifest['items'])}; functional: {len(specs)*len(THEMES)}")

if __name__=='__main__':main()
