"""96 original code-drawn daily stickers; deterministic, no external artwork."""
from pathlib import Path
import json, math
from PIL import Image, ImageDraw
from make_materials import get_font
from craft_materials import INK,GREEN,ROSE,YELLOW,BLUE,CREAM
ROOT=Path(__file__).resolve().parents[1]/'assets/materials'
THEMES={
 'people':('人物动作',[('reading','书桌阅读'),('writing','写手账'),('working','电脑办公'),('coffee','坐下喝咖啡'),('cooking','厨房做饭'),('watering','给花浇水'),('walking','提包散步'),('running','慢跑的人'),('yoga','伸展瑜伽'),('sleeping','抱枕入睡'),('shopping','购物归来'),('photo','举起相机')]),
 'weather':('天气天象',[('partly_cloudy','晴间多云'),('storm','雷雨天气'),('fog','雾气朦胧'),('snow_cloud','云朵飘雪'),('wind','微风吹拂'),('hot_day','高温晴日'),('cold_day','低温寒日'),('night_stars','繁星之夜'),('meteor','流星划过'),('planet','环绕行星'),('moon_phases','月相变化'),('sunrise','山间日出')]),
 'home':('家务日常',[('laundry','洗衣时间'),('ironing','熨烫衣物'),('vacuum','吸尘清洁'),('mop','拖地打扫'),('wash_dishes','洗碗整理'),('trash','倒垃圾'),('recycle','分类回收'),('organize','抽屉收纳'),('bed_make','整理床铺'),('sewing','缝补衣物'),('lightbulb','换灯泡'),('key','回家的钥匙')]),
 'fitness':('运动健康',[('dumbbells','哑铃训练'),('yoga_mat','展开瑜伽垫'),('water_bottle','运动水壶'),('swim','游泳泳镜'),('gym_timer','运动秒表'),('tennis','网球拍'),('badminton','羽毛球'),('basketball','篮球'),('soccer','足球'),('roller_skates','轮滑鞋'),('jump_rope','跳绳'),('first_aid','随身急救包')]),
 'pets':('宠物日常',[('cat_sleep','蜷睡小猫'),('cat_play','小猫玩球'),('dog_walk','遛狗时间'),('dog_bone','小狗骨头'),('pet_bowl','宠物饭碗'),('paw','软软爪印'),('cat_tree','猫爬架'),('hamster','胖胖仓鼠'),('turtle','小乌龟'),('pet_carrier','宠物外出包'),('pet_brush','梳毛刷'),('pet_toy','逗猫羽毛棒')]),
 'collage':('拼贴装饰',[('kraft_tag','牛皮纸吊牌'),('ticket','旅行票根'),('polaroid','拍立得相框'),('torn_paper','撕边便签纸'),('doily','蕾丝纸垫'),('vintage_key','复古钥匙'),('postmark','旅行邮戳'),('checker_ribbon','格纹飘带'),('lace','花边纸条'),('flower_wreath','小花环'),('circle_label','圆形标签'),('bow','蝴蝶结')]),
 'commute':('通勤办公',[('subway','地铁进站'),('bus','公交出行'),('car','小汽车'),('scooter','滑板车'),('traffic_light','交通信号灯'),('briefcase','工作公文包'),('id_badge','工牌挂绳'),('meeting','讨论开会'),('calendar','桌面日历'),('phone','手机消息'),('battery','电量补给'),('parcel','快递包裹')]),
 'moods':('情绪表情',[('happy','开心微笑'),('sad','有点难过'),('angry','生气皱眉'),('surprised','惊讶时刻'),('sleepy','困困想睡'),('focused','认真专注'),('shy','害羞脸红'),('cheer','欢呼加油'),('confused','疑问困惑'),('calm','平静放松'),('love','心动喜欢'),('proud','为自己骄傲')])
}

