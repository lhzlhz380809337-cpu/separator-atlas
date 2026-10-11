"""Read user-maintained text only from the dedicated local inbox.

No original source folder is traversed. User notes remain outside public bundles.
"""
from pathlib import Path
import hashlib
import re

FOLDER = "知识投递"
MAX_SIZE = 512_000
MAX_FILES = 500


def candidates(root):
    base = Path(root) / FOLDER
    if not base.exists() or base.is_symlink() or not base.resolve().is_relative_to(Path(root).resolve()):
        return []
    files = []
    # os.walk does not follow directory symlinks by default; additionally reject reparse points.
    import os
    for directory, folders, names in os.walk(base, followlinks=False):
        folders[:] = sorted(d for d in folders if not d.startswith((".", "_")) and not (Path(directory)/d).is_symlink() and not getattr((Path(directory)/d), "is_junction", lambda:False)())
        for name in sorted(names):
            p = Path(directory) / name
            if p.suffix.lower() not in (".md", ".txt") or name.startswith((".", "_")) or name.lower() == "readme.md":
                continue
            if not p.is_symlink() and p.resolve().is_relative_to(base.resolve()):
                files.append(p)
    return files


def signature(root):
    records = []
    for p in candidates(root):
        try:
            stat = p.stat()
            records.append(f"{p.relative_to(root)}:{stat.st_mtime_ns}:{stat.st_size}")
        except OSError:
            continue
    return hashlib.sha256("\n".join(records).encode()).hexdigest()


def split_meta(text):
    meta = {}
    body = text
    match = re.match(r"\A---\s*\r?\n(.*?)\r?\n---\s*\r?\n", text, re.S)
    if match:
        for line in match.group(1).splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                if key.strip() in ("title", "stage", "tags", "aliases", "links"):
                    meta[key.strip()] = value.strip().strip('"\'')
        body = text[match.end():]
    return meta, body


def items(value):
    return [x.strip().strip('"\'') for x in re.split(r"[,，、]", str(value).strip("[]")) if x.strip()][:30]


def load(root):
    articles, issues = [], []
    files = candidates(root)
    for p in files[:MAX_FILES]:
        note_id = "user_" + hashlib.sha256(p.relative_to(root).as_posix().encode()).hexdigest()[:16]
        try:
            if p.stat().st_size > MAX_SIZE:
                issues.append({"id":note_id, "reason":"单篇超过 500 KB，请拆成多个主题。"})
                continue
            meta, body = split_meta(p.read_text(encoding="utf-8-sig"))
            if len(body.strip()) < 20:
                issues.append({"id":note_id, "reason":"正文不足 20 字符，尚未加入。"})
                continue
            heading = re.search(r"^#\s+(.+)$", body, re.M)
            title = meta.get("title") or (heading.group(1).strip() if heading else "自建知识 " + note_id[-6:])
            stage = meta.get("stage", "方法")
            if stage not in ("基膜", "涂覆", "电芯", "方法"):
                stage = "方法"
            clean = re.sub(r"\[\[([^]|]+)(?:\|[^]]+)?\]\]", r"\1", body)
            summary = " ".join(l.strip() for l in clean.splitlines() if l.strip() and not l.startswith("#"))[:150]
            articles.append({"id":note_id, "title":title[:100], "summary":summary, "stage":stage,
                "category":"自建知识", "tags":items(meta.get("tags", "")), "aliases":items(meta.get("aliases", "")),
                "links":items(meta.get("links", ""))+re.findall(r"\[\[([^]|#]+)(?:[^]]*)\]\]", body),
                "origin":"user", "content":body, "file":p.relative_to(root).as_posix(),
                "evidence_status":"用户添加，未经过专业审核"})
        except (OSError, UnicodeError):
            issues.append({"id":note_id,"reason":"无法读取 UTF-8 文本，或文件正在写入。"})
    if len(files) > MAX_FILES:
        issues.append({"id":"limit", "reason":"本版本最多载入 500 篇自建知识，其余暂不加载。"})
    return articles, {"folder":FOLDER, "loaded":len(articles), "issues":issues, "signature":signature(root)}


def universe(store):
    nodes = [dict(n, kind="concept") for n in store.nodes]
    edges = [dict(e, kind="mechanism") for e in store.edges]
    lookup = {n["label"]:n["id"] for n in nodes}
    for a in store.articles:
        nid = "doc:"+a["id"]
        nodes.append({"id":nid,"label":a["title"],"stage":a["stage"],"type":"知识条目", "kind":"article",
            "summary":a["summary"], "article_ids":[a["id"]], "origin":a.get("origin", "curated")})
        for key in [a["title"],a["id"]]+a.get("aliases", []):
            lookup[key] = nid
    seen = set()
    def connect(source, target, kind, relation):
        if source == target or (source,target) in seen:
            return
        seen.add((source,target))
        edges.append({"id":f"{kind}:{source}:{target}","source":source,"target":target,"kind":kind,"relation":relation})
    for n in store.nodes:
        for aid in n.get("article_ids", []):
            if aid in store.by_article:
                connect("doc:"+aid,n["id"],"explains","条目解释该知识点")
    for a in store.articles:
        if a.get("origin") != "user":
            continue
        source = "doc:"+a["id"]
        for name in a.get("links", []):
            if name.strip() in lookup:
                connect(source,lookup[name.strip()],"explicit","作者指定的知识关联；不等同已验证因果")
        matches = [n for n in store.nodes if len(n["label"]) >= 2 and n["label"] in a["content"]]
        for n in sorted(matches,key=lambda n:len(n["label"]),reverse=True)[:8]:
            connect(source,n["id"],"topic","正文术语匹配的主题关联；不等同已验证因果")
    return {"nodes":nodes,"edges":edges}
