"""48 distinct original assets: botanical study, paper rooms and Chinese planning."""
from pathlib import Path
import json, math
from PIL import Image, ImageDraw
from make_materials import get_font, draw_text_center
ROOT=Path(__file__).resolve().parents[1]/'assets/materials'
PACKS=[('cn_botanical','植物观察','#658473'),('cn_scene','窗边拼贴','#A4785F'),('cn_action','中文行动','#7F819F')]
SPECS={
 'cn_botanical':[('leaf','橄榄叶枝','sticker'),('fern','蕨叶','sticker'),('flower','野花','sticker'),('branch','浆果枝','sticker'),('ginkgo','银杏叶','sticker'),('mushroom','林间蘑菇','sticker'),('butterfly','观察蝴蝶','sticker'),('seed_packet','种子小袋','sticker'),('vase','瓶中花枝','sticker'),('acorn','橡果','sticker'),('label','植物名称标签','title'),('wreath','叶环相框','frame'),('tape','花叶胶带','tape'),('card','自然观察卡','sticker'),('petals','散落花瓣','sticker'),('border','花枝边饰','sticker')],
 'cn_scene':[('arch_window','拱形窗','sticker'),('window','四格窗','frame'),('door','木门','sticker'),('desk','书桌与书','sticker'),('bookshelf','小书架','sticker'),('lamp','台灯','sticker'),('cup','茶杯','sticker'),('books','叠放的书','sticker'),('bird','窗边小鸟','sticker'),('envelope','信封','sticker'),('cloud','云朵','sticker'),('house','街角小屋','sticker'),('tree','盆栽树','sticker'),('tag','旧纸标签','title'),('scrap','撕边底纸','paper'),('tape','格纹胶带','tape')],
 'cn_action':[('start','从一小步开始','title'),('focus','今日重点','title'),('done','已经完成','stamp'),('later','留给明天','title'),('review','每周复盘','title'),('idea','突然想到','title'),('read','读到这里','title'),('slow','慢慢来就好','title'),('steps','三步行动卡','sticker'),('week','七天坚持卡','sticker'),('wish','愿望小卡','sticker'),('memo','待办便签','sticker'),('date','日期记录条','title'),('quote','摘录卡','sticker'),('check','完成勾选贴','icon'),('arrow','下一步箭头','icon')],
}