def artwork(theme,key):
 S=2;im=Image.new('RGBA',(640*S,640*S));d=ImageDraw.Draw(im)
 def coords(v):return tuple(round(a*S) for a in v)
 def line(p,c=INK,n=7):d.line([coords(v) for v in p],fill=c,width=round(n*S),joint='curve')
 def oval(b,c=CREAM,o=INK,n=5):d.ellipse(coords(b),fill=c,outline=o,width=round(n*S))
 def rect(b,c=CREAM,r=18,o=INK,n=5):d.rounded_rectangle(coords(b),radius=r*S,fill=c,outline=o,width=round(n*S))
 def poly(p,c=CREAM,o=INK):d.polygon([coords(v) for v in p],fill=c,outline=o,width=5*S)
 def arc(b,a,z,c=INK,n=6):d.arc(coords(b),a,z,fill=c,width=round(n*S))
 def txt(s,x,y,size=32,c=INK):d.text(coords((x,y)),s,font=get_font(size*S),fill=c)
 def dot(x,y,r=8,c=INK):oval((x-r,y-r,x+r,y+r),c,None)
 def star(x,y,r=30,c=YELLOW):poly([(x+math.cos(i*math.pi/5-math.pi/2)*(r if i%2==0 else r*.45),y+math.sin(i*math.pi/5-math.pi/2)*(r if i%2==0 else r*.45)) for i in range(10)],c)
 def heart(x,y,r=30,c=ROSE):oval((x-r,y-r,x,y),c,None);oval((x,y-r,x+r,y),c,None);poly([(x-r,y-r*.5),(x+r,y-r*.5),(x,y+r)],c,None)
 def cloud(x=320,y=260):
  for b in [(x-150,y-20,x-10,y+100),(x-90,y-80,x+55,y+100),(x+5,y-40,x+150,y+100)]:oval(b,'#e2e9e6')
  rect((x-130,y+20,x+130,y+100),'#e2e9e6',35)
 def leaf(x,y,angle=0,c=GREEN):
  dx=math.cos(angle)*50;dy=math.sin(angle)*50;poly([(x-dx,y-dy),(x-dy*.45,y+dx*.45),(x+dx,y+dy),(x+dy*.45,y-dx*.45)],c)
 def face(x,y,r=60):
  oval((x-r,y-r,x+r,y+r),CREAM);dot(x-20,y,4);dot(x+20,y,4);arc((x-18,y+7,x+18,y+30),0,180,n=3)
 if theme=='people':
  if key=='sleeping':
   rect((95,350,545,505),BLUE,35);rect((115,310,280,400),CREAM,22);oval((155,265,300,395),'#b99b7b');face(230,335,52);rect((280,340,530,495),ROSE,28);arc((195,327,217,340),0,180,n=4);arc((238,327,260,340),0,180,n=4);txt('z z',405,215,45)
  else:
   oval((235,100,385,275),'#8f7263');face(310,205,63);arc((250,130,370,205),180,355,c='#8f7263',n=28)
   coat=GREEN if key in ['watering','walking','yoga'] else BLUE if key in ['working','running','photo'] else ROSE
   poly([(260,275),(355,275),(390,440),(225,440)],coat)
   if key not in ['running','yoga']:line([(268,440),(250,535),(205,540)],INK,15);line([(345,440),(380,535),(425,535)],INK,15)
   if key in ['reading','writing','working','coffee']:
    line([(130,425),(525,425)],INK,13);line([(160,425),(155,550)],INK,10);line([(495,425),(510,550)],INK,10)
    line([(260,295),(230,355),(300,405)],CREAM,22);line([(355,295),(405,355),(365,405)],CREAM,22)
    if key=='reading':poly([(230,350),(315,370),(315,425),(230,405)],CREAM);poly([(315,370),(410,350),(410,405),(315,425)],YELLOW)
    elif key=='working':rect((275,320,460,410),BLUE,8);rect((290,335,445,395),CREAM,3);line([(260,416),(475,416)],INK,9)
    elif key=='writing':poly([(270,355),(410,370),(390,415),(255,400)],CREAM);line([(365,347),(325,390)],INK,8);line([(278,375),(335,385)],ROSE,4)
    else:rect((350,365,420,417),CREAM,9);arc((400,370,450,410),270,450,n=7);arc((350,320,390,365),180,360,n=4)
   elif key=='cooking':
    line([(255,300),(180,360),(250,385)],CREAM,22);line([(355,300),(420,355)],CREAM,22);rect((125,390,525,485),CREAM,12);oval((180,365,410,435),BLUE);line([(400,385),(490,350)],INK,13);rect((285,295,335,420),YELLOW,8);star(440,255,20)
   elif key=='watering':
    line([(355,300),(415,360)],CREAM,22);line([(260,300),(215,370)],CREAM,22);rect((395,335,480,410),BLUE,12);line([(470,350),(525,400)],BLUE,17);arc((385,310,450,375),180,330,n=6);poly([(480,490),(555,490),(540,560),(495,560)],ROSE);line([(515,495),(520,425)],GREEN,7);leaf(510,445,-.8);leaf(535,450,.9);line([(525,410),(520,425)],BLUE,4)
   elif key=='walking':line([(255,300),(190,400)],CREAM,22);line([(355,300),(430,390)],CREAM,22);rect((415,385,505,490),YELLOW,14);arc((425,355,495,420),180,360,n=8)
   elif key=='running':
    line([(260,300),(195,330),(170,285)],CREAM,22);line([(355,300),(410,335),(445,295)],CREAM,22);line([(270,440),(315,485),(250,550)],INK,17);line([(345,440),(410,465),(455,420)],INK,17);line([(105,420),(180,420)],BLUE,7);line([(115,455),(160,455)],BLUE,7)
   elif key=='yoga':line([(260,300),(200,240),(165,175)],CREAM,22);line([(355,300),(415,240),(450,175)],CREAM,22);rect((120,545,525,567),BLUE,10);line([(270,440),(200,505),(390,520)],INK,18);line([(345,440),(420,505),(230,520)],INK,18)
   elif key=='shopping':
    line([(255,300),(190,395)],CREAM,22);line([(355,300),(430,395)],CREAM,22)
    for a,c in [(120,YELLOW),(400,ROSE)]:rect((a,400,a+105,510),c,8);arc((a+15,365,a+90,435),180,360,n=7)
   else:line([(255,300),(220,240),(280,230)],CREAM,22);line([(355,300),(410,240),(340,230)],CREAM,22);rect((260,195,385,270),INK,12);oval((295,205,350,260),BLUE);dot(365,210,5,CREAM)
 elif theme=='weather':
  if key in ['partly_cloudy','storm','fog','snow_cloud']:
   if key=='partly_cloudy':
    dot(415,180,90,YELLOW)
    for i in range(8):a=i*math.pi/4;line([(415+math.cos(a)*105,180+math.sin(a)*105),(415+math.cos(a)*135,180+math.sin(a)*135)],YELLOW,8)
   cloud(310,265)
   if key=='storm':poly([(325,380),(260,460),(320,455),(280,550),(395,425),(335,430)],YELLOW);line([(190,405),(170,455)],BLUE,10);line([(465,405),(445,455)],BLUE,10)
   elif key=='fog':
    for yy,xx in [(410,150),(450,115),(490,170)]:line([(xx,yy),(510,yy)],BLUE,12)
   elif key=='snow_cloud':
    for xx,yy in [(190,440),(320,495),(450,435)]:
     for a in [0,math.pi/3,2*math.pi/3]:line([(xx-25*math.cos(a),yy-25*math.sin(a)),(xx+25*math.cos(a),yy+25*math.sin(a))],BLUE,7)
  elif key=='wind':
   for yy,end in [(220,450),(320,510),(420,405)]:line([(110,yy),(end-60,yy)],BLUE,12);arc((end-120,yy-90,end,yy),270,450,BLUE,12)
   leaf(190,490,.6);leaf(400,155,-.6)
  elif key in ['hot_day','cold_day']:
   rect((285,150,365,430),CREAM,38);oval((255,375,395,520),ROSE if key=='hot_day' else BLUE);line([(325,420),(325,210 if key=='hot_day' else 350)],ROSE if key=='hot_day' else BLUE,26)
   for yy in [220,265,310]:line([(355,yy),(385,yy)],INK,6)
   if key=='hot_day':dot(175,200,65,YELLOW);[line([(105+i*40,110),(125+i*40,80)],YELLOW,7) for i in range(3)]
   else:
    for a in [0,math.pi/3,2*math.pi/3]:line([(175-65*math.cos(a),220-65*math.sin(a)),(175+65*math.cos(a),220+65*math.sin(a))],BLUE,10)
  elif key=='night_stars':oval((180,130,425,440),YELLOW);oval((270,95,465,360),(0,0,0,0),None);star(465,425,45);star(135,265,30);star(420,130,25);dot(170,490,9,BLUE)
  elif key=='meteor':poly([(130,480),(445,110),(360,410)],YELLOW);poly([(180,480),(500,190),(350,455)],ROSE);star(225,460,75);star(490,420,28);star(145,165,22)
  elif key=='planet':oval((185,180,465,460),ROSE);arc((95,255,555,380),0,360,BLUE,18);arc((225,235,425,390),180,330,CREAM,18);star(140,145,25);star(505,470,26)
  elif key=='moon_phases':
   for i in range(5):
    xx=105+i*105;oval((xx-40,265,xx+40,345),YELLOW)
    if i!=2:oval((xx-40+(-22 if i<2 else 22),255,xx+40+(-22 if i<2 else 22),335),(0,0,0,0),None)
   arc((100,180,540,440),195,345,BLUE,5);star(320,145,28)
  else:dot(320,285,110,YELLOW);poly([(90,460),(235,260),(390,460)],GREEN);poly([(250,460),(430,225),(565,460)],BLUE);line([(105,495),(540,495)],INK,7);line([(180,530),(465,530)],BLUE,7)
 elif theme=='home':
  if key=='laundry':rect((145,120,495,535),CREAM,22);rect((170,145,470,215),BLUE,8);oval((205,260,440,495),BLUE);oval((235,290,410,465),CREAM);arc((240,330,405,450),0,175,ROSE,30);dot(200,180,12);dot(430,180,12)
  elif key=='ironing':poly([(125,440),(230,255),(440,255),(525,440)],BLUE);rect((245,170,415,275),CREAM,35);line([(130,465),(525,465)],INK,9);arc((185,95,255,190),180,330,ROSE,7)
  elif key=='vacuum':oval((135,350,360,535),ROSE);dot(195,515,22);dot(315,515,22);line([(300,375),(365,240),(440,230),(465,445)],INK,18);line([(465,445),(515,490)],BLUE,18);poly([(430,495),(540,470),(555,510),(445,535)],BLUE)
  elif key=='mop':line([(180,110),(390,440)],GREEN,20);rect((270,415,510,490),BLUE,15);poly([(280,485),(500,485),(525,555),(255,555)],CREAM);[line([(xx,490),(xx-10,545)],BLUE,5) for xx in range(285,500,35)]
  elif key=='wash_dishes':oval((130,240,435,500),BLUE);oval((165,270,400,470),CREAM);rect((365,360,525,430),YELLOW,22);arc((260,110,430,290),180,360,n=13);line([(430,195),(430,285)],INK,13);[dot(xx,yy,18,'#dbe8ed') for xx,yy in [(205,180),(145,225),(510,280)]]
  elif key in ['trash','recycle']:
   rect((185,190,455,525),GREEN if key=='recycle' else BLUE,20);rect((155,155,485,215),CREAM,10);rect((260,120,380,165),INK,8)
   if key=='recycle':
    for a in [0,120,240]:
     aa=math.radians(a);xx=320+65*math.cos(aa);yy=350+65*math.sin(aa);star(xx,yy,24,CREAM)
    txt('RECYCLE',223,445,25,CREAM)
   else:
    for xx in [245,320,395]:line([(xx,255),(xx,460)],CREAM,10)
  elif key=='organize':
   rect((120,155,520,530),CREAM,15)
   for i,c in enumerate([ROSE,BLUE,GREEN]):rect((145,180+i*110,495,275+i*110),c,8);rect((270,200+i*110,370,225+i*110),CREAM,6)
  elif key=='bed_make':rect((115,270,525,525),GREEN,15);rect((135,250,310,345),CREAM,18);rect((335,250,505,345),CREAM,18);rect((120,350,520,495),BLUE,10);line([(150,525),(150,565)],INK,14);line([(490,525),(490,565)],INK,14)
  elif key=='sewing':rect((155,260,480,435),ROSE,12);line([(185,290),(445,405)],CREAM,6);line([(200,405),(430,290)],CREAM,6);line([(365,90),(235,510)],INK,11);oval((345,115,375,180),None);arc((355,145,540,370),270,520,BLUE,8)
  elif key=='lightbulb':oval((200,100,440,385),YELLOW);rect((255,350,385,440),BLUE,15);rect((280,435,360,475),INK,10);line([(300,350),(275,235),(365,235),(340,350)],INK,6);[line([(xx,yy),(xx+dx,yy+dy)],YELLOW,10) for xx,yy,dx,dy in [(130,235,-55,0),(500,235,55,0),(175,115,-35,-35),(465,115,35,-35)]]
  else:oval((120,180,320,380),YELLOW);oval((175,235,265,325),(0,0,0,0));poly([(285,285),(520,420),(475,490),(425,460),(440,435),(395,410),(375,445),(335,420),(350,385),(250,330)],YELLOW)
 elif theme=='fitness':
  if key=='dumbbells':
   line([(160,240),(480,430)],INK,28)
   for xx,yy in [(160,240),(480,430)]:rect((xx-55,yy-90,xx+55,yy+90),BLUE,20);rect((xx-75,yy-55,xx+75,yy+55),GREEN,14)
  elif key=='yoga_mat':rect((150,175,465,520),ROSE,18);oval((150,130,465,245),BLUE);oval((180,150,435,220),ROSE);[line([(185,yy),(430,yy)],CREAM,6) for yy in [310,370,430]]
  elif key=='water_bottle':rect((230,155,410,545),BLUE,35);rect((250,100,390,180),GREEN,14);rect((245,280,395,410),CREAM,10);poly([(320,295),(280,355),(320,380),(360,355)],BLUE)
  elif key=='swim':arc((105,150,535,490),190,350,BLUE,18);oval((115,260,315,425),BLUE);oval((325,260,525,425),BLUE);oval((145,285,285,395),CREAM);oval((355,285,495,395),CREAM);line([(305,315),(335,315)],INK,11)
  elif key=='gym_timer':oval((150,200,490,540),CREAM);rect((275,120,365,205),BLUE,10);line([(320,280),(320,375),(405,375)],INK,13);line([(420,200),(455,165)],INK,20);dot(320,375,13)
  elif key in ['tennis','badminton']:
   if key=='tennis':oval((125,105,400,405),BLUE);oval((150,130,375,380),CREAM);[line([(xx,155),(xx,355)],BLUE,4) for xx in [200,250,300]];[line([(170,yy),(350,yy)],BLUE,4) for yy in [200,250,300]];line([(350,365),(480,540)],INK,25);dot(470,190,55,YELLOW);arc((425,140,505,235),270,450,CREAM,6)
   else:poly([(165,140),(490,210),(335,435),(270,405)],CREAM);[line([(xx,160+(xx-165)*.2),(300,400)],BLUE,5) for xx in range(190,480,55)];oval((255,380,350,485),YELLOW)
  elif key in ['basketball','soccer']:
   oval((125,125,515,515),ROSE if key=='basketball' else CREAM)
   if key=='basketball':line([(130,320),(510,320)],INK,8);arc((195,110,385,530),270,450,n=8);arc((260,110,450,530),90,270,n=8)
   else:poly([(320,230),(405,290),(370,390),(270,390),(235,290)],GREEN);[line([(xx,yy),(ex,ey)],INK,7) for xx,yy,ex,ey in [(320,230,320,130),(405,290,505,255),(370,390,435,475),(270,390,205,475),(235,290,135,255)]]
  elif key=='roller_skates':poly([(165,130),(335,130),(350,340),(490,380),(515,450),(150,450)],ROSE);rect((130,445,535,485),CREAM,12);[dot(xx,515,35,BLUE) for xx in [200,320,440]];[line([(230,yy),(340,yy)],CREAM,8) for yy in [220,265,310]]
  elif key=='jump_rope':arc((130,100,510,520),0,360,BLUE,14);rect((110,355,165,510),ROSE,18);rect((475,355,530,510),ROSE,18)
  else:rect((125,215,515,505),CREAM,25);arc((240,120,400,280),180,360,n=14);rect((285,285,355,435),ROSE,4);rect((245,325,395,395),ROSE,4)
 elif theme=='pets':
  if key in ['cat_sleep','cat_play']:
   oval((140,285,450,505),ROSE);arc((190,270,500,525),280,600,INK,13);poly([(155,300),(150,175),(230,245),(310,230),(370,160),(365,320)],CREAM);oval((145,235,375,405),CREAM)
   if key=='cat_sleep':arc((195,285,235,315),0,180,n=5);arc((280,285,320,315),0,180,n=5)
   else:dot(210,300,7);dot(300,300,7);line([(345,400),(455,430)],CREAM,27);dot(490,460,52,BLUE);line([(450,450),(525,480)],CREAM,7)
   dot(255,340,7,INK)
  elif key=='dog_walk':oval((180,290,475,465),CREAM);oval((140,190,310,365),YELLOW);oval((130,210,190,335),INK);[line([(xx,430),(xx,530)],INK,17) for xx in [220,395]];line([(465,330),(525,250)],INK,18);line([(290,300),(480,130)],ROSE,10);dot(235,255,8);dot(165,290,12)
  elif key=='dog_bone':
   for xx,yy in [(165,225),(215,175),(425,465),(475,415)]:dot(xx,yy,58,CREAM)
   poly([(185,195),(455,405),(435,455),(155,245)],CREAM)
  elif key=='pet_bowl':poly([(170,300),(470,300),(530,485),(110,485)],BLUE);oval((165,260,475,355),CREAM);[dot(xx,yy,22,'#b99b7b') for xx,yy in [(235,300),(310,285),(365,315),(420,290)]];heart(320,420,28)
  elif key=='paw':oval((210,290,430,495),ROSE);[oval((xx-45,yy-65,xx+45,yy+65),ROSE) for xx,yy in [(155,260),(260,180),(385,180),(490,260)]]
  elif key=='cat_tree':rect((120,515,525,555),GREEN,12);rect((175,225,220,520),YELLOW,6);rect((410,345,455,520),YELLOW,6);rect((100,180,310,235),ROSE,10);rect((325,300,530,350),BLUE,10);poly([(350,300),(425,195),(510,300)],CREAM);oval((405,250,450,300),INK)
  elif key=='hamster':oval((165,150,285,290),ROSE);oval((350,150,470,290),ROSE);oval((145,205,495,535),CREAM);dot(240,335,10);dot(400,335,10);dot(320,385,12);oval((175,360,265,435),ROSE);oval((375,360,465,435),ROSE);poly([(280,440),(365,440),(320,505)],YELLOW)
  elif key=='turtle':oval((165,210,470,495),GREEN);oval((450,300,560,420),CREAM);dot(525,345,8);[oval((xx,yy,xx+75,yy+65),CREAM) for xx,yy in [(165,175),(340,175),(165,465),(340,465)]];poly([(300,260),(390,315),(360,420),(250,420),(220,315)],BLUE)
  elif key=='pet_carrier':rect((115,230,525,520),BLUE,30);arc((225,115,415,320),180,360,n=16);rect((235,285,465,470),CREAM,30);[line([(xx,300),(xx,455)],INK,7) for xx in [280,330,380,430]];[dot(170,yy,10) for yy in [310,365,420]]
  elif key=='pet_brush':rect((210,140,430,330),ROSE,35);rect((280,315,360,540),YELLOW,25);[line([(xx,155),(xx,300)],INK,5) for xx in range(240,415,28)]
  else:line([(130,520),(405,185)],INK,14);arc((365,100,535,360),270,475,BLUE,6);leaf(470,355,.9,ROSE);leaf(500,300,1.2,BLUE);dot(475,425,30,YELLOW)
 elif theme=='collage':
  if key=='kraft_tag':poly([(155,215),(255,130),(490,130),(490,490),(155,490)],'#c6a57a');oval((210,195,255,240),(0,0,0,0));arc((110,80,255,235),100,360,n=8);line([(220,320),(435,320)],CREAM,8);line([(220,380),(410,380)],CREAM,8)
  elif key=='ticket':rect((100,220,540,425),CREAM,4);[oval((xx-18,yy-18,xx+18,yy+18),(0,0,0,0),None) for xx in [100,540] for yy in [250,300,350,400]];line([(425,240),(425,405)],ROSE,5);txt('TICKET',155,265,48);txt('A LITTLE TRIP',155,335,22)
  elif key=='polaroid':rect((135,105,505,545),CREAM,4);rect((160,135,480,420),BLUE,3);dot(410,205,35,YELLOW);poly([(175,395),(275,250),(380,395)],GREEN);poly([(290,395),(400,300),(470,395)],ROSE);heart(320,480,22)
  elif key=='torn_paper':poly([(135,150),(180,165),(220,145),(265,165),(310,145),(355,160),(400,145),(455,165),(510,145),(495,500),(445,485),(400,510),(355,490),(310,510),(265,490),(220,510),(175,490),(130,510)],CREAM);[line([(185,yy),(455,yy)],ROSE,4) for yy in [250,315,380]]
  elif key=='doily':
   for i in range(20):a=i*math.pi/10;dot(320+190*math.cos(a),320+190*math.sin(a),45,CREAM)
   oval((145,145,495,495),CREAM);oval((195,195,445,445),None,o=ROSE,n=4)
   for i in range(16):a=i*math.pi/8;dot(320+160*math.cos(a),320+160*math.sin(a),10,(0,0,0,0))
  elif key=='vintage_key':oval((115,135,315,335),YELLOW);oval((165,185,265,285),(0,0,0,0));line([(285,305),(490,510)],YELLOW,32);line([(430,450),(475,405)],YELLOW,30);line([(470,490),(515,445)],YELLOW,30)
  elif key=='postmark':oval((145,145,465,465),None);oval((170,170,440,440),None,n=3);txt('TRAVEL',210,215,40);txt('GOOD DAY',207,345,28);line([(115,305),(540,305)],INK,6);[arc((375,yy,550,yy+45),0,180,n=4) for yy in [240,300,360]]
  elif key=='checker_ribbon':
   poly([(100,250),(540,250),(505,320),(540,390),(100,390),(135,320)],CREAM)
   for i in range(10):
    for j in range(3):
     if (i+j)%2==0:rect((145+i*35,267+j*35,180+i*35,302+j*35),ROSE,0,o=None)
  elif key=='lace':
   rect((100,245,540,390),CREAM,5)
   for xx in range(125,530,45):dot(xx,245,22,CREAM);dot(xx,390,22,CREAM);oval((xx-10,280,xx+10,355),(0,0,0,0),None)
  elif key=='flower_wreath':
   oval((160,160,480,480),None,o=GREEN,n=10)
   for i in range(10):a=i*math.pi/5;xx=320+160*math.cos(a);yy=320+160*math.sin(a);[dot(xx+math.cos(t*math.pi/2)*19,yy+math.sin(t*math.pi/2)*19,15,ROSE if i%2 else CREAM) for t in range(4)];dot(xx,yy,8,YELLOW)
  elif key=='circle_label':oval((140,140,500,500),CREAM);oval((165,165,475,475),None,o=ROSE,n=3);line([(215,280),(425,280)],INK,5);line([(215,360),(425,360)],INK,5);star(320,205,20)
  else:poly([(300,300),(140,155),(130,390),(300,345)],ROSE);poly([(340,300),(500,155),(510,390),(340,345)],ROSE);poly([(290,340),(215,525),(300,490),(330,535),(350,340)],ROSE);oval((280,280,360,370),YELLOW)
 elif theme=='commute':
  if key in ['subway','bus']:
   rect((135,125,505,495),BLUE,35);rect((165,165,475,320),CREAM,10);line([(320,165),(320,320)],INK,6);dot(205,405,22,YELLOW);dot(435,405,22,YELLOW);rect((185,490,245,535),INK,9);rect((395,490,455,535),INK,9)
   if key=='subway':line([(210,535),(170,580)],INK,10);line([(430,535),(470,580)],INK,10);txt('M',290,345,32)
   else:line([(110,195),(110,300)],INK,12);line([(530,195),(530,300)],INK,12)
  elif key=='car':poly([(145,300),(220,185),(430,185),(490,300)],BLUE);rect((100,285,540,445),BLUE,30);poly([(235,215),(315,215),(315,290),(185,290)],CREAM);poly([(335,215),(410,215),(455,290),(335,290)],CREAM);dot(200,445,48,INK);dot(450,445,48,INK);dot(200,445,23,CREAM);dot(450,445,23,CREAM)
  elif key=='scooter':line([(400,130),(460,435),(230,450)],INK,15);line([(350,130),(470,130)],INK,14);dot(180,480,65,BLUE);dot(470,480,65,BLUE);line([(175,430),(430,430)],ROSE,20)
  elif key=='traffic_light':rect((225,105,415,475),INK,25);[dot(320,yy,48,c) for yy,c in [(180,ROSE),(290,YELLOW),(400,GREEN)]];line([(320,475),(320,560)],INK,18)
  elif key=='briefcase':rect((110,240,530,505),ROSE,20);arc((230,125,410,320),180,360,n=14);line([(130,330),(510,330)],INK,7);rect((285,310,355,375),YELLOW,8)
  elif key=='id_badge':line([(185,105),(320,275),(455,105)],BLUE,25);rect((180,265,460,545),CREAM,18);face(320,365,45);rect((235,440,405,465),ROSE,8);line([(250,490),(390,490)],INK,5)
  elif key=='meeting':
   oval((125,340,515,475),BLUE)
   for xx,yy in [(185,245),(455,245),(320,140)]:face(xx,yy,45);rect((xx-50,yy+50,xx+50,yy+105),ROSE,18)
   rect((285,355,355,410),CREAM,5)
  elif key=='calendar':rect((145,175,495,530),CREAM,15);rect((145,175,495,265),ROSE,10);line([(220,125),(220,215)],INK,16);line([(420,125),(420,215)],INK,16);[rect((190+c*85,300+r*70,240+c*85,345+r*70),BLUE if (r+c)%3 else YELLOW,3) for r in range(3) for c in range(3)]
  elif key=='phone':rect((205,100,435,550),BLUE,28);rect((230,150,410,480),CREAM,8);rect((255,240,385,320),ROSE,18);poly([(275,310),(255,345),(320,315)],ROSE);dot(320,515,13)
  elif key=='battery':rect((125,230,500,425),CREAM,22);rect((500,285,540,370),INK,5);[rect((155+i*80,260,215+i*80,395),GREEN,4) for i in range(3)];poly([(335,110),(275,205),(320,205),(290,290),(385,175),(335,175)],YELLOW)
  else:poly([(135,225),(320,125),(510,225),(510,460),(320,550),(135,460)],'#c6a57a');line([(135,225),(320,325),(510,225)],INK,7);line([(320,325),(320,550)],INK,7);poly([(255,160),(425,260),(375,290),(210,185)],CREAM);rect((355,360,455,415),CREAM,5)
 elif theme=='moods':
  oval((135,145,505,515),CREAM);oval((185,355,250,385),ROSE,None);oval((390,355,455,385),ROSE,None)
  if key in ['happy','cheer','proud']:dot(245,300,12);dot(395,300,12);arc((250,325,390,435),0,180,n=10)
  elif key in ['sleepy','calm']:arc((200,275,285,325),0,180,n=9);arc((355,275,440,325),0,180,n=9);arc((275,365,365,400),0,180,n=7)
  elif key=='sad':dot(245,300,10);dot(395,300,10);arc((270,385,370,440),180,360,n=8);poly([(420,320),(395,385),(445,385)],BLUE);dot(420,385,25,BLUE)
  elif key=='angry':line([(205,260),(280,285)],INK,10);line([(360,285),(435,260)],INK,10);dot(250,315,10);dot(390,315,10);arc((275,395,365,435),180,360,n=8)
  elif key=='surprised':dot(245,295,18);dot(395,295,18);oval((285,365,355,440),INK)
  elif key=='focused':rect((185,265,295,345),None,14);rect((345,265,455,345),None,14);line([(295,300),(345,300)],INK,7);dot(245,305,8);dot(395,305,8);line([(285,395),(355,395)],INK,7)
  elif key=='shy':arc((205,275,285,320),180,360,n=8);arc((355,275,435,320),180,360,n=8);arc((275,365,365,415),0,180,n=8);[line([(xx,360),(xx-10,385)],ROSE,5) for xx in [205,225,415,435]]
  elif key=='confused':dot(245,300,11);arc((365,275,425,325),180,360,n=8);line([(285,405),(355,395)],INK,7);txt('?',440,65,100)
  else:heart(245,295,37);heart(395,295,37);arc((260,350,380,430),0,180,n=9)
  if key=='proud':poly([(210,160),(195,85),(270,125),(320,65),(375,125),(445,85),(430,160)],YELLOW);star(320,105,12,CREAM)
  elif key=='cheer':star(115,140,42);star(525,140,42);line([(125,420),(75,390)],ROSE,10);line([(515,420),(565,390)],ROSE,10)
  elif key=='sleepy':txt('z z',425,85,48,BLUE)
  elif key=='calm':leaf(120,175,-.5);leaf(520,175,.5)
 else:raise ValueError((theme,key))
 return im.resize((640,640),Image.Resampling.LANCZOS)

