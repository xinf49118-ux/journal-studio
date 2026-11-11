// Official references checked on 2026-11-11; layouts are independent Chinese adaptations.
export const storyLayouts=[
 {id:'daily_story',name:'一日一页故事',group:'日记拼贴',period:'day',subtitle:'用时间、文字和一张小照片收藏今天'},
 {id:'week_scrap',name:'一周生活剪贴',group:'日记拼贴',period:'week',subtitle:'七天短记配自由剪贴区，把一周放在眼前'},
 {id:'five_year',name:'五年同日对照',group:'日记拼贴',period:'day',subtitle:'以所选日期为第一年，同一月日连续记录五年'},
 {id:'life_left',name:'一日两页 · 行程页',group:'日记拼贴',period:'day',companion:'life_right',subtitle:'24小时时间轴与今日重点；与回忆页分别生成、保存和打印'},
 {id:'life_right',name:'一日两页 · 回忆页',group:'日记拼贴',period:'day',companion:'life_left',subtitle:'照片、心情与自由书写；与行程页分别生成、保存和打印'},
 {id:'gratitude',name:'今日小确幸',group:'日记拼贴',period:'day',subtitle:'记下三件小事，以及想留给明天的心情'},
 {id:'photo_story',name:'照片故事页',group:'日记拼贴',period:'day',subtitle:'三张画面加一段故事，照片占位区可替换为自己的图片'},
 {id:'trip_plan',name:'旅行出发清单',group:'旅行收藏',period:'none',subtitle:'整理目的地、路线、行李和出发前待办'},
 {id:'trip_log',name:'旅途一日记',group:'旅行收藏',period:'day',subtitle:'记录路线、风景、遇见的人和旅途花费'},
 {id:'tickets',name:'票根收藏页',group:'旅行收藏',period:'none',subtitle:'为三张票根留出位置，写下地点与故事'},
 {id:'stamp_walk',name:'城市集章页',group:'旅行收藏',period:'none',subtitle:'六个集章位置，搭配地点、日期和自己的路线'},
 {id:'cafe_visit',name:'咖啡探店手记',group:'旅行收藏',period:'none',subtitle:'记录店铺、饮品、风味和想记住的角落'},
];
const H='https://www.1101.com/store/techo/en/2027/pc/';
const M='https://www.midori-japan.co.jp/english/products/';
const T='https://www.travelers-company.com/products/trnote/refill-regular';
export const otherSeries=[
 {id:'hobo-daily',brand:'Hobonichi',family:'Hobonichi',name:'Original / Cousin / HON / Planner',status:'官网 · 2027',description:'这些系列提供一日一页的记录方式，适合日记、绘画与日常记录。',variants:'尺寸、语言、封面和分册有区别；工坊使用统一 A5 中文功能页。',url:H,layouts:['daily_story','daily','photo_story']},
 {id:'hobo-weeks',brand:'Hobonichi',family:'Hobonichi',name:'Weeks / Weeks Mega',status:'官网 · 2027',description:'左页横向周计划，右页方格笔记；书后还有自由笔记空间。',variants:'工坊将周记与剪贴区组合在一张 A5 页，非原书等比版。',url:H,layouts:['week_scrap','weekly_notes']},
 {id:'hobo-free',brand:'Hobonichi',family:'Hobonichi',name:'Day-Free',status:'官网 · 2027',description:'把月历与无固定日期的方格笔记结合，按需要自由记录。',variants:'工坊可分别选择月计划与方格笔记，再保存为作品。',url:H,layouts:['monthly','grid','daily_story']},
 {id:'hobo-five',brand:'Hobonichi',family:'Hobonichi',name:'5-Year Techo',status:'官网 · 2027',description:'把连续五年中的同一天放在一起，让日常变化可以对照阅读。',variants:'工坊以所选日期为起始年；2月29日会标明后续非闰年。',url:H,layouts:['five_year']},
 {id:'midori-hibino',brand:'MIDORI',family:'MIDORI',name:'hibino / hibino Free Diary',status:'官网 · 2027与无日期款',description:'一天两页，结合24小时时间轴、月历及未来计划；无日期款也保留一天两页的记录空间。',variants:'工坊拆成行程页与回忆页，可预览配套页；两页需要分别生成、保存和导出。',url:M+'hibino/',layouts:['life_left','life_right','annual_plan','monthly']},
 {id:'midori-yuru',brand:'MIDORI',family:'MIDORI',name:'Yuru Log',status:'官网系列',description:'围绕轻松记录，把笔记本与边框、固定照片、留白装饰等贴纸和印章搭配使用。',variants:'工坊新增原创相框、胶带、日记标签与邮戳；不收录品牌原图。',url:M+'yurulog/',layouts:['gratitude','photo_story','daily_story','cafe_visit']},
 {id:'midori-gate',brand:'MIDORI',family:'MIDORI',name:'Multi-Year Diary Gate',status:'官网系列',description:'多年日记让不同年份的记录彼此对照，长期保存生活片段。',variants:'工坊提供三年、五年、十年同日对照，以及把十二个月同一天放在一起的记录页。',url:M+'multi-year-diary-gate/',layouts:['three_year','five_year','ten_year','same_day_months','timeline']},
 {id:'tn-diary',brand:'TRAVELER’S COMPANY',family:'TRAVELER’S COMPANY · TN',name:'TN 日程替芯 005 / 017 / 018 / 019',status:'官网常规尺寸替芯',description:'无日期日记、月历、纵向周计划、周计划配笔记四种用途，可按需要组合。',variants:'019 左周记、右方格笔记；实体常规替芯为210×110mm，工坊仍为标准A5。',url:T+'/refill-r-019',extraUrl:T,layouts:['daily_story','monthly','weekly_vertical','week_scrap']},
 {id:'tn-paper',brand:'TRAVELER’S COMPANY',family:'TRAVELER’S COMPANY · TN',name:'TN 自由纸张替芯',status:'官网常规尺寸替芯',description:'官网列有横线、方格、空白、点阵，以及牛皮纸、画纸、水彩纸等不同纸张。',variants:'工坊支持横线、方格、点阵与留白；不模拟实体纸张的吸墨和质感。',url:T,layouts:['ruled','grid','dot','blank','trip_log']},
 {id:'tn-collect',brand:'TRAVELER’S COMPANY',family:'TRAVELER’S COMPANY · TN',name:'TN 收纳与贴纸台纸',status:'官网配件',description:'口袋贴、卡片收纳、拉链袋、文件夹及贴纸台纸，可用来组织旅途中留下的小物。',variants:'票根收藏、集章和出发清单是工坊围绕旅行用途制作的补充格式，不是同名官方内页。',url:T,layouts:['tickets','stamp_walk','trip_plan']},
 {id:'tn-accordion',brand:'TRAVELER’S COMPANY',family:'TRAVELER’S COMPANY · TN',name:'TN 032 Accordion Fold Paper',status:'官网折页替芯',description:'官网目录列有风琴折页纸替芯，为连续画面和自由记录提供另一种纸本形式。',variants:'工坊另提供常规与护照尺寸的 A4 拼接折页 PDF，含裁切线、折线和接贴区；不等同原厂纸张、13 页结构及装订。',url:T,layouts:['photo_story','trip_log']},
];
export const brandScope={checked:'2026-11-11',title:'手账品牌与内页参考目录',
 summary:'国誉、Hobonichi、MIDORI、TN，以及 kinbor、九口山、趁早、MOODTAPE、陌墨的代表资料与记录方式，按品牌、用途查找，直接进入对应内页预览。',
 limit:'这是已核实的代表系列整理，不是各品牌全球历年所有商品。国誉目录保留原有年份与历史款标注；各品牌的来源、历史资料和改编范围逐项注明；资料未覆盖之处不推定在售。',
 adaptation:'工坊内页与贴纸为独立绘制的中文版本，默认 A5，可编辑和打印。品牌用于说明参考来源；无品牌原图或官方联名关系。'};
