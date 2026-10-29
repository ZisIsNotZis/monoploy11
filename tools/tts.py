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
 'shalongbasi':'zh-CN-YunjianNeural','jinbeibei':'zh-CN-XiaoxiaoNeural','rentaro':'zh-CN-YunxiNeural',
 'qiange':'zh-CN-YunyangNeural','shalagongzhu':'zh-CN-XiaoyiNeural','wumi':'zh-CN-XiaoxiaoNeural',
 'gongben':'zh-CN-YunxiNeural','xiaodanni':'zh-CN-YunyangNeural','tangtang':'zh-CN-XiaoyiNeural',
 'yuehanqiao':'zh-CN-YunjianNeural','wumeila':'zh-CN-XiaoxiaoNeural','ludwig':'zh-CN-YunxiNeural',
 'shiyi':'zh-CN-XiaoyiNeural','doctor':'zh-CN-YunyangNeural','octopus':'zh-CN-YunjianNeural',
 'bear':'zh-CN-YunjianNeural','yuanyuan':'zh-CN-XiaoxiaoNeural',
}
NAMES = {
 'sunxiaomei':'孙小美','atubo':'阿土伯','qianfuren':'钱夫人','shalongbasi':'沙隆巴斯','jinbeibei':'金贝贝',
 'rentaro':'忍太郎','qiange':'千哥','shalagongzhu':'莎拉公主','wumi':'乌咪','gongben':'宫本宝藏',
 'xiaodanni':'小丹尼','tangtang':'糖糖','yuehanqiao':'约翰乔','wumeila':'舞美拉','ludwig':'路德维希','shiyi':'十一',
 'doctor':'神秘博士','octopus':'章鱼王','bear':'小熊','yuanyuan':'圆圆',
}
LINES = {
 'gain':['{n}：钱到手了，今天运气不错。','{n}：这笔买卖，值。','{n}：再多来一点。'],
 'lose':['{n}：这笔账，我记下了。','{n}：钱包又轻了。','{n}：别急，还没结束。'],
 'rentIn':['{n}：租金到账，合作愉快。','{n}：这块地，开始回本了。','{n}：谢谢惠顾。'],
 'rentOut':['{n}：租金真贵。','{n}：下次别让我停这儿。','{n}：这笔钱花得心疼。'],
 'buy':['{n}：这块地，我收了。','{n}：先占住位置再说。','{n}：成交。'],
 'build':['{n}：再加一层。','{n}：这里还能更值钱。','{n}：建起来。'],
 'card':['{n}：这张卡，会有用的。','{n}：牌到手了。','{n}：留着，等机会。'],
 'god':['{n}：今天有神相助。','{n}：运气来了。','{n}：别走，帮我一把。'],
 'jail':['{n}：这地方，我不熟。','{n}：先冷静一下。','{n}：很快出来。'],
 'hospital':['{n}：疼。','{n}：先养伤。','{n}：下次躲远点。'],
 'bankrupt':['{n}：这次，我认输。','{n}：钱没了，局还没完。','{n}：下次再来。'],
 'win':['{n}：这一局，我拿下了。','{n}：承让。','{n}：棋盘上见真章。'],
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
                jobs.append((path, line.replace('{n}', NAMES[cid]), voice))
    sem = asyncio.Semaphore(16)
    async def one(job):
        path, text, voice = job
        async with sem:
            tmp = path.with_suffix('.tmp')
            for attempt in range(3):
                try:
                    await edge_tts.Communicate(text, voice).save(str(tmp))
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
