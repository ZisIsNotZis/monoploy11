// 内联 SVG：道路、地产、建筑、卡面、人物头像和放置物都按类型绘制。
const wrap = (body, cls = 'icon') => `<svg class="${cls}" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/* ---------------- 路面 ---------------- */
const ROAD = {
  money: '<circle cx="32" cy="32" r="18"/><path d="M32 18v28M24 24h12a6 6 0 0 1 0 12h-8a6 6 0 0 0 0 12h12"/>',
  bank: '<path d="M10 24h44M14 24v26M22 24v26M30 24v26M38 24v26M46 24v26M10 50h44M32 8l24 16H8z"/>',
  shop: '<path d="M12 22h40l-3 30H15zM20 22v-5a12 12 0 0 1 24 0v5M22 34h20M26 42h12"/>',
  news: '<path d="M12 10h40v44H12zM20 20h24M20 28h24M20 36h16M20 44h10"/><path d="M36 44h8v8h-8z"/>',
  card: '<rect x="10" y="14" width="44" height="36" rx="4"/><path d="M18 24h28M18 32h18M18 40h12"/><path d="M44 38l4 4 6-8"/>',
  lottery: '<path d="M8 24h48v16H8z"/><path d="M18 24v16M46 24v16"/><circle cx="32" cy="32" r="5"/><path d="M12 20l-4-4M52 20l4-4"/>',
  magic: '<path d="M32 6l6 14 15 2-11 10 3 15-13-8-13 8 3-15L11 22l15-2z"/><circle cx="32" cy="34" r="3"/>',
  tax: '<circle cx="32" cy="32" r="21"/><path d="M22 40l20-16M22 24h.1M42 40h.1M24 40h16M24 24h16"/>',
  event: '<circle cx="32" cy="32" r="22"/><path d="M32 16v20M32 44h.1"/><path d="M10 12l8 6M54 12l-8 6"/>',
  hospital: '<path d="M24 8h16v16h16v16H40v16H24V40H8V24h16z"/>',
  jail: '<rect x="10" y="10" width="44" height="44" rx="3"/><path d="M20 12v40M30 12v40M40 12v40M50 12v40M12 20h40M12 32h40M12 44h40"/>',
  teleport: '<path d="M12 20h24a12 12 0 0 1 0 24H24M18 12l-8 8 8 8M52 44H28a12 12 0 0 1 0-24h12M46 52l8-8-8-8"/>',
  start: '<path d="M16 56V8M16 12h32l-5 10 5 10H16"/><path d="M10 56h12"/>',
  stock: '<path d="M10 52V10M10 52h44"/><path d="M16 42l10-10 8 5 12-18"/><path d="M39 19h9v9"/>',
  platform: '<rect x="8" y="18" width="48" height="28" rx="4"/><path d="M16 26h8M16 34h16M40 26h8M40 34h8"/><path d="M20 54h24M24 46v8M40 46v8"/>',
  empty: '',
};
export function svgIcon(kind) {
  const k = kind === 'hospitalGate' ? 'hospital' : kind === 'jailGate' ? 'jail' : kind;
  return ROAD[k] ? wrap(ROAD[k], 'road-icon') : null;
}

const wrapSt = (body) => `<svg class="structure-icon" viewBox="0 0 64 64" fill="none" stroke="#e4d3b0" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/* ---------------- 小房屋 / 大建筑 ---------------- */
function house(level) {
  const lv = Math.max(1, Math.min(5, level || 1));
  const h = 14 + lv * 4;
  const y = 56 - h;
  let windows = '';
  for (let i = 0; i < lv; i++) windows += `<rect x="${24 + (i % 2) * 10}" y="${y + 8 + Math.floor(i / 2) * 8}" width="5" height="5"/>`;
  return wrapSt(`<path d="M10 56h44"/><path d="M16 ${y}h32v${56 - y}H16z"/><path d="M12 ${y}h40L32 ${y - 10}z"/><rect x="27" y="45" width="10" height="11"/>${windows}${lv >= 2 ? '<path d="M18 50h5v5h-5zM41 50h5v5h-5z"/>' : ''}${lv >= 3 ? '<path d="M20 ' + (y + 8) + 'h5v5h-5z"/>' : ''}${lv >= 4 ? '<path d="M24 20h16M32 14v20"/>' : ''}${lv >= 5 ? '<path d="M32 6v8M28 10h8"/>' : ''}`);
}
function big(type, level) {
  const lv = Math.max(1, Math.min(5, level || 1));
  if (type === 'park') return wrapSt('<path d="M8 56h48"/><path d="M32 56V34"/><circle cx="32" cy="24" r="14"/><path d="M22 30c4-8 16-8 20 0"/><path d="M16 56h32"/><path d="M18 48h10M36 48h10"/>');
  const base = '<path d="M8 56h48"/>';
  if (type === 'commercial') return wrapSt(`${base}<path d="M10 22h44v34H10z"/><path d="M10 22l6-10h32l6 10"/><path d="M18 30h28M18 40h28M18 50h28"/>`
    + `${lv >= 2 ? '<path d="M14 26h36M18 22v8M46 22v8"/>' : ''}`
    + `${lv >= 3 ? '<circle cx="32" cy="10" r="4"/><path d="M28 10h8M32 6v8"/>' : ''}`
    + `${lv >= 4 ? '<path d="M14 18v-5M50 18v-5M12 13h6M46 13h6"/>' : ''}`
    + `${lv >= 5 ? '<path d="M10 22l6-10h32l6 10M18 50h28"/><path d="M24 54v-4M32 54v-4M40 54v-4"/>' : ''}`);
  if (type === 'hotel') return wrapSt(`${base}<path d="M16 56V18h32v38"/><path d="M16 30h32M16 42h32"/><path d="M24 18v38M40 18v38"/><path d="M20 12h24"/>`
    + `${lv >= 2 ? '<path d="M20 36v12M32 36v12M44 36v12"/>' : ''}`
    + `${lv >= 3 ? '<path d="M22 6h20M32 2v4"/>' : ''}`
    + `${lv >= 4 ? '<path d="M12 24h6M46 24h6"/><circle cx="32" cy="36" r="3"/>' : ''}`
    + `${lv >= 5 ? '<path d="M14 14h36M20 10h24"/><path d="M18 54h28"/>' : ''}`);
  if (type === 'bookstore') return wrapSt(`${base}<path d="M12 22h40v34H12z"/><path d="M12 22l8-10h24l8 10"/><path d="M20 32h24v14H20zM24 32v14M36 32v14"/>`
    + `${lv >= 2 ? '<path d="M16 26h32M18 38h28"/>' : ''}`
    + `${lv >= 3 ? '<path d="M20 18h24"/><circle cx="32" cy="14" r="3"/>' : ''}`
    + `${lv >= 4 ? '<path d="M16 44h32M24 50h16"/>' : ''}`
    + `${lv >= 5 ? '<path d="M26 36h12v6H26z"/><path d="M16 54h32"/>' : ''}`);
  if (type === 'energy') return wrapSt(`${base}<path d="M12 56V26h14v30M38 56V20h14v36"/><path d="M19 18v8M45 12v8"/><path d="M20 38h6M38 32h14"/><path d="M32 26l-6 12h7l-2 10 8-14h-7z"/>`
    + `${lv >= 2 ? '<path d="M8 30h6M8 40h6M8 50h6"/>' : ''}`
    + `${lv >= 3 ? '<path d="M40 24h10M40 30h10M40 36h10"/>' : ''}`
    + `${lv >= 4 ? '<path d="M12 20h14M38 14h14"/><circle cx="19" cy="20" r="3"/>' : ''}`
    + `${lv >= 5 ? '<path d="M16 56V14h8v42M44 56V10h8v46"/><path d="M32 8v10M28 12h8"/>' : ''}`);
  if (type === 'realestate') return wrapSt(`${base}<path d="M10 56V18h44v38"/><path d="M16 26h8v8h-8zM26 26h8v8h-8zM36 26h8v8h-8zM16 38h8v8h-8zM26 38h8v8h-8zM36 38h8v8h-8z"/><path d="M26 56V46h12v10"/>`
    + `${lv >= 2 ? '<path d="M16 20h32M18 48h28"/>' : ''}`
    + `${lv >= 3 ? '<path d="M10 18l4-6h36l4 6"/>' : ''}`
    + `${lv >= 4 ? '<path d="M32 8v10M26 14h12"/>' : ''}`
    + `${lv >= 5 ? '<path d="M12 56V12h40v44"/><path d="M20 20h8v8h-8zM36 20h8v8h-8z"/>' : ''}`);
  if (type === 'research') return wrapSt(`${base}<path d="M12 56V30h40v26"/><path d="M20 30V18h24v12"/><path d="M32 8v10"/><circle cx="32" cy="12" r="3"/><path d="M20 40h24M20 48h24"/>`
    + `${lv >= 2 ? '<path d="M16 36h32M16 44h32"/>' : ''}`
    + `${lv >= 3 ? '<path d="M24 18v12M32 18v12M40 18v12"/>' : ''}`
    + `${lv >= 4 ? '<circle cx="32" cy="44" r="4"/><path d="M32 40v-8"/>' : ''}`
    + `${lv >= 5 ? '<path d="M16 30l16-14 16 14"/><path d="M32 16V6M26 10h12"/>' : ''}`);
  return wrapSt(`${base}<path d="M12 56h40"/><path d="M16 56V24l16-10 16 10v32"/><path d="M24 56V38h16v18"/>`
    + `${lv >= 2 ? '<path d="M20 32h24M20 44h24"/>' : ''}`
    + `${lv >= 3 ? '<path d="M16 24l16-10 16 10"/>' : ''}`
    + `${lv >= 4 ? '<path d="M24 18h16M32 12v6"/>' : ''}`
    + `${lv >= 5 ? '<path d="M12 56V18h40v38"/><path d="M32 6v12"/>' : ''}`);
}

