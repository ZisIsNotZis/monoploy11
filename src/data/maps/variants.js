// 12 图集的其余 10 张：共享大酒店的网格骨架，但各自切路、换地面、换初始局面和机制。
import { GRAND_HOTEL } from './grand-hotel.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
const key = (x, y) => `${x},${y}`;
const edgeKey = (a, b) => [a, b].sort().join('|');

function variant(base, cfg) {
  const map = clone(base);
  map.id = cfg.id;
  map.name = cfg.name;
  map.mechanic = cfg.mechanic;
  map.intro = cfg.intro;
  if (cfg.remove) {
    const drop = new Set(cfg.remove.map(([a, b]) => edgeKey(a, b)));
    map.edges = map.edges.filter(e => !drop.has(edgeKey(e.a, e.b)));
  }
  if (cfg.add) {
    for (const [a, b, kind = 'road'] of cfg.add) map.edges.push({ a, b, kind });
  }
  if (cfg.surface) for (const n of map.nodes) n.surface = cfg.surface(n) ?? null;
  if (cfg.ground) for (const n of map.nodes) if (cfg.ground[n.id]) [n.kind, n.label] = cfg.ground[n.id];
  if (cfg.initial) map.initialProperties = cfg.initial(map);
  if (cfg.zones) map.zones = cfg.zones;
  // 移除的边不改变节点集合，校验器仍可从剩余边验证连通。
  return map;
}

const baseInitial = (map) => clone(map.initialProperties).map(x => ({ ...x }));

export const SNOW = variant(GRAND_HOTEL, {
  id: 'snow', name: '雪国',
  intro: '冰面会多滑一格，暴雪会封掉两条边。',
  remove: [['6,5', '7,5'], ['20,13', '21,13'], ['2,12', '2,13']],
  surface: n => (n.id === '6,5' || n.id === '7,5' || n.id === '20,13' || n.id === '21,13' || n.id === '13,4' || n.id === '13,14') ? 'ice' : null,
  initial: baseInitial,
  mechanic: { id: 'snow', iceExtra: 1, blizzardEvery: 6, blizzardClose: 2 },
});

export const SKY = variant(GRAND_HOTEL, {
  id: 'sky', name: '云上庭院',
  intro: '云桥每 5 天开合；关闭时站在桥上会被送回最近平台。',
  remove: [['11,7', '12,7'], ['15,11', '14,11']],
  initial: baseInitial,
  mechanic: { id: 'sky', bridgeEvery: 5 },
  zones: [{ id: 'cloud', x: 10, y: 6, w: 7, h: 7, color: 'rgba(90,130,160,.12)' }],
});

export const MACHINE = variant(GRAND_HOTEL, {
  id: 'machine', name: '机械迷宫',
  intro: '每 4 天齿轮换一次路；岩浆喷发会封路。',
  remove: [['13,4', '13,5'], ['7,10', '7,9'], ['20,5', '21,5']],
  surface: n => (n.id === '13,7' || n.id === '13,11' || n.id === '12,11' || n.id === '14,11') ? 'lava' : null,
  initial: baseInitial,
  mechanic: { id: 'machine', rotateEvery: 4, lavaEvery: 7, lavaDays: 3 },
});

export const NIGHT = variant(GRAND_HOTEL, {
  id: 'night', name: '不夜天',
  intro: '奇数天夜市开放，偶数天宵禁；白天和夜晚租金不同。',
  initial: baseInitial,
  mechanic: { id: 'night', rentDay: 1.2, rentNight: 0.9 },
  zones: [{ id: 'market', x: 10, y: 6, w: 7, h: 7, color: 'rgba(160,100,50,.11)' }],
});

export const WATER = variant(GRAND_HOTEL, {
  id: 'water', name: '水乡',
  intro: '每 6 天潮汐改路；河道涨潮时只能坐船到固定码头。',
  remove: [['6,9', '7,9'], ['20,9', '21,9']],
  surface: n => (n.id === '6,9' || n.id === '7,9' || n.id === '20,9' || n.id === '21,9') ? 'water' : null,
  initial: baseInitial,
  mechanic: { id: 'water', tideEvery: 6 },
  zones: [{ id: 'river', x: 10, y: 8, w: 7, h: 3, color: 'rgba(50,100,130,.13)' }],
});

export const MOUNTAIN = variant(GRAND_HOTEL, {
  id: 'mountain', name: '山城',
  intro: '上坡消耗 2 步；野狗群每天沿后巷迁移。',
  surface: n => (n.id === '13,4' || n.id === '13,5' || n.id === '13,13' || n.id === '13,14') ? 'slope' : null,
  initial: baseInitial,
  mechanic: { id: 'mountain', slopeCost: 2, dogEvery: 1 },
});

export const ANGEL = variant(GRAND_HOTEL, {
  id: 'angel', name: '天使岛',
  intro: '每 8 天风暴把沙滩上的角色送回港湾；神殿给每名角色一次永久手牌 +1。',
  initial: baseInitial,
  mechanic: { id: 'angel', stormEvery: 8, handBonus: 1 },
  zones: [{ id: 'beach', x: 2, y: 2, w: 23, h: 14, color: 'rgba(60,120,100,.08)' }],
});

export const FESTIVAL = variant(GRAND_HOTEL, {
  id: 'festival', name: '狂欢节',
  intro: '每天轮换一个加成区；巡游时该区道路单行。',
  initial: baseInitial,
  zones: [
    { id: 'nw', x: 3, y: 3, w: 8, h: 6, color: 'rgba(120, 92, 48, .10)' },
    { id: 'ne', x: 16, y: 3, w: 7, h: 6, color: 'rgba(70, 100, 128, .10)' },
    { id: 'sw', x: 3, y: 11, w: 8, h: 6, color: 'rgba(72, 112, 82, .10)' },
    { id: 'se', x: 16, y: 11, w: 7, h: 6, color: 'rgba(110, 78, 120, .10)' },
  ],
  mechanic: { id: 'festival', rotateEvery: 1, rentBonus: 2 },
});

export const MUSIC = variant(GRAND_HOTEL, {
  id: 'music', name: '音乐之都',
  intro: '全场共享节拍；每 4 回合强拍，下一次移动 +1 格。',
  initial: baseInitial,
  mechanic: { id: 'music', beatEvery: 4, extraSteps: 1 },
});

export const SEASON = variant(GRAND_HOTEL, {
  id: 'season', name: '锦绘时代',
  intro: '每 10 天换季，名所街区和商店折扣一起变化。',
  initial: baseInitial,
  mechanic: { id: 'season', seasonEvery: 10 },
});

export const VOLCANO = variant(GRAND_HOTEL, {
  id: 'volcano', name: '火山古迹',
  intro: '每 12 天喷发，熔岩永久覆盖道路或地产；被埋建筑停租。',
  surface: n => (n.id === '12,7' || n.id === '13,7' || n.id === '14,7' || n.id === '12,11' || n.id === '13,11' || n.id === '14,11') ? 'lava' : null,
  initial: baseInitial,
  mechanic: { id: 'volcano', eruptEvery: 12, buryLevels: 1 },
  zones: [{ id: 'lava', x: 10, y: 6, w: 7, h: 7, color: 'rgba(140,60,40,.14)' }],
});

export const VARIANTS = [SNOW, SKY, MACHINE, NIGHT, WATER, MOUNTAIN, ANGEL, FESTIVAL, MUSIC, SEASON, VOLCANO];
