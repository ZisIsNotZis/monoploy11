export const VOICE_EVENTS = ['gain', 'lose', 'rentIn', 'rentOut', 'buy', 'build', 'card', 'god', 'jail', 'hospital', 'bankrupt', 'win'];
export const VOICE_LINES = {
  gain: ['钱到手了，今天运气不错。', '这笔买卖，值。', '再多来一点。'],
  lose: ['这笔账，我记下了。', '钱包又轻了。', '别急，还没结束。'],
  rentIn: ['租金到账，合作愉快。', '这块地，开始回本了。', '谢谢惠顾。'],
  rentOut: ['租金真贵。', '下次别让我停这儿。', '这笔钱花得心疼。'],
  buy: ['这块地，我收了。', '先占住位置再说。', '成交。'],
  build: ['再加一层。', '这里还能更值钱。', '建起来。'],
  card: ['这张卡，会有用的。', '牌到手了。', '留着，等机会。'],
  god: ['今天有神相助。', '运气来了。', '别走，帮我一把。'],
  jail: ['这地方，我不熟。', '先冷静一下。', '很快出来。'],
  hospital: ['疼。', '先养伤。', '下次躲远点。'],
  bankrupt: ['这次，我认输。', '钱没了，局还没完。', '下次再来。'],
  win: ['这一局，我拿下了。', '承让。', '棋盘上见真章。'],
};
export const VOICE_PROFILES = {
  sunxiaomei: 'zh-CN-XiaoxiaoNeural', atubo: 'zh-CN-YunxiNeural', qianfuren: 'zh-CN-XiaoyiNeural',
  shalongbasi: 'zh-CN-YunjianNeural', jinbeibei: 'zh-CN-liaoning-XiaobeiNeural', rentaro: 'zh-CN-YunxiaNeural',
  qiange: 'zh-CN-YunyangNeural', shalagongzhu: 'zh-CN-shaanxi-XiaoniNeural', wumi: 'zh-CN-XiaoxiaoNeural',
  gongben: 'zh-CN-YunjianNeural', xiaodanni: 'zh-CN-YunxiaNeural', tangtang: 'zh-CN-XiaoyiNeural',
  yuehanqiao: 'zh-CN-YunyangNeural', wumeila: 'zh-CN-XiaoxiaoNeural', ludwig: 'zh-CN-YunxiNeural',
  shiyi: 'zh-CN-XiaoyiNeural', doctor: 'zh-CN-YunyangNeural', octopus: 'zh-CN-YunjianNeural',
  bear: 'zh-CN-YunxiaNeural', yuanyuan: 'zh-CN-liaoning-XiaobeiNeural',
};
// 浏览器回退用的音高/语速；本地 mp3 的对应参数由 tools/tts.py 生成。
export const VOICE_STYLE = {
  sunxiaomei: { rate: 1.00, pitch: 1.02 }, atubo: { rate: 0.94, pitch: 0.94 },
  qianfuren: { rate: 0.92, pitch: 0.96 }, shalongbasi: { rate: 0.90, pitch: 0.90 },
  jinbeibei: { rate: 1.04, pitch: 1.10 }, rentaro: { rate: 0.95, pitch: 0.94 },
  qiange: { rate: 0.93, pitch: 0.92 }, shalagongzhu: { rate: 0.98, pitch: 1.08 },
  wumi: { rate: 0.96, pitch: 1.05 }, gongben: { rate: 0.96, pitch: 0.96 },
  xiaodanni: { rate: 1.05, pitch: 1.06 }, tangtang: { rate: 1.06, pitch: 1.08 },
  yuehanqiao: { rate: 0.94, pitch: 0.95 }, wumeila: { rate: 1.04, pitch: 1.06 },
  ludwig: { rate: 0.97, pitch: 0.97 }, shiyi: { rate: 1.07, pitch: 1.10 },
  doctor: { rate: 0.88, pitch: 0.88 }, octopus: { rate: 0.92, pitch: 0.88 },
  bear: { rate: 0.86, pitch: 0.84 }, yuanyuan: { rate: 0.98, pitch: 1.04 },
};
