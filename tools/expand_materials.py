"""Deterministic original illustrations. Adds six coordinated 16-piece collections.
Run after make_materials.py; existing images and IDs are preserved.
"""
from pathlib import Path
import json, math
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1] / 'assets' / 'materials'
THEMES = [
 ('cafe','咖啡日常','#B77D5A','#EBC9A3','#FFF3DF',['咖啡杯','手冲壶','牛角包','吐司','咖啡豆罐','咖啡袋','小茶壶','甜甜圈']),
 ('garden','花园来信','#628A68','#DCA4B4','#F2F5DE',['雏菊','郁金香','叶片','花枝','盆栽','蘑菇','浇水壶','蝴蝶']),
 ('travel','慢游记','#597C99','#DCA471','#EDF3F6',['相机','行李箱','帐篷','山峰','指南针','车票','纸飞机','信封']),
 ('cats','猫咪午后','#B58D75','#D9B4C8','#FFF3E9',['猫咪头像','坐着的猫','猫爪','小鱼','毛线球','猫碗','睡觉猫咪','逗猫棒']),
 ('sky','星空梦境','#7D80B5','#E2BB7C','#F0EFFA',['月亮','太阳','星星','云朵','彩虹','星球','火箭','星座']),
 ('party','节庆心愿','#BB747E','#91AB91','#FFF1E6',['礼物','气球','蛋糕','蜡烛','蝴蝶结','圣诞树','花环','彩旗'])
]

def star(cx,cy,r,n=5):
 return [(cx+math.cos(-math.pi/2+i*math.pi/n)*r*(1 if i%2==0 else .44),cy+math.sin(-math.pi/2+i*math.pi/n)*r*(1 if i%2==0 else .44)) for i in range(n*2)]

