"""Portable evidence ledger. User reports and model candidates never share a status.

This is a reviewable record, not a chain of thought or a trusted instruction store.
Unknown fields are discarded at the import boundary.
"""
import json
import re
from app import analysis_actions


def unperformed(text):
    value=re.sub(r'\s+','',text)
    action=r'(?:实物)?(?:检查|检测|测量|确认|复核|核对|核查|取样|比较|留样|验证|试验|对照)'
    return bool(re.search(r'(?:尚|暂|还)?未(?:做|进行|完成)?'+action+
        r'|(?:还)?没(?:有)?(?:做过|进行过|做|进行|去|能)?'+action+
        r'|还没|未做|不清楚|不知道|需要.*确认|准备|计划|打算',value))


def stated_part(answer):
    """Keep explicit observations separate from hypothetical/guess clauses.

    The complete answer stays in the ledger and transcript. This conservative
    extraction is only used for retrieval and evidence eligibility.
    """
    clauses=re.split(r'[。；;\n]|[，,](?=(?:我(?:们)?(?:认为|觉得|怀疑|猜测|估计))|可能|也许|假设|如果|或许)',answer)
    uncertainty=r'如果|假设|假如|猜测|估计|可能|也许|或许|推测|怀疑|我(?:们)?(?:认为|觉得)'
    return '；'.join(c.strip(' ，,') for c in clauses if c.strip(' ，,') and not re.search(uncertainty,c))


def _text(value, limit, name, required=False):
    if value is None:
        value = ''
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise ValueError('分析进度的'+name+'为空、过长或格式不正确。')
    return value


def _list(value, limit, name):
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > limit:
        raise ValueError('分析进度的'+name+'超出范围。')
    return value


def _ids(value, limit=100):
    return [_text(v, 200, '标识', True) for v in _list(value, limit, '标识')]


def options_from(value=None, report=''):
    if value:
        result = []
        for row in _list(value, 10, '选项'):
            if not isinstance(row, dict):
                raise ValueError('分析进度的选项格式不正确。')
            result.append({'value':_text(row.get('value'), 10, '选项编号', True),
                           'label':_text(row.get('label'), 1000, '选项文字', True)})
        if len({r['value'].upper() for r in result}) != len(result):
            raise ValueError('分析进度中存在重复的选项编号。')
        return result
    # Delimited options can be inline or on separate lines. Never absorb B's
    # negative answer into A merely because both appear in one short sentence.
    report=re.sub(r'\*\*|__','',report)
    matches=list(re.finditer(r'(?<![A-Za-z0-9])(?:([A-Ja-j])[.．、:：)）]|[（(]([A-Ja-j])[）)])\s*',report))
    if matches:
        result=[]
        for i,m in enumerate(matches):
            letter=(m[1] or m[2]).upper()
            if result and ord(letter)!=ord(result[-1]['value'])+1:
                break
            label=report[m.end():matches[i+1].start() if i+1<len(matches) else len(report)].strip(' \n\r；;，,-')
            if label:
                result.append({'value':letter,'label':label[:1000]})
        return result[:10]
    matches = list(re.finditer(r'(?:^|\s)([A-J])\s+(.+?)(?=\s+[A-J]\s+|$)', report))
    return [{'value':m[1], 'label':m[2].strip()[:1000]} for m in matches[:10]]


def pending_from(report, options=None):
    choices = options_from(options, report)
    clean_report=re.sub(r'\*\*|__','',report)
    if choices:
        first=re.search(r'(?<![A-Za-z0-9])(?:[A-Ja-j][.．、:：)）]|[（(][A-Ja-j][）)])',clean_report)
        if first and re.search(r'[？?]',clean_report[:first.start()]):
            clean_report=clean_report[:first.start()]
    lines = [line.strip().lstrip('# ') for line in clean_report.splitlines() if line.strip()]
    questions = [line for line in lines if ('？' in line or '?' in line)
                 and not re.match(r'^[A-J][.．、:：)）]', line)]
    prompt = questions[-1] if questions else (lines[0] if choices and lines else '')
    return {'question':prompt[:2000], 'options':choices}


