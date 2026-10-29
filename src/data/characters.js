// 16 名角色，全部可选；天赋钩子由 engine/game.js 与 engine/flow.js 解释。
// talents: [{id, name, desc}]，钩子由 engine/game.js 与 engine/flow.js 解释。
export const CHARACTERS = [
  { id: 'sunxiaomei', name: '孙小美', color: '#e05a5a', talents: [
    { id: 'rent_dealt_up', name: '历练', desc: '租金和爆炸伤害提高 20%', value: 0.2 },
    { id: 'wushen_days_x2', name: '杂技世家', desc: '武神附身时间翻倍' },
  ]},
  { id: 'atubo', name: '阿土伯', color: '#59b36b', talents: [
    { id: 'rent_taken_down', name: '居安思危', desc: '租金和爆炸伤害减免 20%', value: 0.2 },
    { id: 'tudigong_days_plus', name: '天命', desc: '土地公附身时间 +3 天', value: 3 },
  ]},
  { id: 'tangtang', name: '糖糖', color: '#d8a13f', talents: [
    { id: 'shop_discount', name: '会员价', desc: '大幅降低商店购买卡片的费用', value: 0.5 },
    { id: 'shop_extra_card', name: '乖乖女', desc: '离开商店时随机获得 1 张卡片', value: 1 },
  ]},
  { id: 'wumi', name: '乌咪', color: '#4f9de0', talents: [
    { id: 'jail_teleport_card', name: '森林守护者', desc: '出狱时获得 1 张传送卡' },
    { id: 'turn_card_infinite', name: '印记', desc: '转向卡的使用距离无限' },
  ]},
  { id: 'qianfuren', name: '钱夫人', color: '#c45ac4', talents: [
    { id: 'immune_beggar_dog', name: '传奇', desc: '免疫乞丐和狗' },
    { id: 'immune_pick_audit', name: '公关', desc: '神仙附身期间，无法成为拾取卡和查账卡目标' },
  ]},
  { id: 'shalongbasi', name: '沙隆巴斯', color: '#b07a3a', talents: [
    { id: 'turtle_gives_banana', name: '手段大师', desc: '成为乌龟卡目标后获得 1 张香蕉皮卡' },
    { id: 'leave_shop_turtle', name: '心机', desc: '离开商店时获得 1 张乌龟卡；乌龟卡距离翻倍' },
  ]},
  { id: 'jinbeibei', name: '金贝贝', color: '#e08fb0', talents: [
    { id: 'caishen_fushen_plus', name: '天真', desc: '财神和福神附身时间 +3 天', value: 3 },
    { id: 'no_sendgod_outside_turn', name: '乐园规则', desc: '自身回合外，无法成为对手送神卡目标' },
  ]},
  { id: 'rentaro', name: '忍太郎', color: '#5a5a7a', talents: [
    { id: 'angel_demon_x2', name: '幻术', desc: '天使和恶魔附身时间翻倍' },
    { id: 'god_gives_robotdoll', name: '忍术', desc: '神仙附身时获得 1 张机器娃娃卡' },
  ]},
  { id: 'qiange', name: '千哥', color: '#7a7a3a', talents: [
    { id: 'worker_to_truck', name: '赢家', desc: '使用机器工人卡，一定几率获得工程车卡' },
    { id: 'truck_to_worker', name: '利己', desc: '使用工程车卡，一定几率获得机器工人卡' },
  ]},
  { id: 'shalagongzhu', name: '莎拉公主', color: '#d070b0', talents: [
    { id: 'immune_shuai_qiong', name: '随心所欲', desc: '免疫衰神和穷神' },
    { id: 'immune_hutu_xiong', name: '香车美人', desc: '免疫糊涂神和凶神' },
  ]},
  { id: 'gongben', name: '宫本宝藏', color: '#5a8a9a', talents: [
    { id: 'all_gods_plus', name: '耍酷', desc: '所有神仙附身时间 +1 天', value: 1 },
    { id: 'god_gives_sendgod', name: '剑道', desc: '神仙附身时获得 1 张送神卡；送神卡距离翻倍' },
  ]},
  { id: 'xiaodanni', name: '小丹尼', color: '#4a8a5a', talents: [
    { id: 'immune_sleep', name: '逃脱本能', desc: '免疫梦游' },
    { id: 'jelly_banana_x2', name: '完投', desc: '果冻墙卡和香蕉皮卡的使用距离翻倍' },
  ]},
  { id: 'yuehanqiao', name: '约翰乔', color: '#8a6a4a', talents: [
    { id: 'roadblock_refund', name: '马术', desc: '使用路障卡，一定几率返还 1 张' },
    { id: 'roadblock_x2', name: '牛仔', desc: '路障卡使用距离翻倍' },
  ]},
  { id: 'wumeila', name: '舞美拉', color: '#c46a8a', talents: [
    { id: 'stay_refund', name: '临场发挥', desc: '使用停留卡，一定几率返还 1 张' },
    { id: 'stay_x2', name: '演技', desc: '停留卡使用距离翻倍' },
  ]},
  { id: 'ludwig', name: '路德维希', color: '#6a7ac4', talents: [
    { id: 'ensemble', name: '合奏', desc: '自身回合外意外失去卡片时，我方全体获得 1 张卡' },
    { id: 'card_range_plus', name: '悠扬', desc: '所有卡片使用距离 +1 格', value: 1 },
  ]},
  { id: 'shiyi', name: '十一', color: '#c45a7a', talents: [
    { id: 'suishimen_to_superdice', name: '探索', desc: '使用随意门卡，获得 1 张超级骰子卡' },
    { id: 'freecard_to_remotedice', name: '机智', desc: '使用免费卡，获得 1 张遥控骰子卡' },
  ]},
];

export const CHARACTER_BY_ID = Object.fromEntries(CHARACTERS.map(c => [c.id, c]));
