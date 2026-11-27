// Compile the browser-side expressions offline, and check the judge reads fields lib.js
// really publishes. A bad expression then costs seconds instead of a 460s Chrome run
// dying at Runtime.evaluate -- the failure mode #3264 hit three times.
import {LIB} from './lib.js';
import {FIT} from './fit.js';

const compile = (text, label) => {
  try { new Function('HUMAN', `return ${text}`); return `${label} ok (${text.length} B)`; }
  catch (e) { throw Error(`${label} DOES NOT COMPILE: ${e.message}`); }
};

// The judge must not grow back the state handle this run deliberately dropped, and it
// must reach the result only through lib.js's measured fields.
const banned = ['m.state', '__s3278_state'].filter(s => FIT.includes(s));
const required = ['window.__s3278_probe', 'HUMAN', "import('/src/ui/slice.js?v=150')",
  'm.players', 'm.table', 'm.replay'].filter(s => !FIT.includes(s));
if (banned.length) throw Error('FIT-USES-DROPPED-STATE: ' + banned.join(', '));
if (required.length) throw Error('FIT-CONTRACT-MISSING: ' + required.join(', '));
// lib.js must publish exactly the handles the driver calls.
const handles = ['window.__s3278_probe', 'measure', 'usable', 'why', 'fit', 'kind'];
if (!handles.every(h => LIB.includes(h))) throw Error('LIB-MISSING-HANDLE');

console.log('PROBE OK: ' + [compile(LIB, 'LIB'), compile(FIT, 'FIT'),
  'FIT reads probe + HUMAN + shipped money()'].join(' | '));