def normalize_state(value):
    if value is None:
        return None
    if not isinstance(value, dict) or value.get('version') != 1:
        raise ValueError('分析进度版本或格式不正确。')
    turn = value.get('turn')
    if type(turn) is not int or not 0 <= turn <= 500:
        raise ValueError('分析进度轮次不正确。')
    state = {'version':1, 'initial_issue':_text(value.get('initial_issue'), 12000, '初始问题', True),
             'turn':turn, 'facts':[], 'hypotheses':[], 'checks':[], 'open_questions':[], 'retrieval_history':[]}
    for row in _list(value.get('facts'), 500, '陈述'):
        if not isinstance(row, dict) or row.get('status') not in ('reported','unknown','superseded','disputed'):
            raise ValueError('分析进度的陈述状态不正确。')
        n = row.get('turn')
        if type(n) is not int or not 1 <= n <= turn:
            raise ValueError('分析进度的陈述轮次不正确。')
        fact = {'id':_text(row.get('id'), 200, '陈述标识', True), 'turn':n,
                'text':_text(row.get('text'), 14000, '陈述', True),
                'prompt':_text(row.get('prompt'), 2000, '对应问题'),
                'answer':_text(row.get('answer'), 12000, '原始回答'),
                'status':row['status'], 'source':'user'}
        if row.get('superseded_by'):
            fact['superseded_by'] = _text(row['superseded_by'], 200, '更正标识', True)
        state['facts'].append(fact)
    fact_ids = {f['id'] for f in state['facts']}
    if len(fact_ids) != len(state['facts']):
        raise ValueError('分析进度中存在重复的陈述标识。')
    for f in state['facts']:
        if f.get('superseded_by') and (f['superseded_by'] not in fact_ids or f['superseded_by'] == f['id']):
            raise ValueError('分析进度的更正引用不存在。')
    for row in _list(value.get('hypotheses'), 12, '候选'):
        if not isinstance(row, dict) or row.get('status') not in ('candidate','weakened'):
            raise ValueError('分析进度中的候选不能标记成已确认根因。')
        support, against = _ids(row.get('support'),30), _ids(row.get('against'),30)
        if not set(support+against) <= fact_ids:
            raise ValueError('候选引用了不存在的现场陈述。')
        state['hypotheses'].append({'id':_text(row.get('id'),80,'候选标识',True),
            'text':_text(row.get('text'),1500,'候选',True),'support':support,'against':against,'status':row['status']})
    hypothesis_ids = {h['id'] for h in state['hypotheses']}
    if len(hypothesis_ids) != len(state['hypotheses']):
        raise ValueError('候选标识重复。')
    state['factor_relations'] = []
    for row in _list(value.get('factor_relations'), 24, '因素关系'):
        if not isinstance(row, dict) or row.get('kind') not in ('competing', 'joint', 'unclear'):
            raise ValueError('因素关系格式不正确。')
        members = _ids(row.get('members'), 12)
        refs = _ids(row.get('fact_ids'), 30)
        if len(set(members)) < 2 or not set(members) <= hypothesis_ids or not set(refs) <= fact_ids:
            raise ValueError('因素关系引用不完整。')
        state['factor_relations'].append({'kind':row['kind'], 'members':members, 'fact_ids':refs,
            'reason':_text(row.get('reason'), 1500, '关系说明'), 'status':'unverified'})
    state['plan_basis'] = {}
    basis = value.get('plan_basis') or {}
    if not isinstance(basis, dict):
        raise ValueError('方案依据格式不正确。')
    for key in ('scope', 'location', 'comparison', 'action'):
        refs = _ids(basis.get(key), 20)
        if not set(refs) <= fact_ids:
            raise ValueError('方案依据引用不存在。')
        state['plan_basis'][key] = refs
    for row in _list(value.get('checks'),30,'检查'):
        if not isinstance(row, dict):
            raise ValueError('分析进度的检查格式不正确。')
        refs = _ids(row.get('fact_ids'),30)
        if not refs or not set(refs) <= fact_ids:
            raise ValueError('检查结果必须引用用户陈述。')
        state['checks'].append({'text':_text(row.get('text'),2000,'检查',True), 'fact_ids':refs,'status':'user_reported'})
    state['open_questions'] = [_text(q,1000,'未决问题',True) for q in _list(value.get('open_questions'),12,'未决问题')]
    for row in _list(value.get('retrieval_history'),500,'检索记录'):
        if not isinstance(row, dict) or type(row.get('turn')) is not int or not 0 <= row['turn'] <= turn:
            raise ValueError('分析进度的检索记录格式不正确。')
        state['retrieval_history'].append({'turn':row['turn'],
            'queries':[_text(q,2000,'检索词',True) for q in _list(row.get('queries'),3,'检索词')],
            'article_ids':_ids(row.get('article_ids')), 'edge_ids':_ids(row.get('edge_ids'))})
    pending = value.get('pending') or {}
    if not isinstance(pending,dict):
        raise ValueError('待答问题格式不正确。')
    state['pending'] = {'question':_text(pending.get('question'),2000,'待答问题'),
                        'options':options_from(pending.get('options'))}
    if len(json.dumps(state,ensure_ascii=False)) > 250000:
        raise ValueError('结构化分析进度较大，请保存完整记录后，为新的调查阶段建立对话。')
    return state


