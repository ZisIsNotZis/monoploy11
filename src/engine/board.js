// 地图图模型：邻接、校验、逐格移动、岔路规则、机关板。
// 所有移动都走这里；规则层不直接改 position。

export function buildAdj(map) {
  const adj = {};
  for (const n of map.nodes) adj[n.id] = [];
  for (const e of map.edges) {
    adj[e.a].push({ to: e.b, kind: e.kind });
    adj[e.b].push({ to: e.a, kind: e.kind });
  }
  return adj;
}

export function isPlatformActive(map, day) {
  const p = map.platform;
  if (!p) return true;
  const phase = Math.floor((day - 1) / p.everyDays) % 2;
  return p.onPhase.includes(phase);
}

export function edgeUsable(map, day, edge) {
  if (edge.kind !== 'platform') return true;
  return isPlatformActive(map, day);
}

export function validateMap(map) {
  const errors = [];
  const adj = buildAdj(map);
  const byId = Object.fromEntries(map.nodes.map(n => [n.id, n]));

  for (const n of map.nodes) {
    const d = adj[n.id].length;
    if (d === 0) errors.push(`${n.id} 是孤岛`);
    if (d === 1) {
      const allowed = ['teleport', 'hospital', 'jail'];
      if (!allowed.includes(n.kind)) errors.push(`${n.id} 是死路但不是传送门/医院/监狱`);
    }
  }
  const hosp = map.nodes.filter(n => n.kind === 'hospital');
  const jail = map.nodes.filter(n => n.kind === 'jail');
  if (!hosp.length) errors.push('缺医院');
  if (!jail.length) errors.push('缺监狱');
  for (const f of [...hosp, ...jail]) {
    const links = map.edges.filter(e => e.a === f.id || e.b === f.id);
    if (links.length !== 1) errors.push(`${f.id} 必须只有一条侧路`);
    else {
      const other = links[0].a === f.id ? links[0].b : links[0].a;
      if (!byId[other]?.ring && byId[other]?.kind !== 'platform') {
        errors.push(`${f.id} 的侧路没有直接连回主路`);
      }
    }
  }
  if (!map.nodes.some(n => adj[n.id].length >= 3)) errors.push('没有交叉点');
  if (map.platform) {
    const p = map.platform.nodeId;
    if (!byId[p]) errors.push('机关板节点不存在');
    else if (!adj[p].some(e => byId[e.to]?.kind !== 'platform')) {
      errors.push('机关板没有最近稳定格');
    }
  }

  const seen = new Set();
  const stack = [map.startId];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of adj[id]) stack.push(e.to);
  }
  for (const n of map.nodes) if (!seen.has(n.id)) errors.push(`${n.id} 不可达`);

  return errors;
}

export function nearestStable(map, fromId) {
  const adj = buildAdj(map);
  const byId = Object.fromEntries(map.nodes.map(n => [n.id, n]));
  const q = [fromId];
  const seen = new Set([fromId]);
  while (q.length) {
    const id = q.shift();
    if (id !== fromId && byId[id].kind !== 'platform') return id;
    for (const e of adj[id]) {
      if (!seen.has(e.to)) { seen.add(e.to); q.push(e.to); }
    }
  }
  return map.startId;
}

// 返回 { path, landed, teleported, pendingDirection }
export function walk(map, day, from, facing, steps, rng, opts = {}) {
  const adj = buildAdj(map);
  const byId = Object.fromEntries(map.nodes.map(n => [n.id, n]));
  const forced = !!opts.forced;
  let cur = from;
  let cameFrom = opts.cameFrom ?? null;
  let face = facing;
  const path = [];
  let teleported = false;

  const usable = (e) => edgeUsable(map, day, e);

  for (let s = 0; s < steps; s++) {
    let edge;
    if (s === 0 && face && adj[cur].some(e => e.to === face && usable(e))) {
      edge = adj[cur].find(e => e.to === face);
    } else {
      let exits = adj[cur].filter(usable);
      const nonBack = exits.filter(e => e.to !== cameFrom);
      if (nonBack.length) exits = nonBack;
      if (exits.length === 0) break;
      if (adj[cur].length >= 3 && !forced) {
        edge = rng.pick(exits);
      } else if (exits.length === 1) {
        edge = exits[0];
      } else {
        edge = rng.pick(exits);
      }
    }
    if (!edge) break;
    cameFrom = cur;
    cur = edge.to;
    path.push(cur);
    if (byId[cur].kind === 'teleport') {
      const walkable = map.nodes.filter(n => n.kind !== 'teleport' && n.kind !== 'platform');
      cur = rng.pick(walkable).id;
      path.push(cur);
      teleported = true;
      break;
    }
    if (byId[cur].kind === 'platform' && !isPlatformActive(map, day)) {
      cur = nearestStable(map, cur);
      path.push(cur);
      teleported = true;
      break;
    }
  }

  const degree = adj[cur].length;
  const pendingDirection = !forced && steps > 0 && degree >= 3 && path.length > 0;
  return { path, landed: cur, teleported, pendingDirection };
}
