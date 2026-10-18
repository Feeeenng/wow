"""从已下载的固定构建公开 CSV 生成离线技能说明；不发起网络或启动游戏工具。"""

import argparse
import csv
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-dir', type=Path, required=True)
parser.add_argument('--output-dir', type=Path, required=True)
parser.add_argument('--spell-pack', type=Path, default=ROOT / 'client/src-tauri/resources/game-data/spells.json')
parser.add_argument('--boss-pack', type=Path, default=ROOT / 'client/src-tauri/resources/game-data/boss-abilities.json')
args = parser.parse_args()
BASE = args.source_dir
BUILD = '12.1.5.70391'

def rows(filename):
    """读取原始 UTF-8 CSV，保留文字与表行身份供来源核对。"""
    with (BASE / filename).open(encoding='utf-8-sig', newline='') as stream:
        return list(csv.DictReader(stream))

spell_rows = rows(f'Spell-{BUILD}.csv')
spells = {int(row['ID']): row for row in spell_rows}
names = {int(row['ID']): row['Name_lang'] for row in rows(f'SpellName-{BUILD}.csv')}
english = {int(row['ID']): row['Name_lang'] for row in rows(f'SpellName-{BUILD}-enUS.csv')}
misc = {}
for row in rows('spellmisc.csv'):
    if row['DifficultyID'] == '0':
        misc[int(row['SpellID'])] = row
durations = {int(row['ID']): row for row in rows(f'SpellDuration-{BUILD}-zhCN.csv')}
casts = {int(row['ID']): row for row in rows(f'SpellCastTimes-{BUILD}.csv')}
ranges = {int(row['ID']): row for row in rows(f'SpellRange-{BUILD}.csv')}
cooldowns = {}
for row in rows(f'SpellCooldowns-{BUILD}.csv'):
    if row['DifficultyID'] == '0':
        cooldowns[int(row['SpellID'])] = row
effects = {}
for row in rows(f'SpellEffect-{BUILD}.csv'):
    if row['DifficultyID'] == '0':
        effects[(int(row['SpellID']), int(row['EffectIndex']) + 1)] = row

def number(value):
    """格式化表内已确定的基础数值，不计算角色等级或难度缩放。"""
    return f'{float(value):g}'

def duration(spell_id):
    """只解析固定持续时间；资源依赖和可变时长继续保留提示。"""
    row = misc.get(spell_id)
    entry = durations.get(int(row['DurationIndex'])) if row else None
    if entry and int(entry['Duration']) >= 0 and entry['Duration'] == entry['MaxDuration'] and int(entry['DurationPerResource']) == 0:
        return number(int(entry['Duration']) / 1000) + '秒'
    return '〔持续时间〕'

def read_bracket(text, index):
    """按嵌套层级读取条件分支，避免将天赋分支误当作常驻效果。"""
    depth, start = 1, index + 1
    index += 1
    while index < len(text):
        if text[index] == '[':
            depth += 1
        elif text[index] == ']':
            depth -= 1
            if depth == 0:
                return text[start:index], index + 1
        index += 1
    return text[start:], index

def conditions(text):
    """列出条件效果而不替角色选择条件；同时兼容连续条件分支。"""
    result, index = '', 0
    while index < len(text):
        if text.startswith('$?', index) or text.startswith('?(', index):
            bracket = text.find('[', index)
            if bracket < 0:
                result += '〔条件效果〕'
                break
            yes, end = read_bracket(text, bracket)
            no = ''
            if end < len(text) and text[end] == '[':
                no, end = read_bracket(text, end)
            label = '〔条件效果：' + conditions(yes)
            if no:
                label += '；否则：' + conditions(no)
            result += label + '〕'
            index = end
        else:
            result += text[index]
            index += 1
    return result

