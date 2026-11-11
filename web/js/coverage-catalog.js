import {kokuyoSeries} from './planner-catalog.js';
export const coverageChecked='2026-11-11';
export const coverageStatuses={ready:'功能已加入',partial:'部分覆盖',missing:'待补充',unknown:'资料不足',reference:'仅资料收录'};
export const coverageScope='核查项包含系列、具体格式、配件与待核实线索，不是商品总数。功能已加入仅指工坊的原创中文页面；部分覆盖不等于整本复刻。未获得全球历年完整 SKU 清单，无法计算全品牌覆盖率。';
export const brandCoverage=[
 ['KOKUYO','已核对 Jibun、Campus、学习计划及历史资料。MO 01—07 未逐款核实；年份附页、地区款与历史联名尚无全量清单。'],
 ['Hobonichi','拆分 2027 官网的主要本体格式。封面、联名、语言与每个年度附页未逐 SKU 收录。'],
 ['MIDORI','核对 2027 八个日程系列、hibino、Yuru Log、多年 Gate。纸张、插画及实体装订不计作已实现。'],
 ['MD PRODUCT','作为关联的独立品牌单列，核对 2027 四类日程产品；套装、封套与全尺寸版本未穷举。'],
 ['TRAVELER’S COMPANY','按官网常规与护照替芯目录逐号列出，另列年度款。实体配件和纸张属性仅收录资料；不是全部地区限定版。'],
 ['kinbor','拆分官网原创和联名目录；大部分页面只说明主题与产品类别，尚不足以确认各款内页。'],
 ['九口山','馆方历史合作可核实；另收录 AM 文创文章的转载线索，尚未获得品牌全量目录与内页规格。'],
 ['趁早','认证账号确认基础内页和大学生版；厚本、薄本、口袋本与年度特别版仍需逐款规格。'],
 ['MOODTAPE','官方海外店、单品页和官方账号可核实部分胶带与印章；店铺显示的总商品数不等于已逐项核实。'],
 ['陌墨 MO.CARD','Pinkoi 店铺未展示商品。具体系列来自零售商线索，未取得品牌确认，不标为已加入。'],
].map(([brand,limit])=>({brand,limit}));
const rows=[];
function add(id,brand,name,kind,status,evidence,url,layouts=[],remaining='',note=''){
 rows.push({id,brand,name,kind,status,evidence,url,layouts,remaining,note,checked:coverageChecked});
}
const J='https://www.kokuyo.com/stationery/series/jibun-techo/';
for(const s of kokuyoSeries.filter(s=>s.id!=='extras')){
 const status=s.id==='mo'?'unknown':s.id==='goods'?'reference':'partial';
 add('k-'+s.id,'KOKUYO',s.name,'系列',status,s.status,s.url,status==='unknown'||status==='reference'?[]:s.layouts,
  s.id==='mo'?s.variants:s.id==='goods'?'实体配件与品牌图案未加入。':s.id==='appendix'?'地图、交通线路、时差及年龄速查尚未实现。':'仅覆盖所列通用功能，原版尺寸、整册组合与品牌图案未实现。',s.description);
}
for(const [name,id] of [['24小时周轴','weekly_vertical'],['月计划与习惯','monthly_log'],['一日双区记录','day_split'],['月度项目表','monthly_project'],['人生阶段计划','life_plan'],['100项愿望','wishlist100'],['纪念日','anniversaries'],['家庭关系','family'],['资产记录','assets'],['阅读记录','reading'],['观影记录','movies'],['年度回顾','year_review']])
 add('k-function-'+id,'KOKUYO',name,'功能', 'ready','官网规格表',J+'spec/',[id],'独立中文功能页，非原版印刷样式。');