def _correction(state, current):
    answer = current['answer']
    if not stated_part(answer):
        return
    cue = re.search(r'更正|纠正|说错|记错|不是|并非|实际上|重新核对|不固定|不呈周期', answer)
    if not cue:
        return
    negatives = re.findall(r'(?:不是|并非)([^，,。；;！？?]{2,25})', answer)
    for old in state['facts'][:-1]:
        if old['status'] not in ('reported','unknown','disputed'):
            continue
        exact = any(n.rstrip('的') in old['answer'] for n in negatives)
        periodic = bool(re.search(r'不固定|不是固定|不呈周期|不是周期|非周期', answer)
                        and re.search(r'周期性重复|固定间距|等间距', old['answer']))
        if exact or periodic:
            old['status'], old['superseded_by'] = 'superseded', current['id']


def _append(state, question, previous, turn):
    if question.strip() in ('继续','继续深入分析','整理结论','整理交接','整理交接记录'):
        return
    pending = state.get('pending') or (pending_from(previous.get('report',''), previous.get('options')) if previous else {'question':'','options':[]})
    choice = re.fullmatch(r'\s*([A-Ja-j](?:\s*[,，、+＋/和及 ]\s*[A-Ja-j])*)[.．、]?(?:\s+(.+))?\s*', question, re.S)
    meaning, status = question, 'reported'
    if choice:
        options = {o['value'].upper():o['label'] for o in pending['options']}
        selected = re.findall(r'[A-J]', choice[1].upper())
        if all(letter in options for letter in selected):
            meaning = '；'.join(options[letter] for letter in dict.fromkeys(selected)) + ('；'+choice[2] if choice[2] else '')
        else:
            meaning, status = '选项 '+choice[1].upper()+' 的含义未能对应，需要核对上一轮选项', 'unknown'
    if unperformed(meaning):
        status = 'unknown'
    observation=stated_part(meaning)
    if not observation:
        status='unknown'
    if not choice and re.search(r'^(?:请问|为什么|怎么|如何|是否|能否)|[吗呢][？?]?$|[？?]$',question):
        status = 'unknown'
    text = (pending['question']+' '+(observation or meaning)).strip()
    row = {'id':f'f{turn}','turn':turn,'text':text,'prompt':pending['question'],
           'answer':meaning, 'status':status,'source':'user'}
    state['facts'].append(row)
    _correction(state,row)


def advance(payload, history, initial, question, archived=0, handoff=False):
    expected = archived+len(history)
    state = normalize_state(payload.get('analysis_state'))
    if state and (state['turn'] != expected or state['initial_issue'] != initial):
        raise ValueError('分析进度与当前问答不对应，请重新载入匹配的进度文件。')
    if state is None:
        state = {'version':1,'initial_issue':initial,'turn':expected,'facts':[],
                 'hypotheses':[],'checks':[],'open_questions':[],'retrieval_history':[],
                 'pending':{'question':'','options':[]}}
        # Old sessions have no ledger. Replay only real user messages, never turn a
        # handoff summary or assistant answer into a verified observation.
        for i, row in enumerate(history):
            row_kind = analysis_actions.kind(row)
            statement = analysis_actions.observation(row['question']) if row_kind == 'system_plan' else row['question']
            if statement and row_kind != 'conclusion':
                _append(state,statement,None,archived+i+1)
            if row_kind == 'dialogue':
                state['pending'] = pending_from(row.get('report',''), row.get('options'))
    if not handoff:
        state['turn'] = expected+1
        if state['turn'] > 500:
            raise ValueError('本次调查已达 500 轮，请先保存进度。')
        if payload.get('conclude') is not True:
            statement = analysis_actions.observation(question) if payload.get('action') == 'system_plan' else question
            if statement:
                _append(state,statement,history[-1] if history else None,state['turn'])
    return apply_plan(normalize_state(state),{})


def retrieval_focus(state):
    facts = [f for f in state['facts'] if f['status'] in ('reported','unknown')]
    # Place newest evidence first; do not fill a limited search query from the
    # oldest 2,500 characters or reintroduce superseded observations.
    return '\n'.join(f['text'] for f in reversed(facts[-6:]))[:6000]


def parse_plan(raw):
    raw = raw.strip()
    if raw.startswith('```'):
        raw = re.sub(r'^```(?:json)?\s*|\s*```$', '', raw, flags=re.I)
    data = json.loads(raw)
    if not isinstance(data,dict):
        raise ValueError('检索计划格式不正确。')
    queries=[]
    for row in _list(data.get('queries'),2,'补查请求'):
        if not isinstance(row,dict):
            raise ValueError('补查请求格式不正确。')
        query=_text(row.get('query'),2000,'补查词',True).strip()
        if query not in [q['query'] for q in queries]:
            queries.append({'query':query,'reason':_text(row.get('reason'),1000,'补查理由',True)})
    return dict(data,queries=queries)


