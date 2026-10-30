#!/usr/bin/env python3
"""Local Edge TTS generation. Requires: pip install edge-tts.
Writes assets/voice/<charId>/<event>-<i>.mp3. Assets are gitignored.
"""
import asyncio
from pathlib import Path

try:
    import edge_tts
except ImportError:
    raise SystemExit('pip install edge-tts')

VOICES = {
 'sunxiaomei':'zh-CN-XiaoxiaoNeural','atubo':'zh-CN-YunxiNeural','qianfuren':'zh-CN-XiaoyiNeural',
 'shalongbasi':'zh-CN-YunjianNeural','jinbeibei':'zh-CN-liaoning-XiaobeiNeural','rentaro':'zh-CN-YunxiaNeural',
 'qiange':'zh-CN-YunyangNeural','shalagongzhu':'zh-CN-shaanxi-XiaoniNeural','wumi':'zh-CN-XiaoxiaoNeural',
 'gongben':'zh-CN-YunjianNeural','xiaodanni':'zh-CN-YunxiaNeural','tangtang':'zh-CN-XiaoyiNeural',
 'yuehanqiao':'zh-CN-YunyangNeural','wumeila':'zh-CN-XiaoxiaoNeural','ludwig':'zh-CN-YunxiNeural',
 'shiyi':'zh-CN-XiaoyiNeural','doctor':'zh-CN-YunyangNeural','octopus':'zh-CN-YunjianNeural',
 'bear':'zh-CN-YunxiaNeural','yuanyuan':'zh-CN-liaoning-XiaobeiNeural',
}
STYLE = {
 'sunxiaomei':('+0%','+2Hz'),'atubo':('-6%','-6Hz'),'qianfuren':('-8%','-4Hz'),
 'shalongbasi':('-10%','-10Hz'),'jinbeibei':('+5%','+10Hz'),'rentaro':('-5%','-6Hz'),
 'qiange':('-7%','-8Hz'),'shalagongzhu':('-2%','+8Hz'),'wumi':('-4%','+5Hz'),
 'gongben':('-4%','-4Hz'),'xiaodanni':('+6%','+6Hz'),'tangtang':('+7%','+8Hz'),
 'yuehanqiao':('-6%','-5Hz'),'wumeila':('+5%','+6Hz'),'ludwig':('-3%','-3Hz'),
 'shiyi':('+8%','+10Hz'),'doctor':('-12%','-12Hz'),'octopus':('-8%','-12Hz'),
 'bear':('-14%','-16Hz'),'yuanyuan':('-2%','+4Hz'),
}
LINES = {
 'gain':['钱到手了，今天运气不错。','这笔买卖，值。','再多来一点。'],
 'lose':['这笔账，我记下了。','钱包又轻了。','别急，还没结束。'],
 'rentIn':['租金到账，合作愉快。','这块地，开始回本了。','谢谢惠顾。'],
 'rentOut':['租金真贵。','下次别让我停这儿。','这笔钱花得心疼。'],
 'buy':['这块地，我收了。','先占住位置再说。','成交。'],
 'build':['再加一层。','这里还能更值钱。','建起来。'],
 'card':['这张卡，会有用的。','牌到手了。','留着，等机会。'],
 'god':['今天有神相助。','运气来了。','别走，帮我一把。'],
 'jail':['这地方，我不熟。','先冷静一下。','很快出来。'],
 'hospital':['疼。','先养伤。','下次躲远点。'],
 'bankrupt':['这次，我认输。','钱没了，局还没完。','下次再来。'],
 'win':['这一局，我拿下了。','承让。','棋盘上见真章。'],
}
async def main():
    root = Path('assets/voice')
    jobs = []
    for cid, voice in VOICES.items():
        out = root / cid
        out.mkdir(parents=True, exist_ok=True)
        for event, lines in LINES.items():
            for i, line in enumerate(lines):
                path = out / f'{event}-{i}.mp3'
                if path.exists() and path.stat().st_size > 1000:
                    continue
                jobs.append((path, line, voice, *STYLE[cid]))
    sem = asyncio.Semaphore(16)
    async def one(job):
        path, text, voice, rate, pitch = job
        async with sem:
            tmp = path.with_suffix('.tmp')
            for attempt in range(3):
                try:
                    await edge_tts.Communicate(text, voice, rate=rate, pitch=pitch).save(str(tmp))
                    if not tmp.exists() or tmp.stat().st_size < 1000:
                        raise RuntimeError('empty audio')
                    tmp.replace(path)
                    print(path, flush=True)
                    return
                except Exception as exc:
                    tmp.unlink(missing_ok=True)
                    if attempt == 2:
                        print('FAILED', path, exc, flush=True)
                    else:
                        await asyncio.sleep(1 + attempt)
    await asyncio.gather(*(one(j) for j in jobs))
    print(f'done: {len(jobs)} missing at start')
if __name__ == '__main__':
    asyncio.run(main())