for(const n of ['01','02','03','04','05','06','07'])add('k-mo-'+n,'KOKUYO','MO 替芯 '+n,'待核实款','unknown','地区商品页存在描述冲突','https://vipssl.ey100.com/Goods/ItemDetail_9200-0118_1.htm',[],'尚未取得此编号的可靠内页规格，不能从同系列推断。');
for(const [id,name] of [['age','年龄速查表'],['map','日本／世界地图记录页'],['timezone','交通线路与时差信息页']])add('k-gap-'+id,'KOKUYO',name,'功能','missing','官网规格表',J+'spec/',[],'尚无对应专用页面；旅行清单或个人资料页不能替代。');

const H='https://www.1101.com/store/techo/en/2027/pc/';
for(const [key,name,ids] of [
 ['original','Original A6',['daily_story','monthly']],['avec-a6','Original Avec A6',['daily_story','monthly']],
 ['cousin','Cousin A5',['daily_story','monthly','weekly_vertical']],['avec-a5','Cousin Avec A5',['daily_story','monthly','weekly_vertical']],
 ['hon','HON A6 / A5',['daily_story','monthly']],['planner','Planner A6',['daily_story','monthly']],
 ['weeks','Weeks',['weekly_notes']],['mega','Weeks Mega',['weekly_notes','grid']],
 ['dayfree','Day-Free A6 / A5',['monthly','grid']],['five','5-Year A6 / A5',['five_year']]])
 add('h-'+key,'Hobonichi',name,'系列','partial','官网 2027 本体目录',H,ids,'仅对应记录方式；尺寸、语言、分册、原版附页与封面未完整实现。');
add('h-covers','Hobonichi','封面与联名商品目录','配件／图案','reference','官网 2027',H,[],'各合作插画、限定封面不作为工坊素材；未逐款穷举。');

const M='https://www.midori-japan.co.jp/english/products/';
const md=(id,name,ids,remaining='仅提供 A5 中文通用页；原版插画、尺寸和装订未实现。',url=M+'diary/')=>add('m-'+id,'MIDORI',name,'系列','partial','官网产品目录',url,ids,remaining);
md('book-dog','Book Style · Dog',['monthly','weekly_dual','habits','wishlist100','reading','sleep_log']);
md('book-cat','Book Style · Cat',['monthly','weekly_dual','gifts','memories']);
for(const [key,name,ids] of [['mini','Mini 月历',['monthly']],['slim','Slim 月历',['monthly']],['a6','A6 两周日记',['monthly','fortnight_diary']],['ojisan-memo','A6 Ojisan 月历＋便笺',['monthly','ruled']],['ojisan-week','A6 Ojisan 周块',['monthly','weekly']],['b6','B6 周记＋笔记',['monthly','weekly_notes']]])md('pocket-'+key,'Pocket Diary · '+name,ids);
for(const [key,name,ids] of [['dual','Double Schedule',['dual_month']],['todo','Double Schedule To Do',['monthly','todo_priority']],['progress','Double Schedule Progress',['monthly','monthly_project']],['money','Double Schedule Money',['monthly','budget']]])md(key,name,ids,'功能可分别使用；实体 Magic Index 与双册翻查结构未实现。');
md('flat','Flat Diary',['monthly'],'月历功能可用；硬质书写封面、收纳袋、A4 版结构未实现。');
md('professional-month','Professional · Slim Monthly Block',['monthly','ruled','meeting_notes','todo_priority','contacts','monthly_project']);
md('professional-week','Professional · Slim Weekly Vertical',['weekly_vertical','monthly','contacts','monthly_project','todo_priority']);
md('stand','Plus Stand Diary',['monthly','monthly_project'],'月历／项目功能可用；桌面立架和实体翻面结构未实现。');
md('gradation','Gradation Diary',['weekly_vertical'],'24 小时记录可用；原版昼夜渐变图案未实现。');
md('hibino','hibino',['life_left','life_right','monthly','annual_plan'],'两张独立页面；没有自动整本排版和连续双页导出。',M+'hibino/');
md('hibino-free','hibino Free Diary',['life_left','life_right'],'可选无日期；配套两页分别保存和打印。',M+'hibino/');
for(const [n,id] of [[3,'three_year'],[5,'five_year'],[10,'ten_year']])md('gate-'+n,`Gate ${n} 年日记`,[id],'同日跨年功能已加入；原版季节图案、附页及册装未实现。',M+'multi-year-diary-gate/');
add('m-gate12','MIDORI','Gate 12-Month Diary','系列','unknown','官网列有商品',M+'multi-year-diary-gate/',[],'已确认产品名称；不能仅凭名称推断具体逐日格式。');
md('yuru-note','Yuru Log 笔记本',['dot','daily_story'],'仅提供通用书写与日记功能，品牌原插画未加入。',M+'yurulog/');
for(const n of ['贴纸','印章'])add('m-yuru-'+n,'MIDORI','Yuru Log '+n,'配件／图案','reference','官网产品目录',M+'yurulog/',[],'工坊原创相框与标签不计作品牌原品已加入。');
for(const [id,name] of [['sleep_log','整月睡眠时段'],['fortnight_diary','两周日记'],['weekly_dual','每天左右分栏'],['dual_month','同月双日程']])add('m-function-'+id,'MIDORI',name,'功能','ready','官网格式说明',M+'diary/',[id],'独立中文功能实现，非原版等比复刻。');
const MD='https://md-product.com/en/collections/special-feature-diary';
for(const [key,name,ids] of [['normal','MD Notebook Diary',['monthly','ruled','blank','eight_blocks']],['thin','MD Notebook Diary Thin',['monthly','grid']],['day','MD Notebook Diary 1 Day 1 Page',['daily_story','life_left','blank']]])add('md-'+key,'MD PRODUCT',name,'系列','partial','官网 2027 目录',MD,ids,'仅通用功能；原版纸张、尺寸及整册页序未实现。');
add('md-sticker','MD PRODUCT','MD Diary Stickers · Dated Monthly','配件／图案','reference','官网 2027 目录',MD,[],'月历打印页可用，但不是可直接使用的裁切日历贴纸套装。');
add('md-eight','MD PRODUCT','八分区自由周记','功能','ready','官方美国站格式说明','https://md-product-usa.com/products/md-notebook-diary-2027?variant=45534944985223',['eight_blocks'],'工坊为单页八格，原书支持在展开页上自由划分。');

