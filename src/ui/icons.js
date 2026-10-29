// 轻量内联 SVG：不依赖外部图片，公开仓库可直接分发。
const roads = {
  bank: '<path d="M4 9h16M6 9v8M10 9v8M14 9v8M18 9v8M4 19h16M12 3l9 6H3z"/>',
  shop: '<path d="M5 8h14l-1 12H6zM8 8V6a4 4 0 0 1 8 0v2M9 13h6"/>',
  news: '<path d="M5 5h14v14H5zM8 8h8M8 11h8M8 14h5"/>',
  card: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 13h5"/>',
  lottery: '<path d="M4 8h16v8H4zM8 8v8M16 8v8"/><circle cx="12" cy="12" r="2"/>',
  magic: '<path d="M12 3l2.2 5.3L20 10l-4.5 3.5L17 20l-5-3-5 3 1.5-6.5L4 10l5.8-1.7z"/>',
  tax: '<circle cx="12" cy="12" r="8"/><path d="M9 15l6-6M9 9h.01M15 15h.01"/>',
  event: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/>',
  hospital: '<path d="M9 4h6v5h5v6h-5v5H9v-5H4V9h5z"/>',
  jail: '<path d="M6 4v16M10 4v16M14 4v16M18 4v16M4 7h16M4 17h16"/>',
  teleport: '<path d="M7 7h7a4 4 0 0 1 0 8H9M10 3L6 7l4 4M17 17h-7a4 4 0 0 1 0-8h5M14 21l4-4-4-4"/>',
  start: '<path d="M6 21V4M6 5h11l-2 4 2 4H6"/>',
  stock: '<path d="M4 20V10M9 20V6M14 20v-7M19 20V4"/>',
};
const props = {
  '房': '<path d="M4 11l8-7 8 7v9H4zM9 20v-6h6v6"/>',
  '地': '<path d="M4 6h16v12H4zM8 10h8M8 14h5"/>',
  '大': '<path d="M3 6h18v12H3zM7 10h10M7 14h6"/>',
};
export function svgIcon(kind) {
  if (roads[kind]) return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${roads[kind]}</svg>`;
  if (props[kind]) return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${props[kind]}</svg>`;
  return null;
}
export function tokenSvg() {
  return '<svg class="tok-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="currentColor"/><path d="M12 1l5 6H7z" fill="currentColor"/></svg>';
}
