// 地图机制运行时：只处理地图数据声明的机制，不在 flow 里写地图 id 分支。
export const edgeKey = (a, b) => [a, b].sort().join('|');
const log = (state, text) => { state.log.push({ day: state.day, text }); if (state.log.length > 400) state.log.splice(0, state.log.length - 400); };

export function createMapRuntime(map) {
  return {
    mapId: map.id,
    closed: new Map(),       // edgeKey -> untilDay
    season: 0,
    beat: 0,
    phase: 0,
    zone: null,
    stormed: false,
    lastEvent: null,
  };
}

export function isEdgeClosed(map, a, b) {
  const rt = map?.runtime;
  if (!rt) return false;
  const until = rt.closed.get(edgeKey(a, b));
  return until != null && until >= 0;
}

export function closeEdge(state, a, b, days = 1, reason = '') {
  const rt = state.map.runtime;
  if (!rt) return;
  rt.closed.set(edgeKey(a, b), state.day + days);
  rt.lastEvent = `${a}–${b} 封闭 ${days} 天${reason ? `（${reason}）` : ''}`;
  log(state, `地图：${rt.lastEvent}`);
}

export function openEdge(state, a, b) {
  state.map.runtime?.closed.delete(edgeKey(a, b));
}

function expireEdges(state) {
  const rt = state.map.runtime;
  if (!rt) return;
  for (const [k, until] of rt.closed) if (until < state.day) rt.closed.delete(k);
}

export function mapRentMultiplier(state, pr) {
  const m = state.map.mechanic;
  if (!m || !pr) return 1;
  if (m.id === 'night') return state.day % 2 ? m.rentDay : m.rentNight;
  if (m.id === 'mountain') {
    const spots = state.map.nodes.filter(n => !state.placements[n.id] && !state.players.some(p => p.position === n.id));
    if (spots.length) state.placements[state.rng.pick(spots).id] = { kind: 'dog' };
  }
  if (m.id === 'festival') {
    const plot = state.map.plots.find(x => x.id === pr.id);
    const zone = state.map.zones?.find(z => z.id === state.map.runtime?.zone);
    if (!plot || !zone) return 1;
    const x = plot.cells[0].x, y = plot.cells[0].y;
    return x >= zone.x && x < zone.x + zone.w && y >= zone.y && y < zone.y + zone.h ? m.rentBonus : 1;
  }
  if (m.id === 'season') return [1, 1.15, 0.95, 1.25][state.map.runtime?.season ?? 0];
  return 1;
}

export function mapShopMultiplier(state) {
  const m = state.map.mechanic;
  if (!m) return 1;
  if (m.id === 'night') return state.day % 2 ? 0.9 : 1.15;
  if (m.id === 'season') return [1, 0.9, 1.1, 0.85][state.map.runtime?.season ?? 0];
  return 1;
}

export function mapExtraSteps(state) {
  const m = state.map.mechanic;
  if (m?.id === 'music' && state.map.runtime?.beat) return m.extraSteps;
  return 0;
}

// 每天推进一次地图机关；所有行为只使用数据里的参数。
export function tickMap(state) {
  const rt = state.map.runtime;
  if (!rt) return;
  expireEdges(state);
  const m = state.map.mechanic;
  if (!m) return;
  rt.lastEvent = null;
  if (m.id === 'snow' && state.day % m.blizzardEvery === 0) {
    closeEdge(state, '6,5', '6,6', 2, '暴雪');
    closeEdge(state, '20,13', '20,14', 2, '暴雪');
  }
  if (m.id === 'night' && state.day % 2 === 0) {
    closeEdge(state, '2,4', '2,5', 1, '宵禁');
    closeEdge(state, '24,12', '24,13', 1, '宵禁');
  }
  if (m.id === 'sky' && state.day % m.bridgeEvery === 0) {
    closeEdge(state, '11,7', '11,8', 2, '云桥关闭');
    closeEdge(state, '15,10', '15,11', 2, '云桥关闭');
  }
  if (m.id === 'water' && state.day % m.tideEvery === 0) {
    closeEdge(state, '6,9', '6,10', 2, '涨潮');
    closeEdge(state, '20,9', '20,10', 2, '涨潮');
  }
  if (m.id === 'machine' && state.day % m.rotateEvery === 0) {
    closeEdge(state, '13,5', '13,6', 1, '齿轮换路');
    closeEdge(state, '7,9', '8,9', 1, '齿轮换路');
  }
  if (m.id === 'machine' && state.day % m.lavaEvery === 0) {
    const pr = Object.values(state.properties).find(x => x.ownerId && !x.big);
    if (pr) { pr.closed = Math.max(pr.closed ?? 0, m.lavaDays); log(state, '地图：岩浆喷发，一处地产停业'); }
  }
  if (m.id === 'angel' && state.day % m.stormEvery === 0) {
    for (const p of state.players.filter(x => x.alive && !x.hospital && !x.jail)) {
      p.position = state.map.facility?.hospital ?? p.position;
      log(state, `地图：风暴把 ${p.name} 送到港湾`);
    }
    rt.stormed = true;
  }
  if (m.id === 'mountain') {
    const spots = state.map.nodes.filter(n => !state.placements[n.id] && !state.players.some(p => p.position === n.id));
    if (spots.length) state.placements[state.rng.pick(spots).id] = { kind: 'dog' };
  }
  if (m.id === 'festival') {
    const zones = state.map.zones ?? [];
    if (zones.length) rt.zone = zones[(state.day - 1) % zones.length].id;
  }
  if (m.id === 'music') rt.beat = state.day % m.beatEvery === 0 ? 1 : 0;
  if (m.id === 'season') rt.season = Math.floor((state.day - 1) / m.seasonEvery) % 4;
  if (m.id === 'volcano' && state.day % m.eruptEvery === 0) {
    const owned = Object.entries(state.properties).filter(([, pr]) => pr.ownerId && pr.level > 0);
    const pick = owned.length ? state.rng.pick(owned) : null;
    if (pick) { const [id, pr] = pick; pr.closed = Math.max(pr.closed ?? 0, 5); log(state, `地图：火山喷发，${id} 被埋，停业 5 天`); }
  }
}

export function mapSurface(state, node) {
  return state.map.mechanic?.surface === node.surface ? node.surface : node.surface;
}
