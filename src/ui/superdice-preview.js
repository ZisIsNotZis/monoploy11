import { TUNING } from '../data/tuning.js';
import { buildAdj, edgeUsable } from '../engine/board-v2.js';
import { isEdgeClosed, mapExtraSteps } from '../engine/map-runtime.js';

const SIMPLE_STOPS = new Set(['empty', 'property', 'big', 'start', 'platform', 'card', 'money', 'bank', 'lottery', 'tax']);
const OPTIONAL_CASH = new Set(['bank', 'lottery']);

// Only follow ordinary roads through at most one player-choice fork. No rolls,
// simulated event outcomes or state writes: stop reporting where that envelope ends.
export function superdicePreview(state, p, steps) {
  const unknown = (reason, branch) => ({ reason, branch });
  if (p.jail > 0 || p.hospital > 0 || p.skipMove || p.status || p.forceRestart != null || p.forceRandom || p.bombSteps > 0 || p.stopNow
      || p.god === '糊涂神' || (p.dirMode != null && p.dirMode !== 'choose')) {
    return [unknown('当前状态可能改变移动')];
  }
  if (mapExtraSteps(state)) return [unknown('地图节拍会改变步数')];
  const { map, day } = state;
  const nodes = new Map(map.nodes.map(n => [n.id, n]));
  const adj = buildAdj(map);

  function walk(id, from, left, branch, crossedTax, cashChoices, cashUncertain) {
    const node = nodes.get(id);
    if (!node) return [unknown('无法辨认路面', branch)];
    if (left === 0) {
      if (state.placements[id] || !SIMPLE_STOPS.has(node.kind)) return [unknown('停格有特殊效果', branch)];
      return [{ node, branch, crossedTax, cashChoices, cashUncertain }];
    }
    const all = adj[id];
    if (all.some(e => isEdgeClosed(map, id, e.to))) return [unknown('途中有封闭道路', branch)];
    const exits = all.filter(e => edgeUsable(map, day, e));
    if (!exits.length) return [unknown('途中没有可用出口', branch)];
    const choices = exits.filter(e => e.to !== from);
    const first = left === steps;
    const facing = first && exits.find(e => e.to === p.facing);
    const advance = ({ to }, atFork) => {
      const next = nodes.get(to);
      if (!next || next.surface || next.kind === 'teleport' || state.placements[to]) {
        return [unknown('途中有障碍、特殊路面或传送', atFork)];
      }
      const passing = left > 1;
      const cash = passing && OPTIONAL_CASH.has(next.kind) ? [...new Set([...cashChoices, next.label])] : cashChoices;
      return walk(to, id, left - 1, atFork, crossedTax || (passing && next.kind === 'tax'), cash,
        cashUncertain || next.id === map.startId || (passing && next.kind === 'money'));
    };
    if (exits.length >= 3 && left > 1 && choices.length > 1) {
      if (branch) return [unknown('之后还有岔路要选', branch)];
      return choices.flatMap(e => advance(e, { from: node, to: nodes.get(e.to) }));
    }
    if (exits.length >= 3 && !facing && choices.length !== 1) {
      return [unknown('最后一步的岔口不由你选', branch)];
    }
    return advance(facing || choices[0] || exits[0], branch);
  }

  return walk(p.position, p.lastNode, steps, null, false, [], false);
}

function at(node) { return `(${node.id})`; }
function direction(from, to) {
  if (!to || (from.x !== to.x && from.y !== to.y)) return to ? `走向 ${at(to)}` : '选择另一条路';
  return to.x > from.x ? '向右' : to.x < from.x ? '向左' : to.y > from.y ? '向下' : '向上';
}

export function superdiceLines(state, p, steps) {
  return superdicePreview(state, p, steps).map(row => {
    const { branch, node, reason, crossedTax, cashChoices, cashUncertain } = row;
    const prefix = branch ? `若在 ${at(branch.from)} ${direction(branch.from, branch.to)}：` : '';
    if (reason) return `${prefix}暂不预报落点或税费（${reason}）。`;
    const stop = `停在「${node.label}」${at(node)}`;
    if (node.kind !== 'tax') return `${prefix}${stop}；${crossedTax ? '经过纳税格，不交停格税' : '本次停格不征税'}。`;
    if (['财神', '凶神'].includes(p.god)) return `${prefix}${stop}；${p.god}免除停格税。`;
    if (cashUncertain) return `${prefix}${stop}；按停格时的现金收税，途中现金会变，暂不报金额。`;
    // Display-only estimate matching landingPhase; never applied to the player here.
    const tax = Math.min(50_000, Math.max(5_000, Math.round(p.cash * TUNING.taxRate))) * (p.god === '穷神' ? 2 : 1);
    const cashCondition = cashChoices.length ? `途中${cashChoices.join('、')}不改现金时，` : '按当前现金，';
    return `${prefix}${stop}；${cashCondition}应缴停格税 ${tax.toLocaleString('zh-CN')}。`;
  });
}
