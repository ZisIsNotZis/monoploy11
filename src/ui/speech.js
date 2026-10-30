// 气泡队列：一次只显示一个气泡，语音和气泡共用同一句台词。
// 引擎的 ui.ask / ui.step 调用 flushSpeech()，等气泡关闭后再继续。
import { EXPERIENCE } from '../data/experience.js';
import { speak, pickLine, stopSpeech } from './voice.js?v=147';

let queue = [];
let active = null;
let idleWaiters = [];

export function say(p, event, textOverride) {
  if (!p || typeof document === 'undefined') return Promise.resolve();
  const text = textOverride ?? pickLine(p, event);
  if (!text) return Promise.resolve();
  return new Promise(resolve => {
    queue.push({ player: p, event, text, resolve });
    drain();
  });
}

// 等队列清空（包括队列在等待期间新加入的台词）。
export function flushSpeech() {
  if (!active && !queue.length) return Promise.resolve();
  return new Promise(resolve => idleWaiters.push(resolve));
}

async function drain() {
  if (active) return;
  const job = queue.shift();
  if (!job) {
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
    return;
  }
  active = job;
  try {
    await present(job);
  } catch {
    // 气泡异常不能挂住引擎；继续下一条。
  } finally {
    active = null;
    job.resolve();
    drain();
  }
}

function positionBubble(el, p) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const bw = el.offsetWidth || 240;
  const bh = el.offsetHeight || 58;
  const tok = document.querySelector(`[data-cell="${p.position}"] [data-player="${p.id}"]`);
  const rect = tok?.getBoundingClientRect();
  if (!rect || !rect.width) {
    el.style.left = `${Math.round(vw / 2 - bw / 2)}px`;
    el.style.top = `${Math.round(vh * 0.16)}px`;
    el.style.setProperty('--tail-x', '50%');
    return;
  }
  const cx = rect.left + rect.width / 2;
  const left = Math.max(8, Math.min(vw - bw - 8, cx - bw / 2));
  let top = rect.top - bh - 14;
  let below = false;
  if (top < 8) {
    top = rect.bottom + 14;
    below = true;
  }
  top = Math.max(8, Math.min(vh - bh - 8, top));
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  el.classList.toggle('below', below);
  el.style.setProperty('--tail-x', `${Math.round(Math.max(14, Math.min(bw - 14, cx - left)))}px`);
}

function createBubble(p, text) {
  const el = document.createElement('div');
  el.className = 'speech-bubble';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = '<div class="speech-text"></div><span class="speech-skip">空格 / 点击跳过</span><i class="speech-tail"></i>';
  el.querySelector('.speech-text').textContent = text;
  document.body.appendChild(el);
  positionBubble(el, p);
  let closed = false;
  const bubble = {
    onSkip: null,
    close() {
      if (closed) return;
      closed = true;
      el.remove();
    },
  };
  el.addEventListener('click', e => {
    e.stopPropagation();
    bubble.onSkip?.();
  });
  return bubble;
}

async function present(job) {
  const bubble = createBubble(job.player, job.text);
  let skipped = false;
  let resolveSkip;
  const skipSignal = new Promise(resolve => { resolveSkip = resolve; });
  const skip = () => {
    if (skipped) return;
    skipped = true;
    stopSpeech();
    bubble.close();
    resolveSkip();
  };
  bubble.onSkip = skip;
  const onKey = e => {
    if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      skip();
    }
  };
  window.addEventListener('keydown', onKey, true);
  try {
    const result = await Promise.race([
      speak(job.player, job.event, job.text),
      skipSignal.then(() => null),
    ]);
    if (skipped) return;
    // 有语音时，语音结束再停留 0.3s；无语音/静音时 speak 已按对应时长等待。
    if (result?.audio) {
      await Promise.race([
        new Promise(resolve => setTimeout(resolve, EXPERIENCE.speech.afterAudioMs)),
        skipSignal,
      ]);
    }
  } finally {
    window.removeEventListener('keydown', onKey, true);
    bubble.close();
  }
}