def main():
 m=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'));m['items']=[i for i in m['items'] if i.get('pack')!='daily-stickers'];m['collections']=[c for c in m['collections'] if not c['id'].startswith('daily_')]
 for theme,(name,items) in THEMES.items():
  for key,label in items:
   im=artwork(theme,key);ident=f'sticker_daily_{theme}_{key}';file='sticker/'+ident+'.png';thumb='thumbs/sticker/'+ident+'.png'
   im.save(ROOT/file,optimize=True);small=im.copy();small.thumbnail((220,180));small.save(ROOT/thumb,optimize=True)
   m['items'].append(dict(id=ident,name=name+' · '+label,cat='sticker',tags=[name,label,'生活贴纸','原创素材'],collection='daily_'+theme,pack='daily-stickers',usage='decorative',file=file,thumb=thumb,w=640,h=640,alpha=True,tile=False,dominant=GREEN.lower(),license='CC0-1.0',author='Journal Studio 原创程序绘制',desc='独立绘制的透明底生活贴纸，可放大缩小、裁切、叠贴、加白边并排版打印；非品牌原版'))
  m['collections'].append(dict(id='daily_'+theme,name=name,color=GREEN,count=len(items)))
 for c in m['categories']:c['count']=sum(i['cat']==c['id'] for i in m['items'])
 (ROOT/'manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps({'added_stickers':96,'materials':len(m['items'])}))
if __name__=='__main__':main()
