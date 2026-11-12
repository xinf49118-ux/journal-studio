"""72 original stamps and stickers. Never downloads brand artwork."""
from pathlib import Path
import json, math, random
from PIL import Image, ImageDraw
from make_materials import get_font, draw_text_center
ROOT=Path(__file__).resolve().parents[1]/'assets/materials'
STAMPS=['今日重点','已完成','待办清单','灵感记录','读书摘录','电影之夜','运动打卡','喝水记录','早睡计划','出发旅行','本周回顾','下月计划','生日快乐','谢谢自己','慢慢来','值得期待','好好吃饭','学习时间','专注一下','休息片刻','存钱计划','小小成就','天气晴朗','雨天日记','寄给未来','旅途见闻','收藏快乐','重要事项','预约提醒','购买清单','咖啡时光','居家整理','植物观察','拍照留念','今日心情','周末散步']
MOTIFS=['tulip','daisy','lavender','cactus','monstera','strawberry','lemon','cherry','peach','avocado','toast','croissant','cake','pudding','tea','milk','soda','ramen','cat','rabbit','bear','bird','fish','whale','rainbow','moon','sun','rain','camera','headphones','backpack','bicycle','umbrella','gift','letter','sneaker']
LABELS=['郁金香','雏菊','薰衣草','仙人掌','龟背叶','草莓','柠檬','樱桃','蜜桃','牛油果','吐司','可颂','蛋糕','布丁','茶壶','牛奶','汽水','面条','小猫','兔子','小熊','小鸟','小鱼','鲸鱼','彩虹','月亮','太阳','雨云','相机','耳机','背包','自行车','雨伞','礼物','信件','运动鞋']
INK='#765c54';GREEN='#78907b';ROSE='#d8a29b';YELLOW='#dfc88e';BLUE='#9db8c3';CREAM='#f4e6c9'
def sticker(key):
 im=Image.new('RGBA',(640,640));d=ImageDraw.Draw(im)
 def line(p,c=INK,n=9):d.line(p,fill=c,width=n,joint='curve')
 def oval(b,c,o=INK):d.ellipse(b,fill=c,outline=o,width=7)
 def rect(b,c=CREAM,r=24):d.rounded_rectangle(b,r,fill=c,outline=INK,width=7)
 def eyes(x=320,y=330):
  for dx in [-50,50]:oval((x+dx-7,y-7,x+dx+7,y+7),INK,None)
 if key in ['tulip','daisy','lavender']:
  line([(310,565),(320,210)],GREEN,12);d.ellipse((200,350,310,470),fill=GREEN);d.ellipse((325,380,445,470),fill=GREEN)
  if key=='tulip':d.polygon([(205,115),(260,180),(320,105),(380,180),(435,115),(420,295),(320,350),(220,295)],fill=ROSE,outline=INK,width=6)
  elif key=='daisy':
   for i in range(8):a=i*math.pi/4;x=320+90*math.cos(a);y=210+90*math.sin(a);oval((x-50,y-65,x+50,y+65),CREAM)
   oval((275,165,365,255),YELLOW)
  else:
   for i in range(7):oval((270+i%2*35,70+i*26,335+i%2*35,125+i*26),'#aa9aba')
 elif key=='cactus':
  rect((265,100,370,440),GREEN,45);rect((150,230,260,345),GREEN,30);rect((385,190,490,300),GREEN,30);line([(255,300),(320,300)],GREEN,42);line([(360,250),(420,250)],GREEN,42);d.polygon([(220,420),(420,420),(390,565),(250,565)],fill=ROSE,outline=INK,width=7)
 elif key=='monstera':
  line([(315,560),(330,230)],GREEN,12);d.polygon([(320,440),(130,300),(135,150),(250,95),(320,165),(410,100),(510,170),(490,325)],fill=GREEN,outline=INK,width=7)
  for p in [[(320,390),(200,220)],[(320,350),(445,200)],[(320,300),(240,150)]]:line(p,CREAM,14)
 elif key in ['strawberry','lemon','cherry','peach','avocado']:
  if key=='strawberry':
   d.polygon([(140,210),(190,140),(450,140),(510,210),(425,440),(320,535),(215,440)],fill=ROSE,outline=INK,width=7);d.polygon([(180,145),(260,100),(320,155),(390,100),(470,145),(340,225)],fill=GREEN)
   for x,y in [(240,260),(330,275),(420,255),(270,360),(370,370),(320,445)]:oval((x-5,y-10,x+5,y+10),YELLOW,None)
  elif key=='lemon':oval((120,180,520,465),YELLOW);line([(215,220),(185,270)],CREAM,12);d.ellipse((345,110,490,175),fill=GREEN)
  elif key=='cherry':oval((110,320,315,530),ROSE);oval((340,300,545,505),ROSE);line([(215,330),(345,120),(440,310)],GREEN,11);d.ellipse((340,100,495,170),fill=GREEN)
  elif key=='peach':oval((135,155,340,495),ROSE);oval((280,155,505,495),'#e6b4a3');d.arc((250,155,370,480),270,90,fill=INK,width=6);d.ellipse((330,90,470,155),fill=GREEN)
  else:oval((160,110,490,550),GREEN);oval((190,145,460,520),'#d6d3a0');oval((245,300,405,465),'#aa7e61')
 elif key in ['toast','croissant','cake','pudding']:
  if key=='toast':rect((150,140,490,540),'#be9367',70);rect((185,175,455,505),CREAM,55);rect((270,270,365,365),YELLOW,12)
  elif key=='croissant':
   d.pieslice((95,150,545,550),180,360,fill=YELLOW,outline=INK,width=7);d.ellipse((195,235,445,500),fill=(0,0,0,0))
   for x in [190,270,350,430]:line([(x,210),(x-20,330)],'#af805a',10)
  elif key=='cake':d.polygon([(140,270),(450,160),(510,450),(160,515)],fill=CREAM,outline=INK,width=7);line([(160,370),(475,275),(490,355),(160,455)],ROSE,32);oval((280,130,365,210),ROSE)
  else:oval((100,455,540,550),BLUE);d.polygon([(220,180),(420,180),(480,475),(160,475)],fill=YELLOW,outline=INK,width=7);oval((220,150,420,215),'#ad7f60');oval((285,100,350,165),ROSE)
 elif key in ['tea','milk','soda','ramen']:
  if key=='tea':oval((135,220,475,490),BLUE);d.arc((420,245,555,425),270,90,fill=INK,width=18);d.polygon([(135,290),(65,235),(90,370),(160,390)],fill=BLUE,outline=INK,width=7);line([(210,210),(400,210)],INK,12);oval((285,160,345,225),BLUE)
  elif key=='milk':d.polygon([(180,190),(250,100),(420,100),(460,190),(460,540),(180,540)],fill=CREAM,outline=INK,width=7);line([(180,190),(460,190)]);rect((230,285,410,430),BLUE,8);draw_text_center(d,320,355,'MILK',get_font(34),INK)
  elif key=='soda':rect((220,170,425,550),BLUE,35);line([(320,170),(320,90),(420,90)],ROSE,15);oval((225,150,420,205),CREAM);line([(245,270),(390,270)],CREAM,8)
  else:d.pieslice((105,190,535,560),0,180,fill=ROSE,outline=INK,width=7);oval((105,185,535,310),YELLOW);[line([(190+i*40,215),(210+i*40,260)],CREAM,12) for i in range(6)];line([(350,240),(500,80)],INK,11);line([(380,250),(535,100)],INK,11)
 elif key in ['cat','rabbit','bear']:
  if key=='rabbit':oval((185,60,295,330),CREAM);oval((350,60,455,330),CREAM)
  elif key=='bear':oval((110,140,245,280),'#bfa17f');oval((395,140,530,280),'#bfa17f')
  else:d.polygon([(145,310),(160,100),(290,220),(400,190),(500,100),(520,320)],fill=CREAM,outline=INK,width=7)
  oval((125,210,515,550),CREAM if key!='bear' else '#bfa17f');eyes(y=360);d.arc((290,380,350,435),0,180,fill=INK,width=7)
  if key=='cat':
   for side in [-1,1]:line([(320+side*90,400),(320+side*170,380)]);line([(320+side*90,420),(320+side*165,440)])
 elif key in ['bird','fish','whale']:
  if key=='bird':oval((150,155,485,485),BLUE);d.polygon([(470,270),(560,310),(475,340)],fill=YELLOW,outline=INK,width=7);oval((320,250,430,420),CREAM);oval((410,230,430,250),INK,None);line([(260,480),(240,550)]);line([(365,480),(380,550)])
  elif key=='fish':oval((105,180,450,465),BLUE);d.polygon([(430,310),(550,175),(550,475)],fill=ROSE,outline=INK,width=7);oval((185,270,207,292),INK,None);d.arc((220,190,350,455),270,90,fill=INK,width=7)
  else:oval((90,235,485,480),BLUE);d.polygon([(460,350),(550,205),(580,300),(530,405)],fill=BLUE,outline=INK,width=7);oval((180,335,200,355),INK,None);line([(260,220),(240,150),(190,130)],BLUE,12);line([(260,220),(290,140),(335,130)],BLUE,12)
 elif key in ['rainbow','moon','sun','rain']:
  if key=='rainbow':
   for r,c in [(220,ROSE),(180,YELLOW),(140,GREEN),(100,BLUE)]:d.arc((320-r,330-r,320+r,330+r),180,360,fill=c,width=33)
  elif key=='moon':oval((135,100,510,520),YELLOW);d.ellipse((255,70,565,400),fill=(0,0,0,0));d.polygon([(490,390),(505,425),(545,430),(515,450),(525,490),(490,465),(455,490),(465,450),(435,430),(475,425)],fill=ROSE)
  elif key=='sun':
   oval((195,195,445,445),YELLOW)
   for i in range(12):a=i*math.pi/6;line([(320+160*math.cos(a),320+160*math.sin(a)),(320+220*math.cos(a),320+220*math.sin(a))],YELLOW,17)
  else:
   for x,y in [(200,220),(315,175),(430,225)]:oval((x-95,y-75,x+95,y+85),BLUE)
   rect((135,225,510,330),BLUE,45)
   for x in [200,315,430]:line([(x,390),(x-30,480)],BLUE,16)
 elif key=='camera':rect((100,210,540,475),BLUE,25);rect((195,160,320,215),BLUE,8);oval((230,245,415,430),CREAM);oval((265,280,380,395),INK);rect((445,245,495,280),YELLOW,5)
 elif key=='headphones':d.arc((120,90,520,515),180,360,fill=INK,width=29);rect((110,280,215,490),BLUE,45);rect((425,280,530,490),BLUE,45)
 elif key=='backpack':rect((180,135,460,550),ROSE,60);d.arc((245,65,395,200),180,360,fill=INK,width=13);rect((220,340,420,490),CREAM,16);line([(250,230),(390,230)])
 elif key=='bicycle':
  oval((65,340,270,545),None);oval((385,340,590,545),None);line([(165,440),(270,250),(350,440),(165,440),(420,250),(490,440)],GREEN,13);line([(270,250),(420,250)],GREEN,13);line([(235,230),(310,230)],INK,16);line([(410,250),(395,180),(450,180)],INK,12)
 elif key=='umbrella':d.pieslice((95,95,545,535),180,360,fill=ROSE,outline=INK,width=7);line([(320,315),(320,530)],INK,12);d.arc((230,485,320,575),0,180,fill=INK,width=12);line([(320,95),(220,315)]);line([(320,95),(420,315)])
 elif key=='gift':rect((145,245,495,535),BLUE,8);rect((120,200,520,270),BLUE,8);d.rectangle((290,200,350,535),fill=ROSE);d.arc((200,95,330,230),0,350,fill=ROSE,width=18);d.arc((315,95,445,230),190,540,fill=ROSE,width=18)
 elif key=='letter':rect((95,175,545,485),CREAM,12);line([(100,180),(320,360),(540,180)]);line([(100,480),(260,340)]);line([(540,480),(380,340)]);oval((285,310,355,380),ROSE)
 elif key=='sneaker':d.polygon([(105,255),(235,180),(350,315),(510,355),(560,470),(95,470)],fill=BLUE,outline=INK,width=7);rect((90,465,565,515),CREAM,14);[line([(240+i*35,265+i*20),(300+i*35,250+i*20)],CREAM,12) for i in range(3)]
 return im
