// 为什么 freeBoth 与 whole 的读数逐位相同？直接调 conserved.mjs 里的表函数。
import { createSliceConfig } from '../../src/data/slice.js';
import { startSession } from '../../src/engine/flow.js';

const PAIRS = [['3,1', '4,1'], ['8,1', '9,1'], ['3,9', '4,9'], ['8,9', '9,9'], ['1,3', '1,4'], ['11,6', '11,7']];
const ARMS = {
  whole: i => [PAIRS[i][0], PAIRS[i][1]],
  freeBoth: i => [PAIRS[i][0], PAIRS[(i + 3) % 3][1]],
  mix: i => [PAIRS[i][0], PAIRS[(i + 1) % 3][1]],
  mixFar: i => [PAIRS[i][0], PAIRS[(i + 2) % 3][1]],
};
for (const [name, fn] of Object.entries(ARMS)) {
  console.log(name, [0, 1, 2].map(i => fn(i).join('+')));
}

// 逐臂装载，打印 p1 实际拿到的街
for (const name of Object.keys(ARMS)) {
  const st = startSession(createSliceConfig({ human: false, seed: 1, style: 'grow' }));
  const fn = ARMS[name];
  for (const pr of Object.values(st.properties)) pr.ownerId = null;
  st.players.forEach((p, i) => {
    p.properties = [];
    for (const id of fn(i)) { st.properties[id].ownerId = p.id; p.properties.push(id); }
  });
  const streets = st.players.map(p => [...new Set(p.properties.map(id => st.properties[id].street))].join('/'));
  console.log(name, '→', streets.join(' | '));
}
