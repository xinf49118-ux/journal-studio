"""48 original motifs, each in color sticker and line-art stamp form (96 assets)."""
from pathlib import Path
import json,math
from PIL import Image,ImageDraw,ImageFilter,ImageOps,ImageEnhance
from craft_materials import INK,GREEN,ROSE,YELLOW,BLUE,CREAM
ROOT=Path(__file__).resolve().parents[1]/'assets/materials'
THEMES={
'garden':('四季花木',[('rose','玫瑰'),('sunflower','向日葵'),('lily','百合'),('clover','四叶草'),('eucalyptus','尤加利'),('bamboo','竹枝'),('maple','枫叶'),('pine','松果')]),
'animals':('森林伙伴',[('dog','小狗'),('fox','狐狸'),('panda','熊猫'),('koala','考拉'),('hedgehog','刺猬'),('squirrel','松鼠'),('penguin','企鹅'),('owl','猫头鹰')]),
'food':('甜点餐桌',[('donut','甜甜圈'),('pizza','披萨'),('burger','汉堡'),('sushi','寿司'),('icecream','冰淇淋'),('cookie','曲奇'),('pear','梨子'),('carrot','胡萝卜')]),
'travel':('旅途户外',[('airplane','飞机'),('train','列车'),('boat','帆船'),('tent','帐篷'),('mountain','山峰'),('passport','旅行证件本'),('compass','指南针'),('map','折叠地图')]),
'festival':('节日时光',[('lantern','灯笼'),('tree','节日树'),('pumpkin','南瓜'),('fireworks','烟花'),('balloons','气球'),('snowman','雪人'),('bell','铃铛'),('candle','蜡烛')]),
'desk':('书桌文具',[('pen','钢笔'),('scissors','剪刀'),('clip','回形针'),('notebook','笔记本'),('paint','水彩盒'),('palette','调色盘'),('clock','闹钟'),('laptop','笔记本电脑')])}
def artwork(k):
 im=Image.new('RGBA',(640,640));d=ImageDraw.Draw(im)
 def line(p,c=INK,n=9):d.line(p,fill=c,width=n,joint='curve')
 def oval(b,c=CREAM,o=INK):d.ellipse(b,fill=c,outline=o,width=7)
 def rect(b,c=CREAM,r=22):d.rounded_rectangle(b,r,fill=c,outline=INK,width=7)
 def poly(p,c):d.polygon(p,fill=c,outline=INK,width=7)
 def eyes(y=340):
  for x in [260,380]:oval((x-8,y-8,x+8,y+8),INK,None)
 def petal(x,y,r=45,c=ROSE):oval((x-r,y-r,x+r,y+r),c)
 if k in ['rose','sunflower','lily','clover']:
  line([(320,570),(320,260)],GREEN,12);oval((190,380,315,455),GREEN);oval((325,430,455,500),GREEN)
  if k=='rose':
   for x,y,r in [(270,210,75),(370,210,75),(320,265,80),(320,195,65),(320,230,40)]:petal(x,y,r)
   d.arc((270,180,370,270),10,300,fill=INK,width=6)
  elif k=='sunflower':
   for i in range(12):a=i*math.pi/6;petal(320+105*math.cos(a),220+105*math.sin(a),43,YELLOW)
   petal(320,220,75,'#a78b66')
   for x,y in [(300,200),(345,215),(310,250)]:petal(x,y,5,INK)
  elif k=='lily':
   for p in [[(320,260),(160,120),(170,270)],[(320,260),(320,65),(390,200)],[(320,260),(505,145),(455,300)],[(320,260),(240,340),(390,350)]]:poly(p,CREAM)
   line([(320,260),(290,170)],YELLOW,10)
  else:
   for x,y in [(250,170),(390,170),(250,300),(390,300)]:petal(x,y,78,GREEN)
 elif k in ['eucalyptus','bamboo']:
  line([(300,575),(350,90)],GREEN,13)
  for i in range(5):
   y=170+i*75;x=343-i*8
   if k=='eucalyptus':oval((x-125,y-45,x-10,y+30),'#a5b6a1');oval((x+5,y-60,x+110,y+15),GREEN)
   else:line([(x-35,y),(x+35,y)],INK,5);poly([(x,y),(x-160,y-60),(x-90,y+15)],GREEN);poly([(x,y),(x+140,y-90),(x+100,y-5)],GREEN)
 elif k=='maple':poly([(320,480),(155,400),(210,330),(100,240),(235,250),(230,120),(300,200),(340,70),(390,210),(480,150),(460,290),(545,300),(460,400)],'#c89b75');line([(320,555),(330,210)],INK,7)
 elif k=='pine':
  oval((190,110,450,550),'#b99b7b')
  for y in range(175,500,65):
   for x in [245,320,395]:d.arc((x-38,y-25,x+38,y+55),0,180,fill=INK,width=6)
 elif k in ['dog','fox','panda','koala','squirrel','owl']:
  if k in ['dog','koala']:oval((95,170,250,430),BLUE if k=='koala' else '#b99b7b');oval((390,170,545,430),BLUE if k=='koala' else '#b99b7b')
  elif k in ['fox','squirrel','owl']:poly([(135,285),(170,95),(290,215),(400,215),(485,95),(515,285)],ROSE if k=='fox' else '#b99b7b')
  else:petal(175,190,65,INK);petal(465,190,65,INK)
  oval((140,185,500,530),BLUE if k=='koala' else ROSE if k=='fox' else CREAM)
  if k=='panda':oval((200,280,295,390),INK);oval((345,280,440,390),INK);petal(250,330,8,CREAM);petal(390,330,8,CREAM)
  elif k=='owl':petal(250,320,65,YELLOW);petal(390,320,65,YELLOW);eyes(320);poly([(300,385),(340,385),(320,425)],YELLOW)
  else:eyes();oval((290,390,350,430),INK);d.arc((280,410,360,465),0,180,fill=INK,width=6)
  if k=='squirrel':line([(320,190),(320,255)],'#b99b7b',20)
 elif k=='hedgehog':
  points=[(110,460)]+[(140+i*34,180+(i%2)*90) for i in range(12)]+[(550,460)];poly(points,'#a58d79');oval((130,310,560,525),CREAM);petal(485,400,7,INK);petal(550,440,14,INK)
 elif k=='penguin':oval((170,80,470,565),BLUE);oval((205,280,435,545),CREAM);eyes(225);poly([(285,265),(355,265),(320,305)],YELLOW);oval((145,520,285,575),YELLOW);oval((355,520,495,575),YELLOW)
 elif k=='donut':oval((105,105,535,535),YELLOW);oval((135,135,505,505),ROSE);oval((255,255,385,385),(0,0,0,0));[line([(x,y),(x+20,y+14)],CREAM,8) for x,y in [(215,180),(400,220),(185,350),(370,430),(430,335)]]
 elif k=='pizza':poly([(110,150),(540,150),(320,550)],YELLOW);line([(115,150),(535,150)],'#bc9670',34);[petal(x,y,30,ROSE) for x,y in [(230,245),(400,250),(320,395)]]
 elif k=='burger':rect((120,410,520,495),YELLOW,35);rect((115,335,525,405),'#a98065',24);poly([(110,315),(190,280),(250,315),(340,280),(420,315),(535,285)],GREEN);d.pieslice((115,110,525,480),180,360,fill=YELLOW,outline=INK,width=7)
 elif k=='sushi':rect((150,200,490,475),INK,60);oval((150,155,490,300),CREAM);oval((235,185,405,270),ROSE);line([(190,330),(450,330)],GREEN,16)
 elif k=='icecream':poly([(195,285),(445,285),(320,570)],YELLOW);petal(240,230,90,CREAM);petal(390,230,90,ROSE);petal(320,120,90,BLUE);line([(240,340),(345,470)],INK,5);line([(390,340),(295,470)],INK,5)
 elif k=='cookie':oval((110,110,530,530),YELLOW);[petal(x,y,20,'#a17c61') for x,y in [(230,200),(400,210),(320,320),(210,390),(390,430)]]
 elif k=='pear':oval((170,230,470,540),'#b6bd8e');oval((245,110,395,360),'#b6bd8e');line([(320,120),(350,70)],INK,12);oval((355,75,470,135),GREEN)
 elif k=='carrot':poly([(180,190),(450,230),(290,565)],'#d9ad79');line([(310,210),(220,70)],GREEN,30);line([(310,210),(390,65)],GREEN,30);line([(310,210),(310,45)],GREEN,24);line([(215,290),(310,310)],INK,6);line([(285,395),(350,410)],INK,6)
 elif k=='airplane':poly([(285,90),(350,90),(360,265),(545,370),(535,420),(360,360),(360,490),(430,535),(420,565),(320,540),(220,565),(210,535),(280,490),(280,360),(105,420),(95,370),(280,265)],BLUE)
 elif k=='train':rect((160,90,480,525),BLUE,55);rect((205,155,435,300),CREAM,12);petal(225,410,23,YELLOW);petal(415,410,23,YELLOW);line([(200,525),(170,575)],INK,14);line([(440,525),(470,575)],INK,14)
 elif k=='boat':poly([(90,405),(550,405),(470,510),(170,510)],BLUE);line([(320,100),(320,405)]);poly([(300,125),(140,365),(300,365)],CREAM);poly([(345,180),(505,365),(345,365)],ROSE)
 elif k=='tent':poly([(85,520),(320,100),(555,520)],YELLOW);poly([(210,520),(320,270),(430,520)],BLUE);line([(320,270),(320,520)],CREAM,8)
 elif k=='mountain':poly([(75,535),(275,120),(465,535)],BLUE);poly([(285,535),(450,230),(585,535)],GREEN);poly([(220,235),(275,120),(335,245),(280,210)],CREAM);petal(460,135,45,YELLOW)
 elif k=='passport':rect((155,90,485,555),GREEN,18);oval((230,225,410,405),None,CREAM);line([(320,225),(320,405)],CREAM,6);line([(230,315),(410,315)],CREAM,6);line([(225,470),(415,470)],CREAM,10)
 elif k=='compass':oval((100,100,540,540),CREAM);poly([(320,170),(365,320),(320,470),(275,320)],ROSE);line([(320,160),(320,110)]);line([(320,480),(320,530)]);line([(160,320),(110,320)]);line([(480,320),(530,320)])
 elif k=='map':poly([(100,150),(245,100),(395,160),(540,110),(540,510),(395,560),(245,500),(100,550)],CREAM);line([(245,105),(245,500)],GREEN,8);line([(395,160),(395,555)],GREEN,8);line([(140,420),(280,280),(430,400),(490,220)],ROSE,13)
 elif k=='lantern':oval((160,130,480,475),ROSE);rect((225,110,415,155),YELLOW,6);rect((225,455,415,500),YELLOW,6);line([(320,500),(320,575)],ROSE,16);d.arc((205,140,435,470),90,270,fill=YELLOW,width=7)
 elif k=='tree':poly([(320,65),(165,250),(220,250),(110,415),(210,415),(135,515),(505,515),(430,415),(530,415),(420,250),(475,250)],GREEN);rect((285,515,355,580),'#b99b7b',4);[petal(x,y,18,ROSE) for x,y in [(280,250),(365,345),(240,440),(410,450)]]
 elif k=='pumpkin':
  for b in [(100,200,370,530),(270,200,540,530),(220,175,420,550)]:oval(b,'#d3a077')
  rect((285,90,345,210),GREEN,8)
 elif k=='fireworks':
  for cx,cy,r,c in [(260,260,180,ROSE),(470,150,85,YELLOW),(440,455,100,BLUE)]:
   for i in range(12):a=i*math.pi/6;line([(cx+math.cos(a)*r*.35,cy+math.sin(a)*r*.35),(cx+math.cos(a)*r,cy+math.sin(a)*r)],c,12)
 elif k=='balloons':
  for x,y,c in [(180,230,ROSE),(320,150,BLUE),(465,235,YELLOW)]:oval((x-80,y-110,x+80,y+110),c);line([(x,y+110),(320,565)],INK,5)
 elif k=='snowman':oval((170,265,470,565),CREAM);oval((215,95,425,305),CREAM);eyes(195);poly([(320,215),(400,235),(320,250)],YELLOW);line([(200,310),(445,310)],ROSE,24);line([(395,310),(400,400)],ROSE,24)
 elif k=='bell':d.pieslice((155,95,485,600),180,360,fill=YELLOW,outline=INK,width=7);rect((135,350,505,420),YELLOW,22);petal(320,435,40,YELLOW);line([(320,95),(320,55)],INK,12)
 elif k=='candle':rect((215,235,425,555),CREAM,12);oval((215,205,425,270),ROSE);poly([(320,75),(265,175),(320,220),(370,175)],YELLOW);line([(320,220),(320,270)],INK,6)
 elif k=='pen':poly([(210,500),(285,150),(365,170),(300,520),(230,575)],BLUE);poly([(285,150),(320,65),(365,170)],YELLOW);line([(320,65),(320,145)],INK,5)
 elif k=='scissors':oval((120,360,285,535),ROSE);oval((355,360,520,535),BLUE);line([(220,390),(435,90)],INK,18);line([(420,390),(205,90)],INK,18);petal(320,255,14,YELLOW)
 elif k=='clip':d.arc((160,80,490,550),0,300,fill=BLUE,width=23);d.arc((220,130,430,500),180,540,fill=BLUE,width=23);line([(160,315),(160,180)],BLUE,23)
 elif k=='notebook':rect((145,85,495,555),BLUE,14);line([(210,90),(210,550)],INK,8);rect((270,220,440,330),CREAM,4);[line([(125,y),(170,y)],INK,12) for y in range(140,520,70)]
 elif k=='paint':rect((105,160,535,470),CREAM,16);[rect((145+(i%3)*125,200+(i//3)*125,235+(i%3)*125,290+(i//3)*125),c,8) for i,c in enumerate([ROSE,YELLOW,BLUE,GREEN,'#b5a0bb','#b99b7b'])]
 elif k=='palette':oval((110,130,530,520),CREAM);oval((360,345,440,445),(0,0,0,0));[petal(x,y,34,c) for x,y,c in [(220,220,ROSE),(340,200,YELLOW),(440,260,BLUE),(210,365,GREEN)]]
 elif k=='clock':oval((145,155,495,505),CREAM);d.arc((120,85,310,245),180,360,fill=BLUE,width=30);d.arc((330,85,520,245),180,360,fill=BLUE,width=30);line([(320,240),(320,330),(400,380)],INK,12);line([(215,490),(185,550)],INK,14);line([(425,490),(455,550)],INK,14)
 elif k=='laptop':rect((125,115,515,415),BLUE,16);rect((155,145,485,380),CREAM,5);poly([(125,415),(515,415),(570,520),(70,520)],BLUE);line([(245,475),(395,475)],INK,6)
 else:raise ValueError(k)
 return im
def line_stamp(im):
 small=im.resize((480,480),Image.Resampling.LANCZOS);white=Image.new('RGBA',small.size,'white');white.alpha_composite(small);edge=ImageOps.grayscale(white).filter(ImageFilter.FIND_EDGES);edge=ImageEnhance.Contrast(edge).enhance(2);edge=edge.point(lambda x: 240 if x>45 else 0).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(.4));d=ImageDraw.Draw(edge);d.rectangle((0,0,479,479),outline=0,width=4);out=Image.new('RGBA',small.size,INK);out.putalpha(edge);return out
def main():
 m=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'));m['items']=[i for i in m['items'] if i.get('pack')!='motif-original'];m['collections']=[c for c in m['collections'] if not c['id'].startswith('motif_')]
 for theme,(name,specs) in THEMES.items():
  collection='motif_'+theme
  for key,label in specs:
   colored=artwork(key)
   for cat,im in [('sticker',colored),('stamp',line_stamp(colored))]:
    ident=f'{cat}_motif_{key}';file=f'{cat}/{ident}.png';thumb=f'thumbs/{cat}/{ident}.png'
    for rel in [file,thumb]:(ROOT/rel).parent.mkdir(parents=True,exist_ok=True)
    im.save(ROOT/file,optimize=True);small=im.copy();small.thumbnail((220,180));small.save(ROOT/thumb,optimize=True)
    m['items'].append(dict(id=ident,name=name+' · '+label+('线稿章' if cat=='stamp' else '贴纸'),cat=cat,tags=[name,label,'图案印章' if cat=='stamp' else '彩色贴纸','原创素材'],collection=collection,pack='motif-original',usage='decorative',file=file,thumb=thumb,w=im.width,h=im.height,alpha=True,tile=False,dominant=INK.lower(),license='CC0-1.0',author='Journal Studio 原创程序绘制',desc='原创图案的彩色贴纸或线稿印章；可换印泥、裁切和制作花边；非品牌原版'))
  m['collections'].append(dict(id=collection,name=name,color=GREEN,count=16))
 for c in m['categories']:c['count']=sum(i['cat']==c['id'] for i in m['items'])
 (ROOT/'manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps({'materials':len(m['items']),'motifs':48,'new_assets':96}))
if __name__=='__main__':main()
