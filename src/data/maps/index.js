import { GRAND_HOTEL } from './grand-hotel.js';
import { GRID_MANOR } from './grid-manor.js';
import { VARIANTS } from './variants.js';

// 12 张产品地图：大酒店、骑士庄园和 10 张机制变体。
export const MAP_LIST = [GRAND_HOTEL, ...VARIANTS];
export const MAPS = Object.fromEntries([GRID_MANOR, ...MAP_LIST].map(m => [m.id, m]));
export const MAP_OPTIONS = MAP_LIST.map(m => ({ id: m.id, name: m.name }));
