"""Create allowlisted portable bundles. Never recurse the workspace root."""
from pathlib import Path
import json
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.core import KnowledgeStore
from tools.validate import validate

DOCS = ["环境与依赖.md", "模型接入与迁移.md", "知识结构与维护.md", "下一步资料需求.md", "数据边界.md", "验证记录.md", "星图对话使用说明.md", "动态检索与分析进度.md", "版本说明_0.6.0.md"]


def release():
    result = validate()
    if not result["ok"]:
        raise ValueError("先修复知识结构校验错误")
    store = KnowledgeStore()
    names = {"README.md", "agent/system_prompt.md", "agent/analysis_protocol.md", "agent/dialogue_protocol.md", "agent/retrieval_protocol.md", "agent/system_plan_protocol.md", "agent/playbooks.json", "evals/cases.json", "evals/defect_coverage.json"}
    for article in store.articles:
        if article.get("origin") != "user":
            names.add(article["workspace_file"])
    names.update(p.relative_to(ROOT).as_posix() for p in (ROOT / "knowledge").glob("*/index.json"))
    if (ROOT / "知识图谱/index.json").is_file():
        names.add("知识图谱/index.json")
    names.update(p.relative_to(ROOT).as_posix() for p in (ROOT / "graph").glob("*.json"))
    names.update("docs/" + name for name in DOCS if (ROOT / "docs" / name).is_file())
    manifest = {"version":"0.6.0", "knowledge_files":sorted(names)}
    (ROOT / "bundle_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
    export = ROOT / "exports"
    export.mkdir(exist_ok=True)
    knowledge_zip = export / "separator-knowledge.zip"
    knowledge_zip.write_bytes(store.portable_bundle())
    optional = {"启动工作台.cmd", "启动工作台.ps1", "start-workbench.ps1", "启动桌面版.cmd", "隔膜研析.exe", "config/model.example.json", "知识投递/_使用说明.md", "知识投递/_模板.md"}
    program = set(names) | {"bundle_manifest.json", "requirements.txt", "requirements-dev.txt", ".gitignore"}
    program.update(name for name in optional if (ROOT / name).is_file())
    for folder, suffixes in (("app", {".py", ".html", ".css", ".js", ".svg"}), ("tests", {".py", ".js", ".cjs"}), ("tools", {".py"}), ("desktop", {".cs", ".ps1", ".ico", ".md"})):
        for p in (ROOT / folder).rglob("*"):
            if p.is_file() and p.suffix in suffixes and "__pycache__" not in p.parts:
                program.add(p.relative_to(ROOT).as_posix())
    program_zip = export / "separator-workbench.zip"
    with zipfile.ZipFile(program_zip, "w", zipfile.ZIP_DEFLATED) as z:
        for name in sorted(program):
            p = ROOT / name
            if p.is_symlink() or not p.resolve().is_relative_to(ROOT.resolve()):
                raise ValueError("发布清单中存在越界路径")
            z.write(p, name)
    return {"knowledge_files":len(names), "program_files":len(program), "outputs":[knowledge_zip.name, program_zip.name]}


if __name__ == "__main__":
    print(json.dumps(release(), ensure_ascii=False, indent=2))
