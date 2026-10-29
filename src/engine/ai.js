// 规则型 AI：只通过 ui.ask 返回动作，不直接改状态。
export function aiAnswer(prompt, state) {
  const p = prompt.player;
  switch (prompt.type) {
    case 'action': return { action: 'roll', dice: 1 };
    case 'buy': return p.cash >= prompt.price + 30_000;
    case 'build': return p.cash >= prompt.cost + 30_000;
    case 'chooseBig': return 'commercial';
    case 'direction': return prompt.options?.[0] ?? null;
    case 'target': {
      if (prompt.kind === 'player') return prompt.players?.[0]?.id ?? null;
      if (prompt.kind === 'plot') {
        const owned = prompt.player.properties.map(id => state.properties[id]).find(Boolean);
        return owned ? prompt.player.properties[0] : (state.map.plots[0]?.id ?? null);
      }
      if (prompt.kind === 'cell') return prompt.player.position;
      if (prompt.kind === 'street') return state.map.plots[0]?.street ?? null;
      return null;
    }
    case 'bank': return { action: 'leave' };
    case 'stock': return { action: 'leave' };
    case 'lottery': return { action: 'leave' };
    case 'shop': case 'merchant': case 'research': return { action: 'leave' };
    case 'magic': {
      const option = (prompt.options ?? []).find(x => !x.disabled) ?? prompt.options?.[0];
      return option ? { id: option.id } : null;
    }
    case 'response': return false;
    default: return null;
  }
}
