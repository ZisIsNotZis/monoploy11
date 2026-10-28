import { makeRng } from './engine/rng.js';

// M1 wiring starts here. Until the engine lands, show a deterministic seed marker
// so the shell is verifiably alive.
const rng = makeRng(1);
document.querySelector('#topbar').textContent =
  `大富翁 11 · 文字复刻 · seed ${rng.seed}`;
