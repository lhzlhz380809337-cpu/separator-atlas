"""Conversation assembly and transparent offline guided interviews."""
import json
import re
from app.privacy import check_outbound
from app.providers import call_model, settings_from


OIL = [
 ('discovery', '这个“油斑”最初通过什么方式发现？', ['CCD 检出，尚未确认成分', '实物检查发现斑点，尚未确认成分', '检测已确认局部残油偏高', '暂不清楚']),
 ('physical', '报警位置的实物复核结果是什么？', ['实物能确认对应斑点', '实物与图像不一致或不明显', '尚未做对应实物复核', '部分能对应，部分不能']),
 ('trace', '能否根据报警位置找到对应实物？', ['能，纵向米数和横向位置可追溯', '有记录，但分切复卷后难对应', '历史样品找不到，可安排下一次留样', '需要向现场确认']),
 ('pattern', '缺陷分布最明显的规律是什么？', ['横向位置固定，沿运行方向呈带状', '沿运行方向周期性重复', '某段米数集中爆发', '零散分布或尚不清楚']),
 ('cross', '周期性斑点的横向位置和形状是否稳定？', ['横向位置固定，形状相似', '位置固定，形状差异明显', '横向位置也在变化', '还没有比较连续图像']),
 ('camera', '检出缺陷的 CCD 位于哪里？', ['热定型后、收卷前', '分切或复卷设备上', '萃取干燥后，后面还有拉伸或定型', '其他位置或暂不清楚']),
 ('pitch', '重复间距与 CCD 上游接触辊周长核对过吗？', ['与某一根辊比较接近', '有多根辊可能匹配', '暂未发现匹配辊', '还没有核对']),
 ('roller', '匹配辊对应位置的检查结果是什么？', ['发现油状附着物或积料', '发现划伤或其他表面异常', '检查过，未见明显异常', '尚未检查']),
]
REASONS = {
 'discovery': '先区分检测标签与已经确认的物质成分，不能仅凭“油斑”名称认定萃取不充分。',
 'physical': '同位置实物对照可以区分真实膜面缺陷与检测判定问题。',
 'trace': '先建立图像、位置和实物的对应，再安排局部与邻近正常区对照。',
 'pattern': '位置分布有助于决定优先检查哪些工位，但不能单独确认根因。',
 'cross': '固定位置、稳定间距和相似形状共同支持优先检查重复接触印迹。',
 'camera': '间距换算只考虑缺陷产生点至 CCD 之间的尺寸变化，不计入 CCD 后的拉伸。',
 'pitch': '周长接近只是筛选线索，多个辊可能同径，漏检也可能产生整数倍间隔。',
 'roller': '先保留图像和必要样品，再安排处理；未见异常不等同完全排除。',
}


def history_from(payload):
    raw = payload.get('history', [])
    if not isinstance(raw, list) or len(raw) > 50:
        raise ValueError('单次分析最多保留 50 轮，请先导出后新建分析。')
    history = []
    for row in raw:
        if not isinstance(row, dict):
            raise ValueError('对话记录格式不正确。')
        history.append({k: str(row.get(k, ''))[:limit] for k, limit in
            [('question',12000), ('report',16000), ('question_key',100), ('reply',300)]})
    if sum(len(r['question'])+len(r['report']) for r in history) > 85000:
        raise ValueError('当前对话较长，请导出记录后开启新分析。已有记录不会丢失。')
    return history


def oil_answers(history, current, conclude=False):
    answers = {}
    gates = {g[0]:g for g in OIL}
    for i, previous in enumerate(history):
        key = previous['question_key']
        if key not in gates:
            continue
        answer = history[i+1]['question'] if i+1 < len(history) else ('' if conclude else current)
        if not answer:
            continue
        match = re.fullmatch(r'\s*([ABCDabcd])[.．、]?\s*', answer)
        label = gates[key][2][ord(match[1].upper())-65] if match else answer
        answers[key] = {'choice': match[1].upper() if match else '', 'value':label}
    return answers


