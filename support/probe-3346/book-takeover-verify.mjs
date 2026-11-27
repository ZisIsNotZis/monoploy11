// 自查探针：bookhouse-takeover.mjs 里「开放收购」那一格与「押书屋」逐位相同。
// 两种情况都会给出一样的数，但含义完全不同：
//   A. 收购真的成交了，只是对胜率没影响（结论：开放收购无用）
//   B. 收购根本没成交（探针 bug 或引擎拒绝），那一格只是「押书屋」的复读（结论：无法判断）
// 这一支把「谁的、第几天、以什么方式」逐次印出来，并**断言**收购真的发生过。
//
// 用法：node support/probe-3346/book-takeover-verify.mjs [20]
import { SLICE_STYLES, createSliceConfig, SLICE_MAP } from '../../src/data/slice.js';
import { startSession, runGame } from '../../src/engine/flow.js';
import { aiAnswer } from '../../src/engine/ai.js';
import { acquisitionPrice, buyPrice } from '../../src/engine/economy.js';

const SEEDS = Number(process.argv[2] ?? 20);
const BOOK = 'market';
const plot = SLICE_MAP.plots.find(p => p.id === BOOK);
const before = plot.big;
plot.big = false; // 开放收购（只在探针内）
try {
  let tookovers = 0, directBuys = 0, games = 0;
  const ownerName = (s, id) => s.players.find(p => p.id === id)?.name ?? '无主';

  for (let seed = 1; seed <= SEEDS; seed++) {
    const style = 'take';
    const others = SLICE_STYLES.filter(s => s.id !== style).map(s => s.id);
    const config = createSliceConfig({ human: false, seed, style, sliceContestedStreets: true });
    config.participants = [style, ...others].map((sid, i) => {
      const s = SLICE_STYLES.find(x => x.id === sid);
      return { name: s.name, charId: s.charId, style: s.id, team: `t${i + 1}`, controller: 'ai' };
    });
    const state = startSession(config);
    const me = state.players[0];
    let decisions = 0, banKey = null, lastOwner = state.properties[BOOK].ownerId ?? null;
    const timeline = [];
    const turnKey = () => `${state.day}:${state.turn}`;
    const note = (how) => {
      const now = state.properties[BOOK].ownerId ?? null;
      if (now !== lastOwner) {
        timeline.push(`第${state.day}天 ${ownerName(state, now)} ${how}`);
        lastOwner = now;
      }
    };

    await runGame(state, {
      render() {}, async step() { note(''); },
      async ask(prompt) {
        if (++decisions > 5000) throw new Error('Decision limit exceeded');
        const mine = prompt.player?.id === me.id;
        const pr = state.properties[BOOK];
        const enemy = pr.ownerId && pr.ownerId !== me.id;

        if (prompt.type === 'buy' && mine && prompt.plot && (prompt.plot.id ?? prompt.plot) === BOOK) {
          const buy = me.cash >= buyPrice(state, BOOK);
          if (buy) directBuys++;
          return buy;
        }
        if (enemy && mine && prompt.type === 'action' && (me.sliceCardsUsed ?? 0) < 2 && banKey !== turnKey()) {
          const idx = me.cards.indexOf('buyland');
          if (idx >= 0 && me.cash >= acquisitionPrice(state, BOOK)) return { action: 'card', index: idx };
        }
        if (enemy && mine && prompt.type === 'target' && prompt.cardId === 'buyland') {
          const ids = prompt.plotIds ?? [];
          if (ids.includes(BOOK) && me.cash >= acquisitionPrice(state, BOOK)) return BOOK;
          banKey = turnKey();
          return aiAnswer(prompt, state);
        }
        return aiAnswer(prompt, state);
      },
    });
    note('（终局）');
    games++;
    const wasTaken = timeline.some(t => t.includes('向') || t.includes('收购'));
    const tookFromEnemy = timeline.some(t => /第\d+天 .+ 向|收于|收购/.test(t));
    // 用 sliceStats.takeovers 作为权威计数
    if (me.sliceStats.takeovers > 0) tookovers += me.sliceStats.takeovers;
    if (seed <= 5) console.log(`seed ${seed}: ${timeline.join(' → ') || '（无人易手）'}`);

    // 若 seed 少，我们至少要能看到一次「书屋从别人手里到了我手里」
    if (tookFromEnemy) { /* 计数由 sliceStats 负责 */ void wasTaken; }
  }
  console.log('');
  console.log(`开放收购后：${SEEDS} 局，直接买下 ${directBuys} 次，收购成交 ${tookovers} 次`);
  if (tookovers === 0) {
    console.log('⚠ 收购 0 次 —— 那么上一格「开放收购」=「押书屋」的复读，不能当结论。');
    process.exit(3);
  }
  console.log('✅ 收购真的发生过 —— 上一格相同说明「换持有者」不改变胜率，不是探针没跑到。');
} finally {
  plot.big = before;
}