def render(spell_id, text, chain=()):
    """展开说明与名称引用；动态公式显式占位，移除游戏富文本控制符。"""
    if len(chain) > 12:
        return '〔关联技能说明〕'
    def reference(match):
        kind, raw_id = match.groups()
        target = int(raw_id)
        if kind == 'spellname':
            return names.get(target, f'技能 {target}')
        row = spells.get(target, {})
        if target in chain:
            aura = row.get('AuraDescription_lang', '')
            return render(target, aura, chain + (spell_id,)) if aura and '$@' not in aura else f'〔关联技能 {target}〕'
        key = 'AuraDescription_lang' if kind == 'spellaura' else 'Description_lang'
        return render(target, row.get(key, '') or f'〔关联技能 {target}〕', chain + (spell_id,))
    text = re.sub(r'\$@(spelldesc|spellname|spellaura)(\d+)', reference, text)
    text = conditions(text)
    text = re.sub(r'\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}(?:\.\d+)?', '〔数值〕', text)
    def token(match):
        target = int(match.group(1)) if match.group(1) else spell_id
        kind = match.group(2)
        effect_index = int(match.group(3) or '1')
        if kind.lower() == 'd':
            return duration(target)
        if kind.lower() == 't':
            row = effects.get((target, effect_index))
            if row and float(row['EffectAuraPeriod']) > 0:
                return number(float(row['EffectAuraPeriod']) / 1000)
            return '〔间隔〕'
        if kind in ('A', 'a'):
            return '〔范围〕'
        return '〔数值〕'
    text = re.sub(r'\$(\d+)?([A-Za-z])(\d+)?(?![A-Za-z0-9_])', token, text)
    text = re.sub(r'\$@?[A-Za-z_][A-Za-z0-9_]*', '〔数值〕', text)
    text = re.sub(r'\|c[0-9a-fA-F]{8}|\|r', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\|T[^|]*\|t|\|A[^|]*\|a', '', text)
    text = re.sub(r'\|H[^|]*\|h(.*?)\|h', r'\1', text)
    text = re.sub(r'\|cn[A-Za-z_]+:', '', text)
    text = text.replace('|n', '\n')
    text = re.sub(r'\$[^\s\u4e00-\u9fff，。；：、！？（）]+', '〔数值〕', text)
    return text.strip()

requested = json.loads(args.spell_pack.read_text(encoding='utf-8'))['spells']
result = []
missing = []
for item in requested:
    spell_id = item['spellId']
    row = spells.get(spell_id, {})
    raw = row.get('Description_lang') or row.get('AuraDescription_lang')
    if not raw:
        missing.append(spell_id)
        continue
    description = render(spell_id, raw)
    if re.fullmatch(r'〔关联技能 \d+〕', description) and row.get('AuraDescription_lang'):
        description = render(spell_id, row['AuraDescription_lang'])
    record = {'spellId': spell_id, 'name': names.get(spell_id, item['name']), 'description': description}
    if english.get(spell_id):
        record['englishName'] = english[spell_id]
    m = misc.get(spell_id)
    if m:
        r = ranges.get(int(m['RangeIndex']))
        if r:
            minimum, maximum = float(r['RangeMin_0']), float(r['RangeMax_0'])
            record['rangeText'] = ('自身' if maximum == 0 else (number(minimum) + '–' if minimum else '') + number(maximum) + '码范围')
        cast = casts.get(int(m['CastingTimeIndex']))
        if int(m['Attributes_1']) & 68:
            value = duration(spell_id)
            record['castTimeText'] = '引导' + (f'（{value}）' if not value.startswith('〔') else '')
        elif cast and cast['Base'] == cast['Minimum']:
            record['castTimeText'] = '瞬发' if int(cast['Base']) == 0 else number(int(cast['Base']) / 1000) + '秒施法'
    cooldown = cooldowns.get(spell_id)
    if cooldown:
        milliseconds = max(int(cooldown['RecoveryTime']), int(cooldown['CategoryRecoveryTime']))
        if milliseconds > 0:
            record['cooldownText'] = number(milliseconds / 1000) + '秒冷却'
    record['dynamicValues'] = '〔' in description
    if record['dynamicValues']:
        record['descriptionNote'] = '数值、范围及条件效果按资料模板标注；实际效果受等级、难度和天赋影响。'
    record['source'] = 'Wago DB2 固定构建导出（zhCN；不含热修与角色运行时属性）'
    record['build'] = BUILD
    result.append(record)

args.output_dir.mkdir(parents=True, exist_ok=True)
out = args.output_dir / 'spell-tooltips.json'
out.write_text(json.dumps({'schemaVersion': 1, 'source': 'Wago Spell/SpellName/SpellMisc/SpellDuration/SpellEffect/SpellCastTimes/SpellRange/SpellCooldowns', 'build': BUILD, 'spells': result}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
source_files = [f'Spell-{BUILD}.csv', f'SpellName-{BUILD}.csv', f'SpellName-{BUILD}-enUS.csv', 'spellmisc.csv', f'SpellDuration-{BUILD}-zhCN.csv', f'SpellEffect-{BUILD}.csv', f'SpellCastTimes-{BUILD}.csv', f'SpellRange-{BUILD}.csv', f'SpellCooldowns-{BUILD}.csv']
source_map = {'schemaVersion': 1, 'build': BUILD, 'locale': 'zhCN', 'sources': [], 'requestedCount': len(requested), 'descriptionCount': len(result), 'missingSpellIds': missing, 'dynamicDescriptionCount': sum(x['dynamicValues'] for x in result), 'limitations': ['描述来自固定客户端资料模板，不等同于日志当时的热修、角色等级、天赋和史诗难度数值。', '递归展开技能说明与名称引用；只代入固定持续时间与间隔，不推测伤害、治疗、范围或条件分支。', '条件效果保留提示，不据未知角色天赋选择生效分支。', '冷却与施法时间是基础资料值，可能受角色属性修改。']}
for filename in source_files:
    path = BASE / filename
    table = filename.split('-')[0] if filename != 'spellmisc.csv' else 'SpellMisc'
    locale = 'enUS' if '-enUS' in filename else 'zhCN'
    source_map['sources'].append({'table': table, 'locale': locale, 'url': f'https://wago.tools/db2/{table}/csv?build={BUILD}&locale={locale}', 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
source_map['output'] = {'file': out.name, 'bytes': out.stat().st_size, 'sha256': hashlib.sha256(out.read_bytes()).hexdigest()}
boss = json.loads(args.boss_pack.read_text(encoding='utf-8'))
result_ids = {row['spellId'] for row in result}
source_map['bossDescriptionCount'] = sum(row['spellId'] in result_ids for row in boss['spells'])
mythic = next(row for row in boss['encounters'] if row['id'] == 3429 and row['difficulty'] == 16)
source_map['mythicCoiledAltarDescriptionCount'] = sum(spell_id in result_ids for spell_id in mythic['spellIds'])
source_map['mythicCoiledAltarRequestedCount'] = len(mythic['spellIds'])
source_map['generatorSha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
source_map['inputs'] = [
    {'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    for path in [args.spell_pack, args.boss_pack]
]
source_map['samples'] = [
    {'spellId': spell_id, 'rawDescription': spells[spell_id]['Description_lang'],
     'resolvedDescription': next(row['description'] for row in result if row['spellId'] == spell_id)}
    for spell_id in [1282487, 1299960, 642, 17, 269231]
]
(out.parent / 'spell-tooltips-source.json').write_text(json.dumps(source_map, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'descriptionCount': len(result), 'missingCount': len(missing), 'sample': [x for x in result if x['spellId'] in [1282487, 1299960, 642, 17, 269231]]}, ensure_ascii=True))
