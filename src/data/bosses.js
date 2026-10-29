export const BOSSES = [
  { id: 'doctor', name: '神秘博士', color: '#c45a5a', team: 'boss', desc: '反噬：受伤时让对手分摊', skills: ['反噬', '多多益善', '据为己有'] },
  { id: 'octopus', name: '章鱼王', color: '#7a4ac4', team: 'boss', desc: '拾取卡/飞弹卡距离无限，免疫拾取', skills: ['天才头脑', '惊喜大礼', '疯狂触手'] },
  { id: 'bear', name: '小熊', color: '#a06a3a', team: 'boss', desc: '租金与爆炸伤害强化，困难复活一次', skills: ['兴奋', '狂化', '过载'] },
  { id: 'yuanyuan', name: '圆圆', color: '#d070b0', team: 'boss', desc: '利息与收益强化，对手损失时抽成', skills: ['聚集', '大收益', '流通手段'] },
];
export const BOSS_BY_ID = Object.fromEntries(BOSSES.map(b => [b.id, b]));