def apply_plan(state, plan):
    candidate = json.loads(json.dumps(state,ensure_ascii=False))
    facts={f['id']:f for f in candidate['facts']}
    for row in _list(plan.get('supersede'),20,'更正'):
        if not isinstance(row,dict):
            raise ValueError('更正格式不正确。')
        old,new=facts.get(row.get('fact_id')),facts.get(row.get('by'))
        if not old or not new or new['turn'] != state['turn'] or old['turn'] >= new['turn']:
            raise ValueError('更正必须由当前用户陈述支持。')
        if not stated_part(new['answer']):
            raise ValueError('假设性的说法不能更正现场事实。')
        _text(row.get('reason'),1000,'更正理由',True)
        # An inferred contradiction is held as disputed unless the user actually
        # indicates a correction. In neither case is it used as active evidence.
        explicit = re.search(r'更正|纠正|说错|记错|不是|并非|实际|重新|不固定|不呈周期',new['answer'])
        old['status']='superseded' if explicit else 'disputed'
        old['superseded_by']=new['id']
    for field in ('hypotheses','checks','open_questions','factor_relations','plan_basis'):
        if field in plan:
            candidate[field]=plan[field]
    if 'hypotheses' in plan and 'factor_relations' not in plan:
        available = {h.get('id') for h in plan['hypotheses'] if isinstance(h, dict)}
        candidate['factor_relations'] = [r for r in candidate.get('factor_relations', []) if set(r['members']) <= available]
    clean=normalize_state(candidate)
    active={f['id'] for f in clean['facts'] if f['status']=='reported' and stated_part(f['answer']) and not unperformed(stated_part(f['answer']))}
    # No candidate may keep a superseded/unknown observation as supporting proof.
    for h in clean['hypotheses']:
        prior_support=bool(h['support'])
        h['support']=[i for i in h['support'] if i in active]
        h['against']=[i for i in h['against'] if i in active]
        if prior_support and not h['support']:
            h['status']='weakened'
    for refs in clean['plan_basis'].values():
        refs[:] = [i for i in refs if i in active]
    for relation in clean['factor_relations']:
        relation['fact_ids'] = [i for i in relation['fact_ids'] if i in active]
    completed=r'(?:已|刚|重新|再次|实际|做了|进行过).{0,12}(?:检查|检测|测量|核对|复核|取样|试验)|(?:检查|检测|测量|复核|核对|取样|留样|对照|复验|试验)(?:过|了|结果|显示|完成)|未见|未发现|发现|观察到|测得|实物.*对应|比较接近'
    clean['checks']=[c for c in clean['checks'] if set(c['fact_ids']) <= active
        and all(re.search(completed, stated_part(facts[i]['answer'])) and not unperformed(stated_part(facts[i]['answer'])) for i in c['fact_ids'])]
    return clean


def finish(state, result, ctx, handoff=False):
    if not handoff:
        if result.get('turn_kind', 'dialogue') == 'dialogue':
            state['pending']=pending_from(result['report'],result.get('options'))
        else:
            result['resume_pending'] = state['pending']
        trace=ctx.get('retrieval_trace',[])
        queries=list(dict.fromkeys(t['query'] for t in trace if t.get('query')))[:3]
        state['retrieval_history'].append({'turn':state['turn'], 'queries':[q[:2000] for q in queries],
            'article_ids':ctx['activation']['article_ids'], 'edge_ids':ctx['activation']['edge_ids']})
    result['analysis_state']=normalize_state(state)
    result['plan_readiness'] = readiness(state)
    return result


def readiness(state):
    active = {f['id'] for f in state['facts'] if f['status']=='reported' and stated_part(f['answer']) and not unperformed(stated_part(f['answer']))}
    unique = {re.sub(r'\s+', '', f['text']) for f in state['facts'] if f['id'] in active}
    basis = state.get('plan_basis', {})
    covered = [key for key in ('scope','location','comparison','action') if set(basis.get(key, [])) & active]
    conflict = any(f['status']=='disputed' for f in state['facts'])
    ready = 'scope' in covered and 'action' in covered and ('location' in covered or 'comparison' in covered) and not conflict
    unknown = sum(f['status']=='unknown' for f in state['facts'][-3:]) >= 2
    return {'ready':ready,'effective_turns':len(unique),'covered':covered,
            'reason':'可形成阶段方案，根因仍需验证' if ready else '需要现场取证，也可先生成初步方案' if unknown else '可随时生成初步方案'}