def artwork(pack,key,label):
    w,h=(760,230) if key in ['tape','label','tag','date'] or (pack=='cn_action' and key in ['start','focus','later','review','idea','read','slow']) else (640,640)
    im=Image.new('RGBA',(w,h));d=ImageDraw.Draw(im)
    green='#658473';dark='#4D6658';light='#B4C3A1';rose='#D5A49C';cream='#F6EDDC';brown='#946E55';ink='#65584E';blue='#AFC1C2';violet='#7F819F'
    def line(p,c=ink,n=6):d.line(p,fill=c,width=n,joint='curve')
    def rect(b,c=cream,r=14,o=ink):d.rounded_rectangle(b,radius=r,fill=c,outline=o,width=5)
    def oval(b,c,o=None):d.ellipse(b,fill=c,outline=o,width=4)
    def text(s,x,y,n=30,c=ink):draw_text_center(d,x,y,s,get_font(n),c)
    def leaf(x,y,side=1,s=1):
        d.polygon([(x,y),(x+side*70*s,y-90*s),(x+side*105*s,y-85*s),(x+side*100*s,y-45*s)],fill=green)
        line([(x,y),(x+side*87*s,y-70*s)],dark,3)
    def sprig(x=320,y=550,s=1):
        line([(x,y),(x-15*s,y-400*s)],dark,5)
        for i in range(4):leaf(x-3*i*s,y-(30+i*85)*s,(-1)**i,s)
    def bloom(x,y,r=40):
        for j in range(6):
            a=j*math.pi/3;xx=x+math.cos(a)*r*.8;yy=y+math.sin(a)*r*.8;oval((xx-r*.55,yy-r*.55,xx+r*.55,yy+r*.55),rose)
        oval((x-r*.3,y-r*.3,x+r*.3,y+r*.3),'#DBC58A')
    if pack=='cn_botanical':
        if key=='leaf':sprig()
        elif key=='fern':
            line([(260,580),(365,65)],dark,5)
            for i in range(11):
                y=530-i*39;x=270+i*8;r=105-i*7
                for side in [-1,1]:d.polygon([(x,y),(x+side*r,y-55),(x+side*(r-12),y-15)],fill=green if i%2 else light)
        elif key=='flower':
            for x,y in [(230,220),(385,140),(410,340)]:line([(315,565),(x,y)],green,6);bloom(x,y,56)
            leaf(300,470,-1,.9)
        elif key=='branch':
            sprig(s=.95)
            for x,y in [(215,240),(410,175),(205,400),(390,345)]:line([(320,y+60),(x,y)],dark,4);oval((x-27,y-27,x+27,y+27),rose,ink)
        elif key=='ginkgo':
            line([(320,570),(320,370)],brown,8)
            points=[(320,410)]+[(320+230*math.cos(a),400+230*math.sin(a)) for a in [math.pi+i*math.pi/28 for i in range(29)]]
            d.polygon(points,fill='#D4B56B')
            for i in range(1,8):
                a=math.pi+i*math.pi/8;line([(320,400),(320+210*math.cos(a),400+210*math.sin(a))],'#A68A4F',3)
        elif key=='mushroom':
            for x,y,s in [(255,250,1),(430,405,.6)]:
                rect((x-32*s,y,x+45*s,y+275*s),cream,20)
                d.pieslice((x-180*s,y-125*s,x+180*s,y+165*s),180,360,fill=brown,outline=ink,width=5)
                for dx,dy in [(-70,0),(20,-45),(90,12)]:oval((x+(dx-15)*s,y+(dy-15)*s,x+(dx+15)*s,y+(dy+15)*s),cream)
        elif key=='butterfly':
            for side in [-1,1]:
                oval((320+side*130-115,140,320+side*130+115,365),blue,ink);oval((320+side*95-85,335,320+side*95+85,495),rose,ink)
            rect((305,200,335,490),brown,12);line([(315,220),(275,150)]);line([(325,220),(365,150)])
        elif key=='seed_packet':
            rect((120,70,520,580));line([(120,150),(520,150)]);text('种子收藏',320,115,38);bloom(320,280,65);line([(320,320),(320,400)],green,6);text('名称：________',320,465);text('日期：________',320,530)
        elif key=='vase':
            for x,y in [(255,120),(370,80),(440,185)]:line([(320,405),(x,y)],green);bloom(x,y,43)
            d.polygon([(235,360),(405,360),(440,565),(200,565)],fill=blue,outline=ink,width=5)
        elif key=='acorn':
            oval((185,240,455,540),'#BB9470',ink);rect((160,210,480,320),brown,65);line([(320,210),(340,140)],brown,14)
            for x in range(185,450,45):line([(x,240),(x+20,290)],cream,3)
        elif key=='label':
            rect((18,18,742,212));text('植物：________    地点：________',380,112,32,green)
        elif key=='wreath':
            d.ellipse((75,70,565,560),outline=green,width=9)
            for j in range(12):
                a=j*math.pi/6;x=320+240*math.cos(a);y=315+240*math.sin(a);oval((x-20,y-35,x+20,y+35),light)
        elif key=='tape':
            rect((15,20,745,210),cream,4,light)
            for x in range(85,720,145):bloom(x,115,36);leaf(x+44,155,1,.35)
        elif key=='card':
            rect((40,40,600,600));text('自然观察',320,106,42,green)
            for i,s in enumerate(['日期 / 地点','名称 / 形态','天气 / 环境','今天的新发现']):text(s,320,200+i*100,30);line([(80,240+i*100),(560,240+i*100)],light,3)
        elif key=='petals':
            for x,y,r in [(140,140,45),(410,170,36),(290,335,48),(480,450,40),(160,505,35)]:bloom(x,y,r)
        elif key=='border':
            line([(100,570),(100,110),(540,110)],green,6)
            for y in (180,290,400,510):leaf(100,y,1,.65)
            for x in (190,340,490):bloom(x,110,32)
    elif pack=='cn_scene':
        if key=='arch_window':
            d.rounded_rectangle((100,45,540,585),radius=210,fill=brown);d.rectangle((100,270,540,585),fill=brown)
            d.rounded_rectangle((125,72,515,560),radius=190,fill=blue);d.rectangle((125,270,515,560),fill=blue)
            oval((175,145,265,235),cream);d.polygon([(130,450),(260,310),(390,450),(510,350),(510,560),(130,560)],fill=light)
            line([(320,75),(320,565)],brown,19);line([(120,345),(520,345)],brown,19);rect((70,565,570,600),cream,7)
        elif key=='window':
            rect((70,50,570,590),brown,9);d.rectangle((95,75,545,565),fill=(0,0,0,0));line([(320,70),(320,570)],brown,20);line([(90,320),(550,320)],brown,20)
        elif key=='door':
            rect((155,40,485,600),brown,12);rect((180,70,460,310),blue,9);rect((180,340,460,570),cream,9);oval((410,360,435,385),'#D5BE80')
        elif key=='desk':
            rect((45,270,595,315),brown,8);line([(95,310),(75,590)],brown,25);line([(545,310),(565,590)],brown,25)
            for i,c in enumerate([blue,rose,cream]):rect((150-i*12,240-i*40,400-i*12,273-i*40),c,4)
        elif key=='bookshelf':
            for y in (265,515):
                rect((75,y,565,y+24),brown,5)
                for i,c in enumerate([rose,blue,light,cream]):rect((110+i*100,y-145-i%2*35,180+i*100,y-1),c,4)
            line([(85,80),(85,590)],brown,18);line([(555,80),(555,590)],brown,18)
        elif key=='lamp':
            line([(315,260),(315,540)],brown,14);d.polygon([(205,80),(430,80),(510,300),(125,300)],fill='#DDC491',outline=ink,width=5);oval((210,525,425,580),brown)
        elif key=='cup':
            rect((135,190,450,480),cream,60);d.arc((390,225,540,405),260,100,fill=brown,width=15);d.ellipse((135,170,450,240),fill=brown,outline=ink,width=4);oval((95,480,505,545),blue)
        elif key=='books':
            for i,c in enumerate([rose,cream,blue]):rect((75+i*27,425-i*115,545+i*10,515-i*115),c,12);line([(125+i*27,475-i*115),(510+i*10,475-i*115)],brown,3)
        elif key=='bird':
            oval((150,180,460,430),blue,ink);d.polygon([(155,320),(55,245),(100,390)],fill=blue,outline=ink,width=4);d.polygon([(450,245),(540,280),(450,305)],fill='#D5BE80');oval((385,235,405,255),ink);line([(280,425),(265,485)]);line([(345,425),(360,485)])
        elif key=='envelope':
            rect((65,155,575,505));d.polygon([(65,155),(320,360),(575,155)],fill=rose,outline=ink,width=4);line([(65,505),(240,340)]);line([(575,505),(400,340)])
        elif key=='cloud':
            for x,y,r in [(170,320,100),(300,240,135),(440,315,110)]:oval((x-r,y-r,x+r,y+r),blue)
            rect((140,310,490,420),blue,40,blue)
        elif key=='house':
            rect((135,240,505,570));d.polygon([(90,250),(320,70),(550,250)],fill=brown,outline=ink,width=5);rect((270,380,380,570),rose,8)
            for x in (170,405):rect((x,295,x+65,365),blue,4)
        elif key=='tree':
            line([(320,240),(320,490)],brown,16)
            for x,y in [(230,220),(340,130),(420,230),(315,320)]:oval((x-100,y-100,x+100,y+100),light,green)
            d.polygon([(225,455),(415,455),(385,600),(255,600)],fill=rose,outline=ink,width=5)
        elif key=='tag':
            d.polygon([(25,60),(85,20),(735,20),(735,210),(85,210),(25,170)],fill=cream,outline=ink,width=4);oval((65,96,100,131),(0,0,0,0),brown);line([(155,158),(680,158)],brown,3)
        elif key=='scrap':
            pts=[(50+i*35,45+(i%3)*9) for i in range(16)]+[(590,570)]+[(590-i*35,590-(i%3)*9) for i in range(16)]
            d.polygon(pts,fill=cream)
            for y in range(135,550,55):line([(90,y),(540,y)],'#D6C6AE',2)
        elif key=='tape':
            rect((15,20,745,210),cream,3)
            for x in range(30,740,50):line([(x,22),(x,208)],rose,14)
            for y in (65,135,195):line([(18,y),(742,y)],blue,14)
    else:
        if key=='check':
            oval((80,80,560,560),'#E8ECD9',green);line([(180,325),(280,425),(465,205)],green,35)
        elif key=='arrow':
            d.polygon([(60,260),(370,260),(370,130),(595,320),(370,510),(370,380),(60,380)],fill='#DCC4B2',outline=ink,width=5)
        elif key=='done':
            d.ellipse((75,75,565,565),outline=violet,width=12);d.ellipse((95,95,545,545),outline=violet,width=4);text('已经完成',320,320,70,violet)
        elif key in ['start','focus','later','review','idea','read','slow','date']:
            rect((20,20,w-20,h-20),cream,20,violet);text('日期：____年____月____日' if key=='date' else label,w/2,h/2,38,violet)
        else:
            rect((40,40,600,600),cream,15,violet);text(label,320,108,45,violet)
            if key=='week':
                for i,s in enumerate('一二三四五六日'):
                    x=102+i*72;text(s,x,245,28,violet);rect((x-22,310,x+22,354),'#FFFFFF',6,violet)
                text('这周想坚持：____________',320,485,29,violet)
            elif key in ['steps','memo']:
                for i in range(3):
                    y=230+i*110;rect((80,y-20,120,y+20),'#FFFFFF',4,violet);line([(155,y+20),(550,y+20)],violet,3)
            elif key=='wish':
                text('我想：________________',320,245,32,violet);text('第一步：______________',320,365,32,violet);text('在这一天：____________',320,485,32,violet)
            else:
                for y in (230,310,390,470):line([(90,y),(550,y)],violet,3)
                text('出处 / 页码：___________',320,550,27,violet)
    return im