const T='https://www.travelers-company.com/products/trnote/';
const regular=[
 ['001','横线','ruled'],['002','方格','grid'],['003','空白','blank'],['004','口袋贴'],['005','无日期每日','daily_story'],['007','卡片袋'],['008','拉链袋'],['009','标准色修补套件'],['010','备用色修补套件'],['011','替芯收纳夹'],['012','画纸','blank'],['013','轻量纸','blank'],['014','牛皮纸','blank'],['016','笔夹 M'],['017','无日期月历','monthly'],['018','无日期纵向周计划','weekly_vertical'],['019','无日期周记＋笔记','weekly_notes'],['020','牛皮纸文件夹'],['021','连接橡皮筋'],['025','MD 奶油纸','blank'],['026','点阵','dot'],['027','水彩纸','blank'],['028','卡片袋'],['029','三折文件夹'],['030','黄铜夹'],['031','贴纸离型纸'],['032','风琴折页']
];
const passport=[
 ['001','横线','ruled'],['002','方格','grid'],['003','空白','blank'],['004','拉链袋'],['005','轻量纸','blank'],['006','无日期月历','monthly'],['007','无日期周记','weekly'],['008','画纸','blank'],['009','牛皮纸','blank'],['010','牛皮纸文件夹'],['011','连接橡皮筋'],['013','MD 奶油纸','blank'],['014','点阵','dot'],['015','水彩纸','blank'],['016','替芯收纳夹'],['017','贴纸离型纸'],['018','风琴折页']
];
for(const [size,list] of [['regular',regular],['passport',passport]])for(const [num,name,id] of list){
 const fold=name==='风琴折页';
 add(`t-${size}-${num}`,'TRAVELER’S COMPANY',`${size==='regular'?'常规':'护照'} ${num} · ${name}`,id?'替芯':'配件／图案',fold?'missing':id?'partial':'reference','官网替芯目录',T+'refill-'+size,id?[id]:[],fold?'尚无连续风琴折页与拼接打印。':id?'仅对应记录用途，TN 实际尺寸、材质与装订未实现。':'实体配件或特殊纸张，目录收录不等于数字实现。');
}
add('t-discontinued','TRAVELER’S COMPANY','常规 006 Pocket Sticker L','配件／图案','reference','官网标注停产',T+'refill-regular',[],'历史条目，不推定当前在售。');
for(const [key,name,ids] of [['r-month','常规年度月历',['monthly']],['r-vertical','常规年度纵向周计划',['weekly_vertical']],['r-week','常规年度周记＋笔记',['weekly_notes']],['p-month','护照年度月历',['monthly']],['p-week','护照年度周记',['weekly']]])add('t-2027-'+key,'TRAVELER’S COMPANY','2027 '+name,'系列','partial','官网年度目录',T+'2027-diary',ids,'按需生成日期；年度整套替芯、尺寸及专用附页未实现。');
add('t-2027-goods','TRAVELER’S COMPANY','2027 限定文件夹／贴纸等','配件／图案','reference','官网年度目录',T+'2027-diary',[],'年度图案和实体配件仅收录来源。');

