import { VOICE_LINES, VOICE_PROFILES } from '../data/lines.js';

const cache = new Map();
let current = null;

function fileFor(p, event, i) {
  const base = `./assets/voice/${p.charId}/${event}-${i}.mp3`;
  return base;
}

export function speak(p, event, textOverride) {
  if (typeof window === 'undefined' || !p) return;
  const templates = VOICE_LINES[event];
  if (!templates) return;
  const i = Math.floor(Math.random() * templates.length);
  if (current) { try { current.pause(); } catch {} }
  const audio = new Audio(fileFor(p, event, i));
  current = audio;
  audio.volume = 0.7;
  let fellBack = false;
  const fallback = () => {
    if (fellBack) return;
    fellBack = true;
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(textOverride ?? templates[i].replace('{name}', p.name));
    u.lang = 'zh-CN';
    u.rate = 1.05;
    const voice = VOICE_PROFILES[p.charId];
    const found = speechSynthesis.getVoices().find(v => v.name.includes(voice?.split('-').pop() ?? ''));
    if (found) u.voice = found;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  };
  audio.onerror = fallback;
  audio.play().catch(fallback);
}
