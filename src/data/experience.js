// 体验时长的唯一来源：JS 计时、CSS 动画和测试都从这里取值。
// 口径见 docs/5_PRODUCT.md「体验节奏」「对话气泡与语音」「AI 节奏」。
export const EXPERIENCE = Object.freeze({
  stepMs: 300,                 // 逐格移动
  ai: Object.freeze({
    actionMs: 350,             // AI 相邻动作
    infoMs: 500,               // AI 需要读信息的动作
  }),
  floatMs: 2400,               // 金额 / 卡牌 / 状态飘字
  newsMs: 2400,                // 新闻 / 事件横幅
  // outMs：人类已出局、全局还没结束时用的节奏。那时玩家没有任何决定可做，剩余回合只是陪看；
  // 保持正常节奏等于让「等」成为出局的额外惩罚（实测 seed1 take 13.5s / seed4 grow 15.8s）。
  // 只改等待时长，不跳过任何回合、不改任何结算 —— 胜负与资产逐字不变。
  slice: Object.freeze({stepMs:140,aiMs:220,outMs:40}),
  speech: Object.freeze({
    afterAudioMs: 300,         // 语音结束后气泡再停留
    noAudioMs: 1800,           // 没有语音素材（也不回退）时气泡最短停留
    mutedMs: 1200,             // 静音时气泡停留，且不阻塞更久
  }),
});

// AI 需要读信息的 prompt；其余 prompt 走相邻动作间隔。
export const AI_INFO_PROMPTS = new Set([
  'buy', 'build', 'chooseBig', 'shop', 'merchant', 'research',
  'magic', 'bank', 'lottery', 'target', 'direction',
]);

export function aiPauseMs(promptType) {
  return AI_INFO_PROMPTS.has(promptType) ? EXPERIENCE.ai.infoMs : EXPERIENCE.ai.actionMs;
}

// main.js 在启动时写入 :root，CSS 动画只读变量，不写死时长。
export const CSS_TIMINGS = Object.freeze({
  '--step-dur': `${EXPERIENCE.stepMs}ms`,
  '--float-dur': `${EXPERIENCE.floatMs}ms`,
  '--news-dur': `${EXPERIENCE.newsMs}ms`,
});
