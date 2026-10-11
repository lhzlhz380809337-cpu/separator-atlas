"""Validate curated assets without opening original material."""
from pathlib import Path
import json
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.core import KnowledgeStore


def validate(root=ROOT):
    store = KnowledgeStore(root)
    errors = []
    for label, rows in (("文章", store.articles), ("节点", store.nodes), ("关系", store.edges), ("剧本", store.playbooks)):
        ids = [x.get("id") for x in rows]
        if not all(ids) or len(ids) != len(set(ids)):
            errors.append(label + " ID 缺失或重复")
    article_ids = set(store.by_article)
    node_ids = set(store.by_node)
    for row in store.nodes + store.edges:
        if not row.get("article_ids") or set(row["article_ids"]) - article_ids:
            errors.append("图谱文章关联无效：" + row.get("id", ""))
    for edge in store.edges:
        if edge["source"] not in node_ids or edge["target"] not in node_ids:
            errors.append("关系端点不存在：" + edge["id"])
        for field in ("mechanism", "conditions", "checks", "control_points", "failure_modes"):
            if not edge.get(field):
                errors.append("关系缺少 " + field + "：" + edge["id"])
    for article in store.articles:
        if article["stage"] not in ("基膜", "涂覆", "电芯", "方法"):
            errors.append("文章阶段无效：" + article["id"])
        if len(article["content"]) < 400 and article.get("origin") != "user":
            errors.append("文章内容过短，需审阅：" + article["id"])
    for source in store.sources:
        url = urlsplit(source.get("url", ""))
        if url.scheme != "https" or not url.netloc or not source.get("limits"):
            errors.append("公开来源缺少链接或边界：" + source.get("id", ""))
    for p in store.playbooks:
        if set(p.get("article_ids", [])) - article_ids:
            errors.append("剧本知识关联无效：" + p["id"])
        if len(p.get("hypotheses", [])) < 3:
            errors.append("诊断剧本缺少可区分假设：" + p["id"])
        for hypothesis in p.get("hypotheses", []):
            if not all(hypothesis.get(k) for k in ("cause", "mechanism", "support", "against", "checks", "tradeoffs")):
                errors.append("诊断假设字段不完整：" + p["id"])
    cases = json.loads((root / "evals/cases.json").read_text(encoding="utf-8"))["cases"]
    book_ids = {p["id"] for p in store.playbooks}
    for case in cases:
        if case.get("expected_playbook") and case["expected_playbook"] not in book_ids:
            errors.append("评测引用剧本不存在：" + case["id"])
    return {"ok":not errors, "stats":store.stats(), "evaluation_cases":len(cases), "errors":errors}


if __name__ == "__main__":
    result = validate()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result["ok"] else 1)