def illustration(theme, k, a, b, cream):
 im=Image.new('RGBA',(640,640)); d=ImageDraw.Draw(im); ink='#54463E'; white='#FFFDF8'
 def line(p,fill=ink,w=9): d.line(p,fill=fill,width=w,joint='curve')
 def oval(box,fill,outline=None,w=7): d.ellipse(box,fill=fill,outline=outline,width=w)
 def rect(box,fill,rad=22,outline=ink): d.rounded_rectangle(box,radius=rad,fill=fill,outline=outline,width=7)
 def poly(points,fill): d.polygon(points,fill=fill); line(points+[points[0]],ink,7)
 def flower(x,y,r=70):
  for j in range(6):
   t=j*math.pi/3; cx=x+math.cos(t)*r*.65; cy=y+math.sin(t)*r*.65
   oval((cx-r*.4,cy-r*.4,cx+r*.4,cy+r*.4),b)
  oval((x-r*.3,y-r*.3,x+r*.3,y+r*.3),a)
 def cat(x,y,s=1):
  poly([(x-95*s,y-35*s),(x-90*s,y-140*s),(x-20*s,y-90*s)],a)
  poly([(x+95*s,y-35*s),(x+90*s,y-140*s),(x+20*s,y-90*s)],a)
  oval((x-120*s,y-100*s,x+120*s,y+90*s),a,ink)
  for xx in [x-45*s,x+45*s]: oval((xx-6,y-12,xx+6,y+5),ink)
  poly([(x-10,y+16),(x+10,y+16),(x,y+29)],b)
  line([(x,y+29),(x,y+45),(x-15,y+49)],ink,5);line([(x,y+45),(x+15,y+49)],ink,5)
  for side in [-1,1]:
   for off in [0,18]: line([(x+side*65*s,y+24+off),(x+side*140*s,y+12+off)],ink,5)
 if theme=='cafe':
  if k==0:
   oval((394,270,525,430),b,ink);oval((420,298,490,399),cream)
   rect((150,245,435,465),cream,35);oval((150,213,435,290),a,ink);oval((185,230,398,270),'#795541')
   line([(240,180),(223,146),(240,110)],a,8);line([(325,180),(309,146),(325,110)],a,8);oval((130,467,488,510),b)
  elif k in [1,6]:
   oval((390,243,535,418),b,ink);oval((420,275,505,385),cream)
   poly([(190,310),(102,224),(113,368),(211,418)],a)
   oval((180,228,450,475),cream,ink);rect((240,201,386,245),b,15);oval((293,164,333,207),a,ink)
   if k==1: poly([(242,234),(265,157),(375,157),(400,234)],a)
   flower(315,345,45)
  elif k==2:
   d.arc((100,155,540,510),5,175,fill=a,width=105);d.arc((113,148,527,460),10,170,fill=b,width=70)
   for x,y in [(190,340),(270,380),(350,380),(430,330)]:line([(x-23,y-55),(x+16,y+30)],a,12)
  elif k==3:
   rect((180,230,460,490),a,40);oval((150,130,490,350),a,ink);rect((211,262,430,457),cream,22, None)
   oval((195,168,444,350),cream);rect((270,275,367,345),b,10,None)
  elif k==4:
   rect((193,200,447,485),cream,33);rect((182,150,458,221),a,15);rect((224,276,416,414),b,8)
   oval((279,301,362,386),a,ink);line([(325,310),(308,344),(333,376)],cream,7)
  elif k==5:
   poly([(210,160),(425,160),(460,480),(170,480)],b);rect((205,145,431,196),a,8);rect((218,255,416,411),cream,10)
   oval((274,280,363,378),a);line([(320,290),(306,327),(332,368)],cream,8)
  else:
   oval((150,150,490,490),a,ink);oval((167,157,472,454),b);oval((268,268,372,372),cream,ink)
   for x,y in [(220,220),(390,220),(215,365),(385,395),(325,195),(427,310)]:line([(x,y),(x+20,y+10)],cream,10)
 elif theme=='garden':
  if k in [0,1,3]:
   line([(315,260),(300,485)],a,15);oval((220,315,301,368),a);oval((309,355,402,414),a)
   if k==1:
    poly([(230,185),(270,235),(320,160),(366,235),(410,185),(395,300),(320,340),(244,290)],b)
   else:
    flower(320,235,105)
    if k==3:line([(306,373),(430,264)],a,10);flower(435,240,60);line([(300,415),(180,300)],a,10);flower(177,280,48)
  elif k==2:
   line([(240,500),(410,150)],a,12)
   for i in range(4):
    y=215+i*65;x=380-i*30;oval((x-90,y-15,x+8,y+45),a);oval((x+10,y-10,x+100,y+40),a)
  elif k==4:
   line([(320,380),(320,185)],a,14);oval((219,190,317,280),a);oval((328,240,428,330),a)
   poly([(220,355),(425,355),(400,495),(245,495)],b);rect((205,345,438,385),cream,10)
  elif k==5:
   rect((275,310,370,495),cream,20);d.pieslice((140,115,500,460),180,360,fill=b,outline=ink,width=7)
   for x,y,r in [(225,265,24),(319,203,26),(410,268,23)]:oval((x-r,y-r,x+r,y+r),cream)
   line([(190,500),(185,450)],a);line([(450,500),(475,445)],a)
  elif k==6:
   oval((368,210,510,395),a,ink);oval((400,242,475,360),cream);rect((190,265,419,470),b,22)
   poly([(200,350),(102,236),(85,275),(190,434)],a);rect((238,239,355,275),a,10)
   for i in range(3):line([(82-i*16,310+i*30),(65-i*16,335+i*30)],a,8)
  else:
   oval((130,150,315,350),b,ink);oval((325,150,510,350),b,ink);oval((180,330,312,465),a,ink);oval((327,330,459,465),a,ink)
   rect((304,236,335,450),ink,15);line([(315,245),(280,171)],ink,6);line([(325,245),(361,171)],ink,6)
 elif theme=='travel':
  if k==0:
   rect((130,227,510,455),a,30);rect((180,191,270,240),b,10);oval((237,245,421,429),cream,ink);oval((270,279,388,395),a,ink);oval((294,295,320,321),white)
   rect((434,253,477,282),b,8,None)
  elif k==1:
   rect((267,137,375,207),cream,15);rect((182,192,458,479),b,30)
   for x in [227,391]:rect((x,204,x+21,468),a,4,None);oval((x-2,470,x+26,510),ink)
   rect((282,281,350,356),cream,8)
  elif k in [2,3]:
   poly([(100,478),(300,145),(530,478)],a);poly([(300,145),(215,285),(310,250),(369,300)],cream)
   if k==2:poly([(204,478),(304,302),(401,478)],b);line([(304,302),(304,476)],ink,7)
   else:poly([(305,478),(451,253),(566,478)],b);oval((100,130,201,231),b)
  elif k==4:
   oval((150,150,490,490),b,ink);oval((180,180,460,460),cream,ink);poly([(320,205),(365,320),(320,430),(277,320)],a);line([(320,230),(320,400)],ink,6)
   for x,y in [(320,193),(320,448),(193,320),(448,320)]:oval((x-7,y-7,x+7,y+7),ink)
  elif k==5:
   rect((125,220,515,422),cream,15);rect((145,241,254,401),a,6,None)
   for y in range(250,400,23):line([(278,y),(278,y+11)],b,6)
   for y in [270,315,365]:line([(315,y),(468,y)],b,10)
  elif k==6:
   poly([(100,275),(520,130),(360,500),(282,350)],cream);poly([(282,350),(520,130),(325,385)],a);line([(282,350),(242,445),(325,385)],ink,7)
  else:
   rect((130,220,510,450),cream,14);line([(130,228),(320,365),(510,228)],a,9);line([(130,450),(267,325)],a,8);line([(510,450),(373,325)],a,8);flower(320,333,35)
 elif theme=='cats':
  if k==0:cat(320,330)
  elif k==1:
   oval((220,310,420,510),a,ink);d.arc((370,350,515,510),260,100,fill=a,width=35);cat(320,240,.72)
   line([(273,410),(273,487)],ink,6);line([(364,410),(364,487)],ink,6)
  elif k==2:
   oval((215,310,425,490),a,ink)
   for x,y in [(190,285),(270,220),(365,220),(450,285)]:oval((x-40,y-55,x+40,y+45),a,ink)
   oval((270,355,370,440),b)
  elif k==3:
   oval((150,220,420,420),a,ink);poly([(407,320),(515,235),(515,415)],b);oval((207,280,223,296),ink);line([(310,245),(310,395)],b,12)
  elif k==4:
   oval((180,160,450,430),b,ink)
   for i in range(5):d.arc((190+i*23,172,440,420),75,280,fill=a,width=6)
   line([(386,414),(430,482),(502,478),(512,434)],a,10)
  elif k==5:
   poly([(155,270),(485,270),(450,455),(190,455)],b);oval((155,235,485,315),a,ink)
   oval((275,345,365,410),cream);oval((260,325,289,355),cream);oval((305,313,334,343),cream);oval((350,325,379,355),cream)
  elif k==6:
   oval((180,260,493,468),a,ink);cat(230,325,.65);d.arc((250,280,470,450),270,100,fill=b,width=22)
  else:
   line([(165,480),(356,150)],a,18);line([(356,150),(463,253),(410,346)],ink,5);oval((375,330,453,421),b,ink)
   for i in range(3):line([(402+i*12,416),(383+i*17,475)],a,6)
 elif theme=='sky':
  if k==0:
   # Crescent polygon avoids painting an opaque cut-out on transparent art.
   pts=[(320+185*math.cos(t),320+185*math.sin(t)) for t in [math.radians(70+i*220/90) for i in range(91)]]
   pts += [(390+145*math.cos(t),290+180*math.sin(t)) for t in [math.radians(250-i*180/90) for i in range(91)]];poly(pts,b)
   d.polygon(star(440,190,45),fill=a)
  elif k==1:
   oval((220,220,420,420),b,ink)
   for i in range(12):
    t=i*math.pi/6;line([(320+145*math.cos(t),320+145*math.sin(t)),(320+195*math.cos(t),320+195*math.sin(t))],a,12)
  elif k==2:
   poly(star(320,320,200),b);d.polygon(star(320,320,125),fill=cream)
  elif k==3:
   for box in [(123,285,310,440),(220,190,420,430),(350,264,515,440)]:oval(box,cream)
   rect((171,330,468,437),cream,40,None)
   for x in [225,320,415]:line([(x,473),(x-15,511)],a,11)
  elif k==4:
   for i,c in enumerate([a,b,'#B9C9C5','#E1B7BC']):d.arc((125+30*i,135+30*i,515-30*i,525-30*i),180,360,fill=c,width=26)
   oval((98,291,230,400),cream);oval((408,291,542,400),cream)
  elif k==5:
   oval((202,202,438,438),a,ink);d.arc((100,247,540,393),0,360,fill=b,width=30);oval((270,235,310,275),cream);oval((339,325,400,386),b)
  elif k==6:
   poly([(252,382),(170,470),(180,345),(255,290)],a);poly([(388,382),(470,470),(460,345),(385,290)],a)
   oval((240,125,400,450),cream,ink);poly([(255,213),(320,125),(385,213)],b);oval((280,250,360,330),a,ink);poly([(285,448),(320,540),(355,448)],b)
  else:
   points=[(150,230),(270,160),(360,290),(500,235),(420,455),(230,420)]
   line(points,a,8)
   for x,y in points:d.polygon(star(x,y,29),fill=b)
 elif theme=='party':
  if k==0:
   rect((180,250,460,485),b,12);rect((160,220,480,275),a,10);rect((299,235,341,485),cream,0,None)
   oval((215,136,320,229),a,ink);oval((320,136,425,229),a,ink);oval((300,190,340,231),cream)
  elif k==1:
   for x,y,c in [(240,230,a),(390,220,b),(320,330,cream)]:
    oval((x-78,y-105,x+78,y+100),c,ink);line([(x,y+103),(x-20,500)],ink,5)
  elif k==2:
   rect((155,300,485,480),b,20);oval((155,262,485,340),cream,ink)
   for x in [230,320,410]:rect((x-10,205,x+10,290),a,4);oval((x-9,169,x+9,204),b)
   line([(180,400),(461,400)],cream,16)
  elif k==3:
   rect((250,250,390,480),b,18);oval((280,125,360,240),a);oval((300,170,340,237),cream);line([(320,245),(320,265)],ink,7)
   for y in [300,365,430]:line([(260,y),(380,y-25)],cream,15)
  elif k==4:
   poly([(306,310),(160,180),(140,390)],a);poly([(334,310),(480,180),(500,390)],a)
   poly([(300,327),(230,500),(315,465),(342,345)],b);poly([(340,330),(420,500),(340,465),(308,345)],b);oval((280,275,360,355),cream,ink)
  elif k==5:
   rect((293,430,347,515),a,5);poly([(320,130),(150,460),(490,460)],b);d.polygon(star(320,130,44),fill=a)
   for x,y in [(278,280),(373,344),(253,406),(333,415)]:oval((x-15,y-15,x+15,y+15),cream)
  elif k==6:
   for i in range(14):
    t=i*math.pi/7;x=320+155*math.cos(t);y=320+155*math.sin(t);oval((x-35,y-25,x+35,y+25),b)
   for x,y in [(210,230),(425,250),(247,440),(415,405)]:oval((x-13,y-13,x+13,y+13),a)
   poly([(320,160),(250,120),(255,210)],a);poly([(320,160),(390,120),(385,210)],a)
  else:
   line([(100,190),(540,275)],ink,8)
   for i in range(5):
    x=115+i*84;y=194+i*16;poly([(x,y),(x+70,y+14),(x+20,y+150)],a if i%2 else b)
 # Soft paper outline and shadow, derived from alpha only.
 mask=im.getchannel('A'); border=mask.filter(ImageFilter.MaxFilter(21))
 shadow=Image.new('RGBA',im.size,'#6D594A'); shadow.putalpha(border.filter(ImageFilter.GaussianBlur(8)).point(lambda v:int(v*.18)))
 paper=Image.new('RGBA',im.size,white);paper.putalpha(border)
 shadow.alpha_composite(paper);shadow.alpha_composite(im)
 return shadow