export function structureSvg(plot, pr) {
  if (!plot) return '';
  if (plot.big) {
    if (!pr?.bigType) return wrapSt('<path d="M8 56h48"/><path d="M10 46h44M16 46v10M32 46v10M48 46v10"/><path d="M18 30l14-12 14 12"/><path d="M24 30v16M40 30v16"/>');
    return big(pr.bigType, pr.level);
  }
  if (!pr || !pr.level) return wrapSt('<path d="M8 56h48"/><path d="M12 50h40M18 56v-6M32 56v-6M46 56v-6"/><path d="M20 24l12-10 12 10"/><path d="M24 24v16M40 24v16"/>');
  return house(pr.level);
}

/* ---------------- 卡面 ---------------- */
const CARD_ART = {
  buyland: '<path d="M10 52h44M14 52V26l18-14 18 14v26"/><circle cx="32" cy="36" r="7"/><path d="M29 36h6M32 33v6"/>',
  exchange: '<path d="M8 24h20l-5-6M56 40H36l5 6"/><path d="M14 46h16v-8H14zM34 24h16v-8H34z"/>',
  rebuild: '<path d="M14 50l22-22 8 8-22 22z"/><path d="M34 20l8-8 10 10-8 8"/><path d="M12 56h12"/>',
  close: '<rect x="12" y="16" width="40" height="36"/><path d="M12 28h40M20 16v36M32 16v36M44 16v36"/><path d="M16 50l32-36"/>',
  truck: '<path d="M8 42h30V26H8zM38 42h18V32h-8l-4-6h-6"/><circle cx="18" cy="48" r="5"/><circle cx="46" cy="48" r="5"/><path d="M8 32h30"/>',
  monster: '<path d="M14 46c-4-14 6-30 20-30 12 0 20 14 16 30-8-4-12 6-20 2-8 4-12-6-16-2z"/><path d="M23 24l7 6-6 5M41 24l-7 6 6 5"/><path d="M22 42c4 4 16 4 20 0"/>',
  worker: '<path d="M12 30a20 20 0 0 1 40 0z"/><path d="M10 30h44M32 10v20"/><path d="M18 42h28v12H18z"/><path d="M24 42V32M40 42V32"/>',
  inflate: '<path d="M32 56V18M22 28l10-10 10 10"/><circle cx="18" cy="48" r="5"/><circle cx="46" cy="48" r="5"/><path d="M18 48h.1M46 48h.1"/>',
  remotedice: '<rect x="10" y="18" width="28" height="28" rx="4"/><circle cx="18" cy="26" r="2"/><circle cx="30" cy="38" r="2"/><path d="M46 18h8v8M54 18L38 34"/><path d="M42 46l8-8M46 54l8-8"/>',
  turtle: '<ellipse cx="30" cy="36" rx="18" ry="12"/><path d="M12 36h36M22 26v20M32 24v24M42 26v20"/><circle cx="51" cy="29" r="5"/><path d="M46 24l-4-6M8 44l-4 6M22 48l-3 6M38 48l3 6"/>',
  turn: '<path d="M18 50V26a12 12 0 0 1 24 0v12"/><path d="M32 28l10 10 10-10"/><path d="M10 50h26"/>',
  dirchoose: '<path d="M32 54V14M18 28l14-14 14 14"/><path d="M18 42h28M18 48h28"/>',
  dirclockwise: '<path d="M18 20a18 18 0 1 1-4 26"/><path d="M14 20l8 2-3 8"/><circle cx="32" cy="34" r="4"/>',
  dircounter: '<path d="M46 20a18 18 0 1 0 4 26"/><path d="M50 20l-8 2 3 8"/><circle cx="32" cy="34" r="4"/>',
  dirrandom: '<path d="M12 20h16M36 20h16M12 44h16M36 44h16"/><path d="M20 12v16M44 30v16"/><circle cx="32" cy="32" r="7"/><path d="M28 32h8M32 28v8"/>',
  stay: '<rect x="16" y="14" width="32" height="40" rx="4"/><path d="M24 24v20M40 24v20"/>',
  sleep: '<path d="M40 12a20 20 0 1 0 10 34 16 16 0 0 1-10-34z"/><path d="M14 22h12l-12 16h12M40 34h8l-8 10h8"/>',
  hibernate: '<path d="M32 8v48M12 18l40 28M52 18L12 46M24 12v8M40 12v8M24 44v8M40 44v8M8 26h8M8 38h8M48 26h8M48 38h8"/>',
  roadblock: '<path d="M12 48h40M16 48V30h32v18"/><path d="M12 30h40v-6H12z"/><path d="M20 24v-8M32 24v-8M44 24v-8"/><path d="M16 38h32"/>',
  superdice: '<rect x="8" y="12" width="20" height="20" rx="3"/><rect x="34" y="30" width="22" height="22" rx="3"/><circle cx="14" cy="18" r="1.5"/><circle cx="28" cy="26" r="1.5"/><circle cx="40" cy="36" r="1.5"/><circle cx="50" cy="46" r="1.5"/>',
  jelly: '<path d="M10 44c0-10 8-12 8-22 0 10 8 12 8 22M26 44c0-10 8-12 8-22 0 10 8 12 8 22M42 44c0-10 6-12 6-22 0 10 6 12 6 22M8 50h48"/>',
  randomdoor: '<path d="M18 54V14h28v40M18 14l14-8 14 8"/><path d="M30 34h8M34 30v8"/><circle cx="40" cy="34" r="1.5"/><path d="M8 54h48"/>',
  portal: '<circle cx="32" cy="32" r="18"/><circle cx="32" cy="32" r="8"/><path d="M12 20l6 6M52 20l-6 6M12 44l6-6M52 44l-6-6"/>',
  motorcycle: '<circle cx="14" cy="42" r="8"/><circle cx="50" cy="42" r="8"/><path d="M14 42l10-14h12l6 14M24 28h14M38 28l10 14M22 22h10"/>',
  car: '<path d="M8 40l6-14h36l6 14v10H8z"/><path d="M18 26l4-8h20l4 8M8 40h48"/><circle cx="18" cy="48" r="4"/><circle cx="46" cy="48" r="4"/>',
  robotdoll: '<rect x="18" y="18" width="28" height="24" rx="6"/><circle cx="26" cy="30" r="2"/><circle cx="38" cy="30" r="2"/><path d="M26 38h12M32 18V8M24 8h16M14 28v10M50 28v10M22 42v10M42 42v10"/>',
  start: '<path d="M18 54h28M22 54V30h20v24"/><path d="M32 30V16M26 20l6-8 6 8"/><circle cx="32" cy="8" r="4"/>',
  mine: '<circle cx="32" cy="34" r="16"/><path d="M32 18v-8M32 50v8M16 34h-8M48 34h8M22 24l-6-6M42 24l6-6M22 44l-6 6M42 44l6 6"/><circle cx="32" cy="34" r="4"/>',
  timebomb: '<circle cx="32" cy="38" r="16"/><path d="M32 22v-8M28 10h8M42 22l6-6M40 14l4 4"/><path d="M26 32h12M26 40h12"/>',
  missile: '<path d="M32 58V16M24 26l8-10 8 10M22 34l-8 8 10 4M42 34l8 8-10 4M26 50l6 8 6-8"/>',
  quantum: '<circle cx="32" cy="32" r="6"/><ellipse cx="32" cy="32" rx="24" ry="9"/><ellipse cx="32" cy="32" rx="24" ry="9" transform="rotate(60 32 32)"/><ellipse cx="32" cy="32" rx="24" ry="9" transform="rotate(-60 32 32)"/>',
  dynamite: '<path d="M20 22h20l6 28H14z"/><path d="M24 22v-8M34 22v-8M28 14c0-6 8-6 8 0"/><path d="M20 32h20M18 42h22"/>',
  banana: '<path d="M14 18c2 18 14 30 34 28-2 8-12 12-22 8C14 50 8 32 14 18z"/><path d="M14 18l-6-6M16 20l4-8"/>',
  trap: '<path d="M12 46h40M16 46l8-20 8 20 8-20 8 20"/><path d="M8 52h48"/><circle cx="24" cy="24" r="2"/><circle cx="32" cy="32" r="2"/><circle cx="40" cy="24" r="2"/>',
  free: '<path d="M32 8l20 8v14c0 14-9 22-20 26-11-4-20-12-20-26V16z"/><path d="M20 30l8 8 16-16"/>',
  audit: '<circle cx="26" cy="26" r="14"/><path d="M36 36l16 16M20 26h12M26 20v12"/>',
  equalpoor: '<path d="M32 12v40M18 20h28M14 20l-6 12h12zM50 20l-6 12h12z"/><path d="M14 44h12M38 44h12"/>',
  equalrich: '<path d="M32 10v44M18 18h28M12 18l-6 12h12zM52 18l-6 12h12z"/><circle cx="32" cy="44" r="7"/><path d="M29 44h6M32 41v6"/>',
  pick: '<path d="M12 30V16h8v10M20 30V12h8v16M28 30V14h8v16M36 30V18h8v16"/><path d="M12 30c0 12 8 22 20 22s20-8 20-22"/>',
  scheme: '<rect x="10" y="10" width="44" height="44"/><path d="M20 12v40M30 12v40M40 12v40M50 12v40M12 22h40M12 34h40M12 46h40"/><circle cx="32" cy="34" r="4"/>',
  magic: '<path d="M12 16h20v16H12zM32 32h20v16H32z"/><path d="M16 32l-4 8M48 32l4-8"/><path d="M18 22h8M38 40h8"/>',
  invitegod: '<path d="M32 8v10M20 18h24v10c0 10-8 18-12 18s-12-8-12-18z"/><path d="M26 52h12M32 46v6"/><path d="M14 14l4 4M50 14l4 4"/>',
  sendgod: '<path d="M8 34c14-18 28-18 40-6M48 28l10-8-2 14"/><path d="M16 44c10-8 22-8 32 0M8 52l8-4 6 8"/>',
  samefate: '<circle cx="24" cy="32" r="12"/><circle cx="40" cy="32" r="12"/><path d="M18 32h28M28 24l-6 8 6 8M36 24l6 8-6 8"/>',
  transfer: '<circle cx="18" cy="22" r="7"/><path d="M8 52v-6c0-6 4-10 10-10h8"/><path d="M30 32h24M46 24l8 8-8 8"/><circle cx="50" cy="18" r="5"/>',
  wuxie: '<path d="M32 8l20 8v14c0 14-9 22-20 26-11-4-20-12-20-26V16z"/><path d="M16 48L48 16"/>',
  rushmissile: '<path d="M18 58V24M10 34l8-10 8 10M46 58V24M38 34l8-10 8 10M32 46V12M24 22l8-10 8 10"/>',
  glory: '<path d="M10 22l8 18h28l8-18-12 8-10-18-10 18z"/><path d="M22 46h20M24 54h16"/>',
  predicament: '<path d="M10 54h44M18 54V26l14-10 14 10v28"/><path d="M22 26l8 8M38 26l-8 8M24 44l8 8M40 44l-8 8"/>',
  green: '<path d="M38 10l-6 24h14l-4 20M20 50l8-12M14 42l10 2M24 56l6-6"/>',
  disaster: '<path d="M32 8c-10 0-18 8-18 18 0 8 4 12 8 16v8h20v-8c4-4 8-8 8-16 0-10-8-18-18-18z"/><circle cx="25" cy="28" r="3"/><circle cx="39" cy="28" r="3"/><path d="M26 40h12"/>',
  godfavor: '<circle cx="32" cy="32" r="20"/><path d="M32 12v8M32 44v8M12 32h8M44 32h8M18 18l6 6M40 40l6 6M46 18l-6 6M24 40l-6 6"/><circle cx="32" cy="32" r="6"/>',
};
export function cardSvg(id) {
  const art = CARD_ART[id] ?? '<rect x="14" y="18" width="36" height="28" rx="4"/>';
  return `<svg class="card-art" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect class="card-frame" x="3" y="3" width="58" height="58" rx="7"/><path class="card-corner" d="M8 14h8M48 14h8M8 50h8M48 50h8"/><g class="card-glyph">${art}</g></svg>`;
}

