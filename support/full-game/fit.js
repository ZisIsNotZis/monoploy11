// #3278: the browser-side judge for the results screen, priced with the SHIPPED money
// formatter. src/ui/slice.js:6 exports `money = n => Math.round(n).toLocaleString()`, so
// "is the gap number the string a reader sees?" is answered by the function that printed
// it, not by a hand-written copy of its formatting.
//
// Rows come from the DOM (measure().table); this judge only decides whether the table
// agrees with itself and with the headline -- never what the table says.
//
// HUMAN is passed in by the driver as the entry style's seat name (style=grow ⇒ 街角店主,
// src/data/slice.js:15/50-53: index 0 of the participant list is the human). The DOM
// carries no controller field, so this is the run's one accepted assumption and the driver
// records it next to the result.
export const FIT = String.raw`(async () => {
  const S = await import('/src/ui/slice.js?v=150');
  const P = window.__s3278_probe;
  if (!P) throw Error('NO-PROBE: lib.js was not installed on this frame');
  const m = P.measure();
  if (m.kind !== 'results') throw Error('NOT-RESULTS: kind=' + m.kind + ' heading=' + m.heading);
  const num = s => Number(String(s).replace(/[^\d-]/g, ''));
  const head = m.heading ?? '';
  const gapLine = m.resultsGap ?? '';
  const tr = m.table ?? [];
  const headRow = tr.find(r => r.cells[0] === '店主') ?? null;
  // Data rows: 4 cells, owner first, and the header row excluded by its own first cell.
  const rows = tr.filter(r => r.cells.length === 4 && r.cells[0] !== '店主');
  const perRow = rows.map(r => ({owner: r.cells[0], funds: num(r.cells[1]), land: num(r.cells[2]),
    total: num(r.cells[3]), sumOk: num(r.cells[1]) + num(r.cells[2]) === num(r.cells[3]),
    fit: r.fit?.visible ?? null}));
  const winner = perRow[0] ?? null;
  const me = perRow.find(r => r.owner === HUMAN) ?? null;
  const claimed = /相差\s*([\d,]+)\s*资产/.exec(gapLine)?.[1] ?? null;
  const expect = winner && me ? S.money(winner.total - me.total) : null;
  const titleShape = /^(.*) 的生意做到了最后$/.test(head);
  const winLine = m.players.find(p => p.name === winner?.owner)?.meta ?? null;
  return {ok: true, heading: head, gapLine, human: HUMAN, rows: perRow, headRow: headRow?.cells ?? null,
    checks: {
      // F4(a) three data rows, four columns, the shipped header order
      threeRows: perRow.length === 3,
      headerOrder: headRow ? headRow.cells.join('|') === '店主|资金|地产|总资产' : false,
      // F4(b) each row's own arithmetic closes (资金 + 地产 = 总资产)
      sumsOk: perRow.every(r => r.sumOk),
      // F4(c) the headline gap agrees with the rows, in BOTH branches. src/ui/slice.js:995
      // prints "你赢了。" when the human's team won and prints a gap number otherwise, so
      // demanding a gap string always was a judge bug that only showed up on a win -- a
      // branch no earlier run reached (the 20/20 PASS records all lost). Two shapes, one
      // rule: if the rows say the human IS the top total, the line must print no gap
      // number; if they say there is a gap, the printed number must be exactly it.
      gapMatches: expect === null ? false
        : expect === 0 ? (claimed === null && /你赢了/.test(gapLine))
        : claimed === expect,
      // F4(d) the headline names the row-1 owner
      titleNamesWinner: winner ? titleShape && head.indexOf(winner.owner) === 0 : false,
      // F4(e) every data row fully visible at the current scroll position
      rowsFull: perRow.every(r => r.fit === 'full'),
      // F4(f) replay usable BEFORE the driver scrolls anything
      replayUsable: m.replay?.usable === true,
    },
    raw: {claimed, expect, gapBranch: expect === null ? 'unknown' : (expect === 0 ? 'human-won' : 'human-behind'),
      winnerTotal: winner?.total ?? null, meTotal: me?.total ?? null,
      meName: me?.owner ?? null, winnerName: winner?.owner ?? null, scroll: m.scroll,
      choice: m.choice?.scroll ?? null, replay: m.replay, tableRows: tr.length,
      winnerMeta: winLine, players: m.players,
      choiceBox: m.choice ? {rect: m.choice.rect, maxHeight: m.choice.maxHeight,
        position: m.choice.position, overflowY: m.choice.overflowY} : null},
    moneyOk: typeof S.money === 'function',
  };
})()`;
