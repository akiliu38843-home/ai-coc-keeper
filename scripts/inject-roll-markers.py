#!/usr/bin/env python3
# 后处理 start.txt: 把骰检结果文字徽章 → __COC_ROLL__<base64-json>__ marker
#
# 输入:
#   [侦查 65/65 成功] 白得过分的墙面几乎没有阴影可藏，;
#   [侦查 51/65 成功] [心智 -2 → 58/60] 你在样本之间仔细搜寻，;
#
# 输出:
#   __COC_ROLL__<base64>__;
#   白得过分的墙面几乎没有阴影可藏，;
#
#   __COC_ROLL__<base64>__;
#   你在样本之间仔细搜寻，;
#
# 跑法:
#   python3 scripts/inject-roll-markers.py [path/to/start.txt]
#   默认改 external/WebGAL/packages/webgal/public/game/scene/start.txt
#
# 转换后会同步 dist/game/scene/start.txt (如果存在)

import base64
import json
import re
import shutil
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_START = PROJECT_ROOT / 'external/WebGAL/packages/webgal/public/game/scene/start.txt'
DIST_START = PROJECT_ROOT / 'external/WebGAL/packages/webgal/dist/game/scene/start.txt'

# 角色名 → 内部 skill key (用于 showRoll 时拿到 skill icon 之类; 现在只显示中文 skill 名)
# 注: outcome 字符串保持中文, showRoll 自己识别 "大成功" / "大失败" 走暴击演出

# 主骰检: [skillName roll/target outcome]
# outcome 6 种: 大成功 / 极难成功 / 困难成功 / 成功 / 失败 / 大失败 -- 覆盖 大极困难成功失败 全部 8 字
ROLL_RE = re.compile(r'\[([^\[\]/]+?)\s+(\d+)/(\d+)\s+([大极困难成功失败]+?)\]')
# 心智效果: [心智 -2 → 58/60]
SAN_RE = re.compile(r'\[心智\s+([+-]?\d+)\s*→\s*(\d+)/(\d+)\]')
# HP 效果: [HP -3 → 9/12]
HP_RE = re.compile(r'\[HP\s+([+-]?\d+)\s*→\s*(\d+)/(\d+)\]')


def encode_marker(payload: dict) -> str:
    """B 路: 输出 WebGAL 原生命令 cocRoll:<base64>; (替代 __COC_ROLL__ marker hack)"""
    raw = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    b64 = base64.b64encode(raw).decode('ascii')
    return f'cocRoll:{b64}'


def process_line(line: str) -> list[str]:
    """单行 narrate → 1 或 2 行 (marker + 干净 narrate). 不含徽章则原样返回."""
    stripped_end = line.rstrip('\n')
    # 必须以 ; 结尾 (narrate)
    if not stripped_end.endswith(';'):
        return [line]
    body = stripped_end[:-1]  # 去末尾 ;

    roll_m = ROLL_RE.match(body)
    if not roll_m:
        # 没有 skill 骰检, 但可能是纯心智 / 纯 HP 下降:
        #   [心智 -1 → 55/60] narrate...
        #   [HP -3 → 9/12] narrate...
        # 转成 cocRoll target:0 (RollReveal 不出骰子, 只显示效果牌)
        pure_san = SAN_RE.match(body)
        pure_hp = HP_RE.match(body)
        pure = pure_san or pure_hp
        if not pure:
            return [line]
        stat = 'san' if pure_san else 'hp'
        delta = int(pure.group(1))
        to = int(pure.group(2))
        max_ = int(pure.group(3))
        rest = body[pure.end():].lstrip()
        # outcome 简化: -值 用"损耗", +值 用"恢复"
        outcome = '损耗' if delta < 0 else ('恢复' if delta > 0 else '维持')
        skill = '心智' if stat == 'san' else '体力'
        payload = {
            'skill': skill,
            'roll': 0,
            'target': 0,   # RollReveal 看 target==0 不出骰子
            'outcome': outcome,
            'effects': [{'stat': stat, 'delta': delta, 'to': to, 'max': max_}],
        }
        out = [f'{encode_marker(payload)};\n']
        if rest:
            out.append(f'{rest};\n')
        return out

    skill = roll_m.group(1).strip()
    roll = int(roll_m.group(2))
    target = int(roll_m.group(3))
    outcome = roll_m.group(4).strip()

    # 剥掉主徽章前缀
    rest = body[roll_m.end():].lstrip()

    # 抓 (零个或多个) 心智/HP 效果徽章
    effects = []
    while True:
        san_m = SAN_RE.match(rest)
        hp_m = HP_RE.match(rest)
        if san_m:
            effects.append({
                'stat': 'san',
                'delta': int(san_m.group(1)),
                'to': int(san_m.group(2)),
                'max': int(san_m.group(3)),
            })
            rest = rest[san_m.end():].lstrip()
        elif hp_m:
            effects.append({
                'stat': 'hp',
                'delta': int(hp_m.group(1)),
                'to': int(hp_m.group(2)),
                'max': int(hp_m.group(3)),
            })
            rest = rest[hp_m.end():].lstrip()
        else:
            break

    payload = {
        'skill': skill,
        'roll': roll,
        'target': target,
        'outcome': outcome,
    }
    if effects:
        payload['effects'] = effects
    marker = encode_marker(payload)

    out = [f'{marker};\n']
    if rest:
        out.append(f'{rest};\n')
    return out


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_START
    if not src.exists():
        print(f'❌ start.txt 不存在: {src}', file=sys.stderr)
        sys.exit(1)

    bak = src.with_suffix(src.suffix + '.pre-marker.bak')
    if not bak.exists():
        shutil.copy(src, bak)
        print(f'💾 备份 {bak.name}')

    in_lines = src.read_text(encoding='utf-8').splitlines(keepends=True)
    out_lines: list[str] = []
    converted = 0
    for line in in_lines:
        new = process_line(line)
        if len(new) != 1 or new[0] != line:
            converted += 1
        out_lines.extend(new)

    src.write_text(''.join(out_lines), encoding='utf-8')
    print(f'✏️  转换 {converted} 条徽章 → marker  (写入 {src.name})')

    if DIST_START.exists():
        shutil.copy(src, DIST_START)
        print(f'📦 同步到 dist/game/scene/start.txt')


if __name__ == '__main__':
    main()