/* ---------------- 放置物 / 神仙 ---------------- */
const OCC = {
  dog: '<path d="M14 40c0-12 8-20 18-20 10 0 18 8 18 20v14H14z"/><path d="M18 28l-8-8 10-4M46 28l8-8-10-4"/><circle cx="26" cy="36" r="2"/><circle cx="38" cy="36" r="2"/><path d="M28 44h8M32 44v4"/>',
  beggar: '<circle cx="32" cy="18" r="8"/><path d="M16 56c0-12 8-20 16-20s16 8 16 20"/><path d="M18 40h20a8 8 0 0 1 0 16H18z"/><path d="M22 46h12"/>',
  merchant: '<path d="M12 32c0-14 9-22 20-22s20 8 20 22-9 20-20 20-20-6-20-20z"/><path d="M18 26c6 4 22 4 28 0M22 36c6 6 14 6 20 0"/><path d="M14 14l6 8M50 14l-6 8"/>',
  mine: '<circle cx="32" cy="32" r="14"/><path d="M32 18v-8M32 46v8M18 32h-8M46 32h8M22 22l-6-6M42 22l6-6M22 42l-6 6M42 42l6 6"/><circle cx="32" cy="32" r="4"/>',
  dynamite: '<path d="M22 20h20l4 32H18z"/><path d="M26 20v-6M38 20v-6M28 14c0-6 8-6 8 0"/><path d="M20 34h24M18 44h28"/>',
  timebomb: '<circle cx="32" cy="38" r="16"/><path d="M32 22v-8M28 10h8M42 22l6-6M40 14l4 4"/><path d="M24 34h16M24 42h16"/>',
  banana: '<path d="M14 18c2 18 14 30 34 28-2 8-12 12-22 8C14 50 8 32 14 18z"/><path d="M14 18l-6-6M16 20l4-8"/>',
  jelly: '<path d="M10 44c0-10 8-12 8-22 0 10 8 12 8 22M26 44c0-10 8-12 8-22 0 10 8 12 8 22M42 44c0-10 6-12 6-22 0 10 6 12 6 22M8 50h48"/>',
  trap: '<path d="M12 46h40M16 46l8-20 8 20 8-20 8 20"/><path d="M8 52h48"/><circle cx="24" cy="24" r="2"/><circle cx="32" cy="32" r="2"/><circle cx="40" cy="24" r="2"/>',
  roadblock: '<path d="M12 48h40M16 48V30h32v18"/><path d="M12 30h40v-6H12z"/><path d="M20 24v-8M32 24v-8M44 24v-8M16 38h32"/>',
};
const GOD = {
  财神: '<circle cx="32" cy="32" r="22"/><path d="M16 40h32l-4 10H20z"/><path d="M22 32h20M24 24h16M32 16v16"/>',
  穷神: '<circle cx="32" cy="32" r="22"/><path d="M20 24h24l-4 20H24z"/><path d="M18 20l-6-6M46 20l6-6M24 48v8M40 48v8"/>',
  福神: '<circle cx="32" cy="30" r="20"/><path d="M20 24h24M18 32h28M22 40h20M32 10v6M14 12l4 6M50 12l-4 6"/>',
  衰神: '<circle cx="32" cy="32" r="22"/><path d="M16 26c8-8 24-8 32 0M18 38c8-6 20-6 28 0M22 24l-4 4M42 24l4 4"/>',
  天使: '<circle cx="32" cy="24" r="10"/><path d="M12 46c8-14 20-14 20 0 0-14 12-14 20 0M18 18c-6-6-12-4-10 4 2 6 8 8 12 4M46 18c6-6 12-4 10 4-2 6-8 8-12 4"/>',
  恶魔: '<circle cx="32" cy="32" r="18"/><path d="M14 20l-4-10 12 4M50 20l4-10-12 4M22 28l4 4M42 28l-4 4M24 42c4 4 12 4 16 0"/>',
  土地公: '<circle cx="32" cy="22" r="10"/><path d="M16 56c0-16 8-24 16-24s16 8 16 24"/><path d="M32 32v16M24 40h16M14 16h6M44 16h6"/>',
  糊涂神: '<circle cx="32" cy="32" r="22"/><path d="M20 24c8-8 16 8 24 0M20 40c8 8 16-8 24 0"/><circle cx="32" cy="32" r="5"/>',
  武神: '<circle cx="32" cy="32" r="22"/><path d="M32 10v44M20 20l24 24M44 20L20 44"/><circle cx="32" cy="32" r="6"/>',
  凶神: '<circle cx="32" cy="32" r="22"/><path d="M22 24l8 4M42 24l-8 4M24 42c6-6 10-6 16 0M28 32h8"/>',
};
export function obstacleSvg(kind, name) {
  const body = kind === 'god' ? (GOD[name] ?? GOD['福神']) : (OCC[kind] ?? '<circle cx="32" cy="32" r="18"/>');
  return wrap(`<circle class="occ-bg" cx="32" cy="32" r="29"/>${body}`, 'obstacle-icon');
}

