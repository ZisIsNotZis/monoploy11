import { startSession, runGame } from '../engine/flow.js';
import { aiAnswer } from '../engine/ai.js';
import { CARD_DEFS } from '../engine/game.js';

const copy = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

// Uses the real async game loop, pausing at the same decisions as the browser.
// Observations contain detached data: inspection cannot advance RNG or the game.
export async function createDebugSession(config = {}) {
  const state = startSession(config);
  let pending = null;
  let sequence = 0;
  let ready = deferred();
  let done = false;
  let failure = null;
  let advancing = false;
  const history = [];

  const ui = {
    render() {},
    async step() {},
    async say() {},
    ask(prompt) {
      return new Promise(resolve => {
        pending = { id: ++sequence, prompt, resolve };
        ready.resolve();
      });
    },
  };
  // Capture errors here so the background loop never creates an unhandled rejection.
  runGame(state, ui).then(() => {
    done = true;
    ready.resolve();
  }, error => {
    failure = error;
    done = true;
    ready.resolve();
  });

  function observe() {
    if (failure) throw failure;
    const player = state.players.find(p => p.id === state.order[state.turn]);
    const prompt = pending ? copy(pending.prompt) : null;
    if (prompt) {
      prompt.id = pending.id;
      // Existing prompts carry options, players, offers, limits and prices.
      // Add readable cards for action decisions without inventing legality rules.
      if (prompt.type === 'action') {
        prompt.cards = prompt.player.cards.map((id, index) => ({ index, id, name: CARD_DEFS[id]?.name ?? id }));
      }
    }
    return copy({
      seed: state.seed, day: state.day, phase: state.phase,
      over: !!state.over, done, winnerTeam: state.winnerTeam,
      currentPlayerId: player?.id ?? null, priceIndex: state.priceIndex,
      prompt,
      players: state.players,
      board: {
        id: state.map.id, name: state.map.name, w: state.map.w, h: state.map.h,
        nodes: state.map.nodes, edges: state.map.edges, plots: state.map.plots,
        properties: state.properties, placements: state.placements,
        closedEdges: [...(state.map.runtime?.closed ?? [])],
      },
      stats: state.stats, log: state.log.slice(-24), history: history.slice(-24),
    });
  }

  async function answer(value, promptId) {
    if (advancing) throw new Error('A decision is already advancing; await it before answering again.');
    if (!pending) throw new Error(done ? 'Game has ended; there is no pending decision.' : 'No decision is pending.');
    if (promptId !== undefined && promptId !== pending.id) throw new Error(`Stale prompt ${promptId}; current prompt is ${pending.id}.`);
    // Clone before resolving: callers cannot later mutate an answer being consumed.
    const detached = value === undefined ? null : copy(value);
    const previous = pending;
    pending = null;
    advancing = true;
    ready = deferred();
    history.push({ id: previous.id, day: state.day, playerId: previous.prompt.player?.id, type: previous.prompt.type, answer: detached });
    if (history.length > 128) history.shift();
    previous.resolve(detached);
    try {
      await ready.promise;
      return observe();
    } finally {
      advancing = false;
    }
  }

  async function auto(count = 1) {
    if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error('auto count must be an integer from 1 to 10000.');
    for (let i = 0; i < count && pending; i++) {
      const { prompt, id } = pending;
      await answer(aiAnswer(prompt, state), id);
    }
    return observe();
  }

  await ready.promise;
  if (failure) throw failure;
  return { observe, answer, auto };
}
