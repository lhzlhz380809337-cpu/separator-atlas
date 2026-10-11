"""Offline retrieval regression, deliberately not a model-accuracy score."""
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.core import KnowledgeStore


def evaluate():
    store = KnowledgeStore()
    cases = json.loads((ROOT / "evals/cases.json").read_text(encoding="utf-8"))["cases"]
    rows = []
    for case in cases:
        ctx = store.context(case["input"])
        ids = [p["id"] for p in ctx["playbooks"]]
        expected = case.get("expected_playbook")
        rows.append({"id":case["id"], "title":case["title"], "expected_playbook":expected,
            "matched":ids, "retrieval_pass":expected in ids if expected else None,
            "knowledge_sections":len(ctx["retrieved"]), "knowledge_chars":ctx["knowledge_chars"],
            "human_review_required":True})
    checked = [r for r in rows if r["retrieval_pass"] is not None]
    return {"description":"只验证本地剧本检索，不调用模型，不评定答案的专业正确率。",
        "checked":len(checked), "passed":sum(r["retrieval_pass"] for r in checked), "cases":rows}


if __name__ == "__main__":
    data = evaluate()
    print(json.dumps(data, ensure_ascii=False, indent=2))
    raise SystemExit(0 if data["checked"] == data["passed"] else 1)