/* ---------------- 人物头像：每个角色一套独立造型 ---------------- */
const PORTRAITS = {
  random: { skin:'#d8d0c0', hair:'<path d="M14 28c0-12 8-20 18-20s18 8 18 20c-5-7-11-10-18-10s-13 3-18 10z"/>', acc:'<path d="M25 30c0-8 14-8 14 0 0 5-7 5-7 10M32 46v.1" stroke="#f0c07a" stroke-width="3"/><circle cx="32" cy="54" r="2" fill="#f0c07a"/>' },
  sunxiaomei: { skin:'#f3c9a4', hair:'<path d="M14 28c0-12 8-20 18-20s18 8 18 20c-5-6-11-8-18-8s-13 2-18 8z"/><circle cx="13" cy="18" r="7"/><circle cx="51" cy="18" r="7"/><path d="M10 14l6 6M54 14l-6 6"/>', acc:'<path d="M22 48h20l-2 8H24z"/>' },
  atubo: { skin:'#dfae83', hair:'<path d="M8 22h48l-6 8H14z"/><path d="M20 22c0-10 5-16 12-16s12 6 12 16"/><path d="M22 48c4 7 16 7 20 0"/>', acc:'<path d="M24 48c2 6 14 6 16 0M28 50v5M36 50v5"/>' },
  qianfuren: { skin:'#f7d7bd', hair:'<path d="M12 32c-2-16 8-24 20-24s22 8 20 24c-4-8-8-12-20-12s-16 4-20 12z"/><path d="M14 34c-4 8-4 14 0 20M50 34c4 8 4 14 0 20"/>', acc:'<circle cx="14" cy="34" r="2" fill="#f5d67a"/><circle cx="50" cy="34" r="2" fill="#f5d67a"/><path d="M18 52c8 4 20 4 28 0"/>' },
  shalongbasi: { skin:'#c98f64', hair:'<path d="M12 24c0-10 8-16 20-16s20 6 20 16c-2 8-8 12-20 12s-18-4-20-12z"/><path d="M18 20c8-6 20-6 28 0"/>', acc:'<path d="M24 46c2 10 14 10 16 0M22 52h20M28 42v8M36 42v8"/>' },
  jinbeibei: { skin:'#f7d7bd', hair:'<path d="M12 30c0-14 8-22 20-22s20 8 20 22c-5-7-11-10-20-10s-15 3-20 10z"/><circle cx="10" cy="26" r="8"/><circle cx="54" cy="26" r="8"/><path d="M6 20l8-6M58 20l-8-6"/>', acc:'<path d="M24 16l8-6 8 6-8 6z"/>' },
  rentaro: { skin:'#e8c39e', hair:'<path d="M14 26h36v8H14z"/><path d="M14 26c0-10 8-16 18-16s18 6 18 16"/><path d="M14 46c4 6 32 6 36 0"/><path d="M20 46l6 8M44 46l-6 8"/>', acc:'<path d="M10 28h8M46 28h8M24 24h16"/>' },
  qiange: { skin:'#d7a77b', hair:'<path d="M14 30c0-14 8-22 18-22s18 8 18 22c-5-5-9-7-18-7s-13 2-18 7z"/><path d="M18 18h28"/>', acc:'<path d="M22 28h20M22 26h20M26 28v4M38 28v4" stroke="#111" stroke-width="3"/><path d="M20 52h24"/>' },
  shalagongzhu: { skin:'#f3c9a4', hair:'<path d="M12 34c-4-18 8-28 20-28s24 10 20 28c-4-10-8-16-20-16s-16 6-20 16z"/><path d="M14 34c-6 8-6 16-2 22M50 34c6 8 6 16 2 22"/>', acc:'<path d="M22 14h8l2-8 2 8h8l-6 6 2 8-6-5-6 5 2-8z"/>' },
  wumi: { skin:'#f3c9a4', hair:'<path d="M14 28c0-12 8-20 18-20s18 8 18 20c-5-7-11-10-18-10s-13 3-18 10z"/><path d="M16 22l-6-12 14 4M48 22l6-12-14 4"/>', acc:'<path d="M20 34h6M38 34h6M14 40h8M42 40h8M26 44c4 2 8 2 12 0"/>' },
  gongben: { skin:'#e0b48c', hair:'<path d="M16 26c0-10 7-18 16-18s16 8 16 18c-5-5-9-7-16-7s-11 2-16 7z"/><path d="M32 8v-6"/><path d="M10 22h12"/>', acc:'<path d="M18 30h12v8H18zM36 30h10M42 27v16"/><path d="M20 32h8"/>' },
  xiaodanni: { skin:'#f3c9a4', hair:'<path d="M12 26h40L34 12h-8z"/><path d="M14 26c0-8 6-14 18-14s18 6 18 14"/><path d="M40 12h12v6H40z"/>', acc:'<circle cx="21" cy="38" r="1.5"/><circle cx="28" cy="40" r="1.5"/><circle cx="36" cy="38" r="1.5"/>' },
  tangtang: { skin:'#f7d7bd', hair:'<path d="M12 32c0-16 8-24 20-24s20 8 20 24c-5-8-11-12-20-12s-15 4-20 12z"/><path d="M14 32c-2 8 0 14 4 18M50 32c2 8 0 14-4 18"/>', acc:'<circle cx="50" cy="46" r="8"/><path d="M50 38v16M42 46h16"/>' },
  yuehanqiao: { skin:'#d7a77b', hair:'<path d="M8 22h48l-8-8H16z"/><path d="M18 14c0-6 6-10 14-10s14 4 14 10"/><path d="M18 22v6"/>', acc:'<path d="M20 40c4-4 20-4 24 0M24 42h16M22 48h20"/>' },
  wumeila: { skin:'#f3c9a4', hair:'<path d="M12 32c0-16 9-24 20-24s20 8 20 24c-5-8-10-12-20-12s-15 4-20 12z"/><path d="M12 34c-4 8-2 14 2 18M52 34c4 8 2 14-2 18"/>', acc:'<path d="M42 14l4-8 4 8-4 8z"/><path d="M40 44c8-6 14 2 12 10-8 2-14-2-12-10z"/>' },
  ludwig: { skin:'#f3c9a4', hair:'<path d="M12 26c0-14 8-22 20-22s20 8 20 22c-5-8-10-12-20-12s-15 4-20 12z"/><circle cx="12" cy="26" r="8"/><circle cx="52" cy="26" r="8"/><path d="M20 26h24"/>', acc:'<path d="M24 50h16l-4 6h-8zM32 44v6"/>' },
  shiyi: { skin:'#f7d7bd', hair:'<path d="M14 28c0-12 8-20 18-20s18 8 18 20c-5-7-11-10-18-10s-13 3-18 10z"/><path d="M12 24c-6 0-10 4-10 8M52 24c6 0 10 4 10 8"/>', acc:'<path d="M10 20h8v12h-8zM46 20h8v12h-8zM18 26h28"/><path d="M32 8v-6"/>' },
  doctor: { skin:'#f3c9a4', hair:'<path d="M12 28c-2-16 8-24 20-24s22 8 20 24c-3-8-6-12-9-10 1-6-4-10-11-10s-12 4-11 10c-3-2-6 2-9 10z"/>', acc:'<circle cx="24" cy="28" r="6"/><circle cx="40" cy="28" r="6"/><path d="M30 28h4M18 28h-4M46 28h4"/><path d="M20 52h24M24 44v8M40 44v8"/>' },
  octopus: { skin:'#c9a4d8', hair:'<path d="M14 28c0-12 8-20 18-20s18 8 18 20c-5-7-11-10-18-10s-13 3-18 10z"/><path d="M12 40h40l-4 18H16z"/><path d="M20 58v-8M28 58v-8M36 58v-8M44 58v-8"/>', acc:'<path d="M14 14h36v8H14z"/><circle cx="24" cy="30" r="2"/><circle cx="40" cy="30" r="2"/>' },
  bear: { skin:'#b98a63', hair:'<circle cx="14" cy="14" r="8"/><circle cx="50" cy="14" r="8"/><path d="M12 28c0-12 8-20 20-20s20 8 20 20c-5-7-11-10-20-10s-15 3-20 10z"/>', acc:'<ellipse cx="32" cy="38" rx="8" ry="6" fill="#e8c39e"/><path d="M28 34h8M32 34v4"/><circle cx="24" cy="28" r="2"/><circle cx="40" cy="28" r="2"/>' },
  yuanyuan: { skin:'#f7d7bd', hair:'<path d="M12 30c0-14 8-22 20-22s20 8 20 22c-5-7-11-10-20-10s-15 3-20 10z"/><path d="M12 30c-8 0-12 6-10 14 6 2 10-2 10-8M52 30c8 0 12 6 10 14-6 2-10-2-10-8"/>', acc:'<path d="M20 16l6-8 6 8-6 6zM38 16l6-8 6 8-6 6z"/><circle cx="24" cy="30" r="3"/><circle cx="40" cy="30" r="3"/>' },
};
export function avatarSvg(charId, color, name) {
  const p = PORTRAITS[charId] ?? PORTRAITS.sunxiaomei;
  return `<svg class="avatar-svg" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="${color}" opacity=".22"/><circle cx="32" cy="32" r="29" fill="none" stroke="${color}" stroke-width="2"/><circle cx="32" cy="26" r="14" fill="${p.skin}"/>${p.hair}<path d="M10 58c3-13 11-19 22-19s19 6 22 19" fill="${color}"/><circle cx="26" cy="28" r="1.6" fill="#222"/><circle cx="38" cy="28" r="1.6" fill="#222"/><path d="M27 35c3 2 7 2 10 0" stroke="#222" stroke-width="1.4" fill="none"/>${p.acc}<text x="32" y="59" text-anchor="middle" font-size="7" fill="#fff" font-weight="700">${name.slice(0,1)}</text><title>${name}</title></svg>`;
}

export function tokenSvg() {
  return '<svg class="tok-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="currentColor"/><path d="M12 1l5 6H7z" fill="currentColor"/></svg>';
}
