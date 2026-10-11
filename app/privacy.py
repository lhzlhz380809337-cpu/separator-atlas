"""A narrow outbound guard, never a claim of complete automatic anonymization."""
import re

PATTERNS = [
    ("联系方式", r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?<!\d)1[3-9]\d{9}(?!\d)"),
    ("本地文件路径", r"[A-Za-z]:[\\/]|\\\\[^\s]+"),
    ("原始文件名称", r"[^\s<>]+\.(?:xlsx?|pptx?|docx?|pdf)(?:\b|$)"),
    ("内部身份或配方字段", r"(?:客户名称|客户代号|产品代号|产品型号|文件编号|员工姓名|真实配方|工艺设定值)\s*[:：=]\s*\S+"),
    ("疑似访问凭据", r"\bsk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|(?:api[_ -]?key|密钥)\s*[:：=]\s*\S+"),
]

def check_outbound(payload):
    value = "\n".join(str(payload.get(k, "")) for k in ("issue", "route", "observations"))
    reasons = [label for label, pattern in PATTERNS if re.search(pattern, value, flags=re.I)]
    if reasons:
        raise ValueError("发送前检查发现" + "、".join(reasons) + "。请先改写成通用类别和已获准的概括，再调用模型；本地排查仍可使用。")