const K='https://www.kinbor.net/';
for(const [key,name,note] of [['new','畅销新品','页面介绍布面／刺绣与自填式内页，未给出逐页清单。'],['space','宇宙','主题含手账、套装、周边与胶带。'],['mimo','MIMO','原创角色主题，目录列手账及周边。'],['sakura','樱花','主题含手账套装、周边与胶带。']])add('kin-'+key,'kinbor',name,'系列','unknown','官网原创目录',K+'original.html',[],'系列已核实，具体内页与各商品尚未逐款确认。',note);
for(const [i,name] of ['盗墓笔记','龙族','三丽鸥','Brunch Brother','白日提灯','迪士尼','阴阳师','知否知否应是绿肥红瘦','重启之极海听雷','博物馆合作','艺术家合作','双品牌联名'].entries())add('kin-cross-'+i,'kinbor',name,'配件／图案','reference','官网跨界合作目录',K+'cooper.html',[],'仅确认合作分类；各联名商品与内页未逐款列全，品牌角色未加入素材库。');

add('jiu-pixel','九口山','世界像素 · 博氪球合作','系列','reference','世博会博物馆 · 2021','https://www.expo-museum.cn/sbbwg/n281/n282/n330/n331/u1ai27023.html',[],'馆藏题材与合作案例可核实，原画、装帧及实际内页未加入。');
for(const [i,name] of ['大闹天宫（绘画本／缝线本／明信片）','小动物商店街','闪闪发光（周历／口袋本）','四字箴言','fiesta 嘉年华','井田志半年本','生活百科全书','小材有大用'].entries())add('jiu-lead-'+i,'九口山',name,'待核实款','unknown','AM 文创文章转载 · 2025','https://www.sohu.com/a/914867667_121124800',[],'找到具体系列线索；转载账号不是品牌官方，尚待核对内页原始资料。');

const CZ='https://www.sina.cn/news/detail/5334715154303627.html';
add('cz-student','趁早','2027 效率手册 · 大学生版','系列','partial','品牌认证账号 · 2026',CZ,['life_plan','annual_plan','wishlist100','reading','movies','monthly_dimensions','wellbeing_day','semester_review'],'已覆盖公开列明的主要用途；学年跨年整册、身体坐标轴原格式未完整实现。');
for(const [id,name] of [['life_plan','一生的计划'],['wishlist100','愿望清单'],['reading','读书清单'],['movies','观影清单'],['monthly_dimensions','七维月计划'],['wellbeing_day','每日24小时与生活记录'],['semester_review','学期总结']])add('cz-function-'+id,'趁早',name,'功能','ready','品牌认证账号',CZ,[id],'为对应用途独立设计，非原书逐页复刻。');
add('cz-body','趁早','身体管理坐标轴','功能','missing','品牌认证账号',CZ,[],'健康就诊页不等于身体变化坐标图，尚无专用可编辑曲线页。');
add('cz-general','趁早','效率手册基础内页','系列','partial','品牌认证账号 · 2025','https://www.sina.cn/news/detail/5120516375707716.html',['life_plan','wishlist100','annual_calendar','monthly'],'年份、薄厚版与其他附页未逐一核实。');
for(const [i,name] of ['2027 厚本','2027 薄本','2027 口袋本'].entries())add('cz-version-'+i,'趁早',name,'待核实款','unknown','品牌／创始人账号内容，页面含聚合推荐','https://www.sina.cn/news/detail/5342326685437684.html',[],'已发现版本名称；需各版完整规格，不能用单篇聚合页当全册目录。');

