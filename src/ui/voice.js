import { VOICE_LINES, VOICE_PROFILES, VOICE_STYLE } from '../data/lines.js';
import { EXPERIENCE } from '../data/experience.js';

// 语音也是一条队列：一次只播一句，气泡和语音共用同一句台词。
let chain = Promise.resolve();
let current = null;
let muted = false;
try { muted = globalThis.localStorage?.getItem('monopoly11:muted') === '1'; } catch {}

function fileFor(p, event, i) {
  if (!p?.charId) return null;
  return `./assets/voice/${p.charId}/${event}-${i}.mp3?v=2`;
}

// 只读地抽一句完整台词。main 的气泡和 speak 的 fallback 都用这一句，
// 绝不把中文拆成单字逐字朗读。
export function pickLine(p, event) {
  const templates = VOICE_LINES[event];
  if (!templates || !p) return '';
  const i = Math.floor(Math.random() * templates.length);
  return templates[i].replace('{name}', p.name ?? '');
}

export function isMuted() { return muted; }

export function setMuted(value) {
  muted = !!value;
  try { globalThis.localStorage?.setItem('monopoly11:muted', muted ? '1' : '0'); } catch {}
}

// 提前关闭当前这一句；speak 的 Promise 会正常 resolve，不会把流程挂住。
export function stopSpeech() { current?.stop(); }

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function finishAfter(ms, text) {
  return wait(ms).then(() => ({ audio: false, text }));
}

function hasChineseVoice() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  try {
    return speechSynthesis.getVoices().some(v => (v.lang || '').toLowerCase().startsWith('zh'));
  } catch {
    return false;
  }
}

function playSpeech(p, event, text, index) {
  return new Promise(resolve => {
    let done = false;
    let fallbackStarted = false;
    let timer = null;
    const finish = (audio) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (current?.finish === finish) current = null;
      resolve({ audio, text });
    };
    const noAudio = () => finishAfter(EXPERIENCE.speech.noAudioMs, text).then(() => finish(false));

    if (isMuted()) {
      current = { finish, stop: () => finish(false) };
      timer = setTimeout(() => finish(false), EXPERIENCE.speech.mutedMs);
      return;
    }

    const file = fileFor(p, event, index ?? Math.floor(Math.random() * 3));
    if (!file || typeof Audio === 'undefined') {
      current = {
        finish,
        stop: () => {
          try { speechSynthesis.cancel(); } catch {}
          finish(false);
        },
      };
      if (hasChineseVoice()) return speakViaSynthesis();
      noAudio();
      return;
    }

    const audio = new Audio(file);
    audio.volume = 0.7;
    current = {
      finish,
      stop: () => {
        try { audio.pause(); } catch {}
        try { speechSynthesis.cancel(); } catch {}
        finish(false);
      },
    };

    function speakViaSynthesis() {
      if (fallbackStarted) return;
      fallbackStarted = true;
      try { audio.pause(); } catch {}
      if (!hasChineseVoice()) return noAudio();
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'zh-CN';
        const style = VOICE_STYLE[p?.charId] ?? { rate: 1, pitch: 1 };
        u.rate = style.rate;
        u.pitch = style.pitch;
        const voices = speechSynthesis.getVoices();
        const profile = VOICE_PROFILES[p?.charId];
        u.voice = voices.find(v => profile && v.name.includes(profile.split('-').pop()))
          || voices.find(v => (v.lang || '').toLowerCase().startsWith('zh'));
        u.onend = () => finish(true);
        u.onerror = () => finish(false);
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
        // 浏览器可能吞掉阻塞的语音事件；给一个按台词长度估算的上限，避免死等。
        timer = setTimeout(() => finish(false), Math.max(EXPERIENCE.speech.noAudioMs, text.length * 260) + 2000);
      } catch {
        noAudio();
      }
    }

    // 本地 mp3 优先。加载失败或自动播放被拦截时，只有在浏览器确实有中文语音时才回退。
    audio.onended = () => finish(true);
    audio.onerror = () => speakViaSynthesis();
    // 某些浏览器在自动播放被拦截时不会触发 ended/error；给一个上限。
    timer = setTimeout(() => finish(false), Math.max(EXPERIENCE.speech.noAudioMs, text.length * 300) + 4000);
    try {
      const played = audio.play();
      if (played?.catch) played.catch(() => speakViaSynthesis());
    } catch {
      speakViaSynthesis();
    }
  });
}

// 返回 Promise：resolve 时这一句的语音已经结束（或已按无语音时长等待完）。
// 语音队列串行，避免两句叠在一起。
export function speak(p, event, textOverride) {
  const text = textOverride ?? pickLine(p, event);
  if (!text) return Promise.resolve({ audio: false, text: '' });
  if (typeof window === 'undefined') return Promise.resolve({ audio: false, text });
  const templates = VOICE_LINES[event] ?? [];
  const replaced = templates.map(t => t.replace('{name}', p.name ?? ''));
  const found = replaced.indexOf(text);
  const index = found >= 0 ? found : Math.floor(Math.random() * Math.max(1, replaced.length));
  const run = () => playSpeech(p, event, text, index);
  const result = chain.then(run, run);
  chain = result.then(() => {}, () => {});
  return result;
}
