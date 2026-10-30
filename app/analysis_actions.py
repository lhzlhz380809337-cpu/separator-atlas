"""Separate conversation commands from observations, including old transcripts."""
import re

KINDS = ('dialogue', 'system_plan', 'conclusion')
PLAN = re.compile(r'(?:系统(?:性|性的)?|综合|整体)(?:解决|改善|整改|处理|应对)?方案|先给(?:做法|方案)')


def wants_plan(text):
    return bool(PLAN.search(text)) and not re.search(r'(?:不要|不需要|暂不|先不).{0,8}(?:方案|做法)', text)


def observation(text):
    """Remove the request clause while retaining separately stated observations."""
    return '；'.join(part.strip() for part in re.split(r'[，,。；;\n]', text)
                    if part.strip() and not wants_plan(part))


def kind(row):
    explicit = row.get('turn_kind')
    if explicit in KINDS:
        return explicit
    if wants_plan(row.get('question', '')):
        return 'system_plan'
    if str(row.get('phase', '')).startswith('阶段性结论') or row.get('question', '') in (
            '整理结论', '请根据目前的问答整理阶段性结论和下一步验证任务。'):
        return 'conclusion'
    return 'dialogue'