const mood='https://hk.pinkoi.com/store/moodtape?i18n_tag=%E6%B0%B4%E6%99%B6%E5%8D%B0%E7%AB%A0&tag=%E6%B0%B4%E6%99%B6%E5%8D%B0%E7%AB%A0';
for(const [i,name] of ['闲约珈琲店','街头书屋','山间野芒','山野的风','星夜神话','废弃星之海'].entries())add('mood-tape-'+i,'MOODTAPE',name,'配件／图案','reference','官方海外商店展示',mood,[],'主题胶带资料已收录；品牌原图未加入，工坊通用场景不能算作该款已实现。');
for(const [i,name] of ['标签集','回忆 film','用餐时刻','12个月计划','铃兰'].entries())add('mood-stamp-'+i,'MOODTAPE',name+' · 透明印章','配件／图案','reference','官方海外商店展示',mood,[],'印章原图与实体效果未加入。');
add('mood-qing','MOODTAPE','清风明月','配件／图案','reference','官方店铺单品页','https://cn.pinkoi.com/product/bQ5awJpg',[],'人物胶带原图未加入。');
add('mood-rose','MOODTAPE','蔷薇岛屿','配件／图案','reference','官方店铺单品页','https://www.pinkoi.com/product/JFpSNmqn',[],'胶带原图未加入。');
add('mood-home','MOODTAPE','温暖之居','配件／图案','reference','品牌官方账号 · 2025','https://lottery.media.weibo.com/lottery/h5/history/list?mid=5118704098739725',[],'品牌卧室图案未加入；工坊窗边拼贴为独立设计。');
add('mood-planner','MOODTAPE','日程本产品线','待核实款','unknown','官方店铺品牌介绍','https://en.pinkoi.com/store/moodtape',[],'品牌介绍提及日程本，但未取得具体本体与内页清单。');

add('mo-store','陌墨 MO.CARD','品牌店铺与当前目录','待核实款','unknown','品牌店铺未展示商品','https://cn.pinkoi.com/store/mocard-cn',[],'缺少当前官方产品目录，不能确认所有在售系列。');
for(const [i,name] of ['优雅读书时 · 贴纸包','花草情书 · 素材纸','彩色图鉴 · PET贴纸','花蝶纸语 · 镂空材料','数字印记 · 木印章','祈愿花笺 · 信笺套装','蕾丝花框 · PET贴纸','花开有期 · 素材纸','透白之境 · 硫酸纸','一日一页 · 硫酸纸素材本'].entries())add('mo-lead-'+i,'陌墨 MO.CARD',name,'待核实款','unknown','零售商线索，非官方规格','https://yiwugo.com/hu/784680.html',[],'尚待品牌来源确认；未作为品牌素材加入。',name.includes('一日一页')?'这里的“一日一页”是素材本名称，不能当作日程本格式。':'');

export const coverageEntries=rows;
export function filterCoverage({brand='',status='',kind='',query=''}={}){
 const q=query.trim().toLowerCase();
 return rows.filter(r=>(!brand||r.brand===brand)&&(!status||r.status===status)&&(!kind||r.kind===kind)&&`${r.brand} ${r.name} ${r.evidence} ${r.note} ${r.remaining}`.toLowerCase().includes(q));
}
