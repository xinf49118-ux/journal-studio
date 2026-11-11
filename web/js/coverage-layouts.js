// Independent functional layouts, not reproductions of branded printed pages.
const page=(id,name,group,period,subtitle)=>({id,name,group,period,subtitle});
export const coverageLayouts=[
 page('age_lookup','年龄与出生年速查','长期记录','year','列出0至99岁对应出生年，按当年生日后满周岁计算'),
 page('body_track','身体指标记录图','长期记录','month','自填两个指标、单位和上下限，逐日描点记录变化'),
 page('same_day_months','十二个月同日对照','日记拼贴','day','对照所选年份每个月的同一天，不存在的日期会标明'),
 page('challenge21','21天行动计划','清单与回顾','day','从所选日期连续排21天，记录行动、完成情况和感受'),
 page('cornell','线索与总结笔记','学习计划','none','左栏关键词、右栏正文、底部总结，适合边学边整理'),
 page('film_review','电影票根与观影笔记','日记拼贴','day','收藏电影票根，写下角色、片段与自己的感受'),
 page('sleep_log','整月睡眠记录','长期记录','month','每天一行，18点至次日17点；手动涂记睡眠时段'),
 page('fortnight_diary','两周生活日记','日记拼贴','week','连续十四天分为两栏，跨月跨年自动排日期'),
 page('weekly_dual','每周双栏日程','日程安排','week','每天分开记录两类安排，栏名可以改成工作与生活'),
 page('dual_month','双日程月历','日程安排','month','同一个月的两份月历并排，分别安排两类事情'),
 page('three_year','三年同日对照','日记拼贴','day','从所选日期开始，留下连续三年的同日记录'),
 page('ten_year','十年同日短记','日记拼贴','day','每年一句话，连续十年；非闰年的2月29日单独标明'),
 page('eight_blocks','八分区自由周记','自由笔记','none','七天加一格随记，也可改成八个主题'),
 page('monthly_dimensions','七维月度计划','清单与回顾','month','从学业、专注、社团、运动、饮食、睡眠、花销规划一个月'),
 page('wellbeing_day','一日生活与状态','长期记录','day','24小时时间轴，配三餐、饮水、睡眠和今日感受'),
 page('semester_review','学期成长总结','学习计划','none','整理学习、技能、关系、习惯与下学期行动'),
 page('meeting_notes','会议笔记与行动','清单与回顾','day','议题、讨论结论、负责人和期限集中在一页'),
 page('todo_priority','今日三件事与待办','清单与回顾','day','先选三件重要的事，再填写带勾选框的行动清单'),
];