def stamp(index,label):
 im=Image.new('RGBA',(480,320));d=ImageDraw.Draw(im);color=['#856059','#657f72','#747690','#986f48'][index%4]
 if index%3==0:d.ellipse((32,14,448,306),outline=color,width=7);d.ellipse((45,27,435,293),outline=color,width=3)
 elif index%3==1:d.rounded_rectangle((20,45,460,275),20,outline=color,width=7);d.line([(40,230),(440,230)],fill=color,width=3)
 else:
  d.rectangle((22,42,458,278),outline=color,width=6)
  for x in range(35,450,20):d.line([(x,53),(x+9,53)],fill=color,width=3);d.line([(x,266),(x+9,266)],fill=color,width=3)
 draw_text_center(d,240,147,label,get_font(47),color);draw_text_center(d,240,212,['JOURNAL STUDIO','MY DAILY NOTES','A LITTLE MOMENT'][index%3],get_font(18),color)
 rng=random.Random(index+901);pix=im.load()
 for _ in range(1400):x=rng.randrange(480);y=rng.randrange(320);r,g,b,a=pix[x,y];pix[x,y]=(r,g,b,int(a*rng.uniform(.05,.7)))
 return im,color
def main():
 m=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'));m['items']=[i for i in m['items'] if i.get('pack')!='craft-original'];m['collections']=[c for c in m['collections'] if not c['id'].startswith('craft_')]
 for cat,specs,collection,name in [('stamp',list(enumerate(STAMPS)),'craft_stamps','日常文字印章'),('sticker',list(zip(MOTIFS,LABELS)),'craft_stickers','生活小物贴纸')]:
  for key,label in specs:
   if cat=='stamp':im,color=stamp(key,label)
   else:im=sticker(key);color=GREEN
   ident=f'{cat}_craft_{key}';file=f'{cat}/{ident}.png';thumb=f'thumbs/{cat}/{ident}.png'
   for rel in [file,thumb]:(ROOT/rel).parent.mkdir(parents=True,exist_ok=True)
   im.save(ROOT/file,optimize=True);small=im.copy();small.thumbnail((220,180));small.save(ROOT/thumb,optimize=True)
   m['items'].append(dict(id=ident,name=name+' · '+label,cat=cat,tags=[label,name,'印章贴纸小工坊','原创素材'],collection=collection,pack='craft-original',usage='decorative',file=file,thumb=thumb,w=im.width,h=im.height,alpha=True,tile=False,dominant=color.lower(),license='CC0-1.0',author='Journal Studio 原创程序绘制',desc='工坊独立绘制，非品牌原版；可在编辑器制作印泥或贴纸效果副本'))
  m['collections'].append(dict(id=collection,name=name,color=INK,count=36))
 for cat in m['categories']:cat['count']=sum(i['cat']==cat['id'] for i in m['items'])
 (ROOT/'manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps({'materials':len(m['items']),'added':72}))
if __name__=='__main__':main()