def main(out=None):
    root=Path(out) if out else ROOT
    manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
    manifest['items']=[m for m in manifest['items'] if m.get('pack')!='chinese-original']
    manifest['collections']=[c for c in manifest.get('collections',[]) if c['id'] not in SPECS]
    for pack,name,color in PACKS:
        for key,label,cat in SPECS[pack]:
            im=artwork(pack,key,label);ident=f'{cat}_{pack}_{key}';rel=f'{cat}/{ident}.png';thumb=f'thumbs/{cat}/{ident}.png'
            for p in (rel,thumb):(root/p).parent.mkdir(parents=True,exist_ok=True)
            im.save(root/rel,optimize=True);small=im.copy();small.thumbnail((220,180));small.save(root/thumb,optimize=True)
            manifest['items'].append(dict(id=ident,name=f'{name} · {label}',cat=cat,tags=[name,label,'中文与自然','国产品牌研究','原创素材'],collection=pack,pack='chinese-original',usage='cn',file=rel,thumb=thumb,w=im.width,h=im.height,alpha=True,tile=False,dominant=color.lower(),license='CC0-1.0',author='Journal Studio 原创程序绘制',desc='工坊原创素材，非品牌原图；可单独移动缩放、搭配任意内页'))
        manifest['collections'].append(dict(id=pack,name=name,color=color,count=len(SPECS[pack])))
    for c in manifest['categories']:c['count']=sum(m['cat']==c['id'] for m in manifest['items'])
    for c in manifest['collections']:c['count']=sum(m.get('collection')==c['id'] for m in manifest['items'])
    (root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f"Materials: {len(manifest['items'])}; new distinct designs: 48")
if __name__=='__main__':main()
