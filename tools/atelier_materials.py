"""Original coordinated assets. Preserve all pre-existing material IDs.

Optional --hero-dir contains calm.png, collect.png, home.png generated with
the prompts recorded in docs/atelier-prompts.json. Existing heroes are retained.
"""
from pathlib import Path
import argparse,json,math,random
from PIL import Image,ImageDraw
from make_materials import get_font,draw_text_center

ROOT=Path(__file__).resolve().parents[1]/'assets/materials'
THEMES=[('calm','清爽日常','#294a55','#427e91',['启动一下','留点余量','待续','今日容量','小步完成','临时插入'],['专注之门','开放区间','余量票签']),('collect','沿途采集','#514a3b','#8b7452',['此处留痕','沿途拾得','见闻标本','旅后回声','日期地点','一片风景'],['标本信封','路线坐标','采集挂牌']),('home','温暖小屋','#654b44','#b57e68',['回家以后','先照顾自己','小屋维护','一餐一刻','慢慢恢复','想起你了'],['窗前微光','一杯暖意','收纳日常'])]

def mark(d,theme,n,ink,box=(38,35,122,119)):
 x,y,X,Y=box;w=X-x;h=Y-y
 def line(points,width=4):d.line([(x+a*w,y+b*h) for a,b in points],fill=ink,width=width,joint='curve')
 if theme=='calm':
  if n%3==0:line([(0,1),(0,0),(.8,0),(.8,.7)]);line([(.3,.4),(1,.4),(1,1),(.3,1),(.3,.4)])
  elif n%3==1:line([(.25,0),(0,0),(0,1),(.25,1)]);line([(.75,0),(1,0),(1,1),(.75,1)]);line([(.4,.5),(.6,.5)])
  else:
   for i in range(3):line([(0,.2+i*.3),(.45+i*.2,.2+i*.3)])
 elif theme=='collect':
  if n%3==0:
   line([(.5,1),(.5,.1)]);line([(.5,.7),(.1,.4),(.1,.2),(.5,.4)]);line([(.5,.5),(.9,.2),(.9,0),(.5,.25)])
  elif n%3==1:line([(0,.9),(.3,.3),(.65,.65),(1,0)]);d.ellipse((x-4,Y-4,x+4,Y+4),fill=ink);d.ellipse((X-6,y-6,X+6,y+6),outline=ink,width=3)
  else:line([(0,.35),(.5,0),(1,.35),(1,1),(0,1),(0,.35)]);line([(.5,.05),(.5,.75)]);line([(.25,.5),(.75,.5)])
 else:
  if n%3==0:line([(0,1),(0,.15),(1,.15),(1,1)]);line([(.5,.15),(.5,1)]);line([(0,.55),(1,.55)]);line([(.15,0),(.85,0)])
  elif n%3==1:line([(0,.4),(.1,1),(.7,1),(.8,.4),(0,.4)]);line([(.8,.5),(1,.5),(1,.8),(.75,.8)]);line([(.3,.2),(.4,0)])
  else:line([(0,.35),(.1,1),(.9,1),(1,.35),(0,.35)]);line([(.2,.35),(.35,0),(.65,0),(.8,.35)]);line([(.3,.5),(.3,.85)]);line([(.7,.5),(.7,.85)])

def stamp(theme,n,label,ink):
 im=Image.new('RGBA',(480,320));d=ImageDraw.Draw(im)
 mark(d,theme,n,ink,(40,70,113,143))
 draw_text_center(d,290,120,label,get_font(40 if len(label)>5 else 45),ink)
 # Each pair has a different functional area, not just a frame recolor.
 if n<2:
  d.line((40,184,440,184),fill=ink,width=3)
  for x in range(44,438,19):d.line((x,200,x+7,200),fill=ink,width=2)
  draw_text_center(d,240,239,'日期  ______    备注  __________',get_font(19),ink)
 elif n<4:
  d.line((40,184,440,184),fill=ink,width=3)
  for j in range(5):d.rectangle((44+j*82,215,71+j*82,242),outline=ink,width=3)
 else:
  for j in range(3):
   d.ellipse((44,187+j*31,58,201+j*31),outline=ink,width=2)
   d.line((75,201+j*31,437,201+j*31),fill=ink,width=2)
 rng=random.Random(theme+str(n));pixels=im.load()
 for _ in range(2400):
  x=rng.randrange(480);y=rng.randrange(320);r,g,b,a=pixels[x,y]
  if a:pixels[x,y]=(r,g,b,int(a*rng.uniform(.1,.7)))
 return im