def main(out=None):
 global ROOT
 if out is not None: ROOT=Path(out)
 manifest=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))
 manifest['items']=[it for it in manifest['items'] if 'collection_' not in it['id']]
 for theme,name,a,b,cream,names in THEMES:
  for k in range(16):
   cat='sticker' if k<8 else ['paper','tape','frame','title'][(k-8)//2]
   idx=k if k<8 else (k-8)%2
   label=names[k] if k<8 else {'paper':'底纹纸','tape':'和纸胶带','frame':'照片边框','title':'手写标题签'}[cat]+str(idx+1)
   if k<8:im=illustration(theme,k,a,b,cream)
   else:
    size={'paper':(1240,1748),'tape':(1300,200),'frame':(750,950),'title':(1000,250)}[cat]
    im=Image.new('RGBA',size,cream if cat=='paper' else (0,0,0,0));d=ImageDraw.Draw(im);w,h=size
    if cat=='paper':
     if idx==0:
      for x in range(0,w,65):d.line((x,0,x,h),fill=b,width=2)
      for y in range(0,h,65):d.line((0,y,w,y),fill=b,width=2)
     else:
      for y in range(25,h,75):
       for x in range(25,w,75):d.ellipse((x,y,x+7,y+7),fill=a)
      for x,y in [(120,110),(730,100),(750,1050)]:d.polygon(star(x,y,30),fill=b)
    elif cat=='tape':
     pts=[(x,14+(x//12%2)*8) for x in range(15,w-14,12)]+[(x,h-14-(x//12%2)*8) for x in range(w-15,14,-12)]
     d.polygon(pts,fill=b if idx else cream)
     for x in range(50,w,100):
      if idx:d.polygon(star(x,100,27),fill=cream)
      else:d.ellipse((x,75,x+25,100),fill=a);d.line((x+45,35,x+45,165),fill=b,width=4)
    elif cat=='frame':
     d.rounded_rectangle((30,30,w-30,h-30),radius=30,fill=cream,outline=a,width=10)
     d.rectangle((75,75,w-75,h-155),fill=(0,0,0,0));d.line((125,h-90,w-125,h-90),fill=b,width=6)
     if idx:
      for x,y in [(65,65),(w-65,h-65)]:d.polygon(star(x,y,45),fill=b)
    else:
     d.rounded_rectangle((30,35,w-30,h-35),radius=70 if idx else 18,fill=cream,outline=a,width=7)
     d.line((150,210,w-150,210),fill=b,width=5)
     for x in [90,w-90]:d.polygon(star(x,150,25),fill=b)
   ident=f'{cat}_collection_{theme}_{k:02d}';rel=f'{cat}/{ident}.'+('jpg' if cat=='paper' else 'png');thumb=f'thumbs/{cat}/{ident}.png'
   (ROOT/rel).parent.mkdir(parents=True,exist_ok=True);(ROOT/thumb).parent.mkdir(parents=True,exist_ok=True)
   (im.convert('RGB') if cat=='paper' else im).save(ROOT/rel,optimize=True);small=im.copy();small.thumbnail((220,180));small.save(ROOT/thumb,optimize=True)
   manifest['items'].append(dict(id=ident,name=f'{name} · {label}',cat=cat,tags=[name,label,'主题套装',theme],collection=theme,file=rel,thumb=thumb,w=im.width,h=im.height,alpha=cat!='paper',tile=False,dominant=a.lower(),license='CC0-1.0',author='Journal Studio 原创程序插画',desc=f'{name}主题套装：{label}'))
 for c in manifest['categories']:c['count']=sum(it['cat']==c['id'] for it in manifest['items'])
 manifest['collections']=[dict(id=t[0],name=t[1],color=t[2],count=16) for t in THEMES]
 (ROOT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(f"Materials: {len(manifest['items'])}; added 96 original coordinated assets")

if __name__=='__main__':main()