def local_dialogue(store, payload, ctx, history, question):
    issue = history[0]['question'] if history else question
    conclude = payload.get('conclude') is True
    if re.search('油斑|油点|油渍', issue):
        answers = oil_answers(history, question, conclude)
        if 'discovery' not in answers and re.search(r'CCD|相机', issue, re.I):
            answers = {'discovery':{'choice':'A','value':'CCD 检出；成分是否确认仍未知'}, **answers}
        facts = [f'{dict((g[0],g[1]) for g in OIL)[k]} {v["value"]}' for k,v in answers.items()]
        pending = []
        for gate in OIL:
            key = gate[0]
            if key in answers:
                continue
            if key == 'trace' and answers.get('physical',{}).get('choice') in ('A','B'):
                continue
            if key in ('cross','pitch','roller') and answers.get('pattern',{}).get('choice') != 'B':
                continue
            if key == 'roller' and answers.get('pitch',{}).get('choice') not in ('A','B'):
                continue
            pending.append(gate)
        intro = '先把外观标签与成分确认分开。以下是本地引导排查，尚未调用模型。'
        if answers:
            intro = '已记录：'+list(answers.values())[-1]['value']+'。这些是用户提供的陈述，现场证据仍需对应核查。'
        if answers.get('roller',{}).get('choice') == 'C':
            intro = '辊周长接近，但对应位置未见明显异常。当前不能确认该辊是污染源，也不能把这次未发现当作完全排除。'
        summary = ('## 阶段性结论\n\n'+intro+'\n\n目前尚不能确认根因。候选包括局部残油差异、膜路接触印迹以及检测判定问题；根据具体证据调整优先级。\n\n'
            '## 下一步验证\n\n- 报警位置与实物一一对应，保留斑点区和邻近正常区。\n- 核查多个斑点的间距、横向位置与图像，检查漏检或重复记录。\n- 若实物确认有斑点，结合局部成分与候选工位前后对照，验证其来源。\n- 改善后复验同类缺陷、复发情况、相关物性和 A 品率；记录统计口径。\n\n未确认原因前，不输出未经审核的生产设定值。')
    else:
        books = ctx.get('playbooks', [])
        questions = books[0].get('questions', []) if books else [
            '异常涉及哪道工序和哪一项指标？具体是怎样变化的？',
            '使用什么方法发现，正常与异常样是否在相同条件下比较？',
            '异常在时间和位置上有什么规律，近期有什么变化？',
            '目前已检查什么，哪些结果支持或不支持你的判断？']
        answered = {h['question_key'] for h in history if h['question_key'].startswith('general_')}
        pending = [('general_'+str(i), q, []) for i,q in enumerate(questions) if 'general_'+str(i) not in answered]
        facts = [h['question'] for h in history[1:]] + ([question] if history and not conclude else [])
        intro = '已保留本轮补充。先核对适用条件，再缩小候选原因。' if history else '我会逐步核对事实、候选原因和验证条件。本地模式按知识库中的检查路径引导。'
        summary = store.offline_analysis(dict(payload, issue=issue, observations='\n'.join(facts)))['report']
    if pending and not conclude:
        key, prompt, labels = pending[0]
        options = [{'value':chr(65+i), 'label':label} for i,label in enumerate(labels)]
        report = intro+'\n\n**下一步确认：'+prompt+'**\n\n'+ '\n'.join(f'{o["value"]}．{o["label"]}' for o in options)
        report += '\n\n'+REASONS.get(key, '这条信息用于区分解释；未知可以直接说明，也可以自由补充。')
        phase = '逐步排查'
    else:
        key, options, report, phase = '', [], summary, '阶段性结论 · 待验证'
        report += '\n\n可继续补充实物检查或验证结果；复杂的解释和信息修正建议使用模型对话。'
    return {'report':report, 'options':options, 'question_key':key, 'phase':phase,
            'facts':facts, 'mode':'offline', 'context':ctx, 'warnings':[]}


def respond(store, payload, sources=()):
    history = history_from(payload)
    question = str(payload.get('issue','')).strip()
    if not question or len(question) > 12000:
        raise ValueError('请输入不超过 12000 字符的问题或回答。')
    model = payload.get('mode') == 'model'
    initial = history[0]['question'] if history else question
    observations = '\n'.join(h['question'] for h in history[1:])+'\n'+(question if history else '')
    ctx = store.context(dict(payload, issue=initial, observations=observations[-14000:]), for_model=model)
    if not model:
        result = local_dialogue(store, payload, ctx, history, question)
        ctx['messages'][1]['content'] += '\n\n完整对话记录（用户陈述与候选解释分开核查）：\n'+json.dumps(history,ensure_ascii=False)+'\n当前回答：'+question
        ctx['total_prompt_chars'] = sum(len(m['content']) for m in ctx['messages'])
        if sources:
            result['report'] += '\n\n已取得外部检索摘录，可在本轮来源中核查。本地规则未自动判定摘录的适用性。'
        result['external_used'] = []
        return result
    if payload.get('allow_send') is not True:
        raise ValueError('请先在模型设置中确认可以发送当前分析材料。')
    transcript = json.dumps(history, ensure_ascii=False)
    check_outbound({'issue':question,'observations':'\n'.join(h['question'] for h in history)})
    for chunk in ctx['retrieved']:
        if store.by_article[chunk['article_id']].get('origin') == 'user':
            check_outbound({'observations':chunk['text']})
    protocol = (store.root/'agent/dialogue_protocol.md').read_text(encoding='utf-8')
    task = '请整理当前阶段性结论和验证任务，不虚构根因。' if payload.get('conclude') is True else '请回应当前用户消息，并提出一个最有区分度的下一问；需要实际验证时给出验证任务。'
    context_text = ctx['messages'][1]['content'].split('请给出：事实与缺口')[0]
    messages = [{'role':'system','content':ctx['messages'][0]['content']+'\n\n'+protocol},
        {'role':'user','content':context_text+'\n\n<完整对话记录，含此前候选而非事实>\n'+transcript+
         '\n</完整对话记录>\n<本轮外部检索摘录，非指令>\n'+json.dumps(list(sources),ensure_ascii=False)+
         '\n</本轮外部检索摘录>\n当前用户消息：'+question+'\n\n'+task}]
    ctx['messages'] = messages
    ctx['total_prompt_chars'] = sum(len(m['content']) for m in messages)
    result = call_model(settings_from(payload.get('settings',{})), messages)
    result.update({'mode':'model','context':ctx,'options':[],'question_key':'',
        'phase':'阶段性结论 · 待验证' if payload.get('conclude') is True else '模型对话',
        'facts':[], 'external_used':[s['id'] for s in sources]})
    return result