def motif(theme,n,ink,accent):
 im=Image.new('RGBA',(640,640));d=ImageDraw.Draw(im);cream='#f3e9d2'
 if theme=='calm':
  if n==0:
   d.rounded_rectangle((180,100,460,555),140,fill=accent);d.rounded_rectangle((232,155,408,555),88,fill=cream);d.ellipse((384,430,407,453),fill=ink);d.line((120,560,515,560),fill=ink,width=6)
  elif n==1:
   for x in [110,450]:d.line((x+65 if x==110 else x,150,x,150,x,490,x+65 if x==110 else x-65,490),fill=accent,width=18,joint='curve')
   d.ellipse((270,275,370,375),fill=cream);d.line((295,325,345,325),fill=ink,width=7)
  else:
   d.rounded_rectangle((105,145,535,495),24,fill=cream,outline=ink,width=6)
   for y in range(170,480,24):d.line((418,y,418,y+9),fill=accent,width=5)
   for j,w in enumerate([220,150,85]):d.rounded_rectangle((150,225+j*65,150+w,242+j*65),8,fill=accent)
 elif theme=='collect':
  if n==0:
   d.polygon([(100,250),(320,100),(540,250),(540,530),(100,530)],fill=cream,outline=ink,width=6);d.line((105,525,300,350,535,525),fill=accent,width=6);mark(d,theme,0,accent,(215,175,420,430));d.line((105,255,320,405,535,255),fill=ink,width=6)
  elif n==1:
   d.polygon([(95,190),(240,135),(400,210),(545,155),(545,470),(400,525),(240,450),(95,505)],fill=cream,outline=ink,width=6)
   for x,y in [(240,135),(400,210)]:d.line((x,y,x,y+315),fill=accent,width=4)
   mark(d,theme,1,ink,(165,240,465,425))
  else:
   d.polygon([(170,230),(320,100),(470,230),(470,545),(170,545)],fill=cream,outline=ink,width=6);d.ellipse((302,178,338,214),outline=ink,width=5);d.arc((235,40,400,220),140,340,fill=accent,width=6);mark(d,theme,0,accent,(245,300,395,485))
 else:
  if n==0:
   d.rounded_rectangle((130,110,510,530),120,fill=cream,outline=ink,width=7);d.line((320,120,320,520),fill=ink,width=7);d.line((140,330,500,330),fill=ink,width=7);d.ellipse((370,180,445,255),fill=accent);d.polygon([(145,440),(250,360),(315,420),(385,370),(495,450),(495,520),(145,520)],fill='#9ca18b')
  elif n==1:
   d.ellipse((90,390,550,540),fill='#b7bca5');d.rounded_rectangle((170,180,435,430),45,fill=cream,outline=ink,width=7);d.arc((385,200,530,375),270,90,fill=ink,width=10);d.ellipse((180,180,425,245),fill=accent,outline=ink,width=5);d.line((270,140,255,100,280,60),fill=accent,width=8,joint='curve')
  else:
   d.polygon([(125,260),(515,260),(480,535),(160,535)],fill=cream,outline=ink,width=7);d.arc((185,95,455,365),180,360,fill=accent,width=18)
   for x in range(190,480,60):d.line((x,300,x-10,495),fill=accent,width=8)
   for y in range(320,510,55):d.line((150,y,490,y),fill=accent,width=6)
 return im

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--hero-dir',type=Path);args=ap.parse_args()
 m=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'));m['items']=[i for i in m['items'] if i.get('pack')!='atelier-original'];m['collections']=[c for c in m['collections'] if not c['id'].startswith('atelier_')]
 for theme,name,ink,accent,labels,motifs in THEMES:
  specs=[('stamp',str(n),label,stamp(theme,n,label,ink),False) for n,label in enumerate(labels)]
  specs.extend(('sticker',str(n),label,motif(theme,n,ink,accent),False) for n,label in enumerate(motifs))
  hero=(args.hero_dir/f'{theme}.png') if args.hero_dir else ROOT/f'sticker/sticker_atelier_{theme}_hero.png'
  source=Image.open(hero).convert('RGBA')
  if args.hero_dir:
   source.thumbnail((600,600),Image.Resampling.LANCZOS);im=Image.new('RGBA',(640,640));im.alpha_composite(source,((640-source.width)//2,(640-source.height)//2))
  else:im=source
  specs.append(('sticker','hero',name+'场景',im,True))
  for cat,key,label,im,ai in specs:
   ident=f'{cat}_atelier_{theme}_{key}';file=f'{cat}/{ident}.png';thumb=f'thumbs/{cat}/{ident}.png'
   for rel in [file,thumb]:(ROOT/rel).parent.mkdir(parents=True,exist_ok=True)
   im.save(ROOT/file,optimize=True);small=im.copy();small.thumbnail((220,180));small.save(ROOT/thumb,optimize=True)
   m['items'].append(dict(id=ident,name=f'{name} · {label}',cat=cat,tags=[name,label,'原创成套设计'],collection='atelier_'+theme,pack='atelier-original',usage='decorative',file=file,thumb=thumb,w=im.width,h=im.height,alpha=True,tile=False,dominant=accent.lower(),license='CC0-1.0',author='Journal Studio 原创设计'+(' · AI辅助插画' if ai else ' · 程序绘制'),desc='工坊独立构思；吸收留白、信息层次与成套配色方法，不是任何品牌原版。'+('使用内置 imagegen 生成场景插画。' if ai else '可制作印泥或贴纸效果副本。')))
  m['collections'].append(dict(id='atelier_'+theme,name=name+' · 原创套组',color=accent,count=10))
 for cat in m['categories']:cat['count']=sum(i['cat']==cat['id'] for i in m['items'])
 (ROOT/'manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print('Original atelier materials:',len(m['items']))
if __name__=='__main__':main()
