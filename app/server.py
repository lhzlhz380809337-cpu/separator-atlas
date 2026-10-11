"""Loopback-only web application. Run: python app/server.py --open"""
from __future__ import annotations
import argparse
import json
import mimetypes
import os
from pathlib import Path
import secrets
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs, unquote

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import ROOT, KnowledgeStore
from app.providers import ProviderError, call_model, settings_from
from app.privacy import check_outbound
from app import custom_knowledge
from app.dialogue import respond
from app.research import search_public

WEB = ROOT / "app/web/dist"
VERSION = "0.3.1"


def public_article(article):
    return {k:v for k,v in article.items() if k not in ("content", "file", "workspace_file")}


def review_flags(report):
    flags = []
    if not any(x in report for x in ("反证", "反对", "排除")):
        flags.append("请检查答案是否给出反对证据或排除条件。")
    if not any(x in report for x in ("验证", "试验", "复验")):
        flags.append("请检查答案是否包含可执行的验证方案。")
    if any(x in report for x in ("唯一原因", "必然导致", "保证安全", "完全排除隔膜")):
        flags.append("检测到绝对化表达，请结合上下文核查其依据。")
    return flags


def make_handler(store, csrf_token, port):
    snapshot = [store]
    research_cache = {}
    research_lock = threading.Lock()
    allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
    allowed_origins = {f"http://{host}" for host in allowed_hosts}

    class Handler(BaseHTTPRequestHandler):
        server_version = "SeparatorWorkbench"

        def log_message(self, format, *args):
            # Do not write questions, credentials, URL queries, or model content to logs.
            pass

        def send_data(self, body, status=200, content_type="application/json; charset=utf-8", filename=None):
            if isinstance(body, (dict, list)):
                body = json.dumps(body, ensure_ascii=False).encode("utf-8")
            elif isinstance(body, str):
                body = body.encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
            if filename:
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def check_origin(self, mutation=False):
            if self.headers.get("Host") not in allowed_hosts:
                self.send_data({"error":"访问地址不受支持，请使用本机启动地址。"}, 403)
                return False
            origin = self.headers.get("Origin")
            if origin and origin not in allowed_origins:
                self.send_data({"error":"仅接受本地工作台请求。"}, 403)
                return False
            if mutation and not secrets.compare_digest(self.headers.get("X-Workbench-Token", ""), csrf_token):
                self.send_data({"error":"页面会话已失效，请刷新。"}, 403)
                return False
            return True

        def do_GET(self):
            store = snapshot[0]
            if not self.check_origin():
                return
            parsed = urlsplit(self.path)
            path = unquote(parsed.path)
            query = parse_qs(parsed.query)
            try:
                if path == "/api/bootstrap":
                    self.send_data({"version":VERSION, "token":csrf_token, "stats":store.stats(),
                        "articles":[public_article(a) for a in store.articles], "custom":store.custom_status,
                        "playbooks":[{k:p.get(k) for k in ("id", "title", "stages", "keywords")} for p in store.playbooks],
                        "model_defaults":{"base_url":os.environ.get("SEPARATOR_BASE_URL", ""),
                            "model":os.environ.get("SEPARATOR_MODEL", ""), "has_env_key":bool(os.environ.get("SEPARATOR_API_KEY")),
                            "has_search_key":bool(os.environ.get("TAVILY_API_KEY"))}})
                elif path == "/api/graph":
                    self.send_data({"nodes":store.nodes, "edges":store.edges})
                elif path == "/api/universe":
                    self.send_data(custom_knowledge.universe(store))
                elif path == "/api/search":
                    q = query.get("q", [""])[0][:2000]
                    self.send_data({"results":store.search(q, query.get("stage", ["全部"])[0], 24)})
                elif path == "/api/article":
                    article = store.by_article.get(query.get("id", [""])[0])
                    if not article:
                        self.send_data({"error":"未找到知识条目。"}, 404)
                    else:
                        self.send_data(dict(public_article(article), content=article["content"]))
                elif path == "/api/sources":
                    self.send_data({"sources":store.sources})
                elif path == "/api/package":
                    self.send_data(store.portable_bundle(), content_type="application/zip", filename="separator-knowledge.zip")
                elif path == "/api/health":
                    self.send_data({"ok":True, "version":VERSION, "application":"separator-workbench"})
                elif path in ("/", "/index.html", "/app.js", "/style.css", "/favicon.svg", "/cosmos.js", "/cosmos.css", "/atlas.js", "/atlas.css"):
                    file = WEB / ("index.html" if path == "/" else path.lstrip("/"))
                    if not file.is_file():
                        self.send_data({"error":"界面文件尚未生成。"}, 404)
                    else:
                        mime = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
                        self.send_data(file.read_bytes(), content_type=mime+("; charset=utf-8" if mime.startswith("text/") or mime == "application/javascript" else ""))
                else:
                    self.send_data({"error":"此路径不在工作台开放范围内。"}, 404)
            except (ValueError, OSError, KeyError):
                self.send_data({"error":"知识文件读取失败，请检查索引格式并重新启动。"}, 500)

        def do_POST(self):
            store = snapshot[0]
            if not self.check_origin(mutation=True):
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 160000:
                    self.send_data({"error":"请求大小不符合要求。"}, 413)
                    return
                if "application/json" not in self.headers.get("Content-Type", ""):
                    self.send_data({"error":"请使用 JSON 请求。"}, 415)
                    return
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError("请求格式不正确。")
                path = urlsplit(self.path).path
                if path == "/api/reload":
                    replacement = KnowledgeStore(store.root)
                    snapshot[0] = replacement
                    self.send_data({"stats":replacement.stats()})
                elif path == "/api/custom/sync":
                    changed = payload.get("force") is True or custom_knowledge.signature(store.root) != store.custom_status["signature"]
                    if changed:
                        replacement = KnowledgeStore(store.root)
                        snapshot[0] = replacement
                        store = replacement
                    self.send_data({"changed":changed,"custom":store.custom_status,"stats":store.stats()})
                elif path == "/api/context":
                    self.send_data(store.context(payload, for_model=payload.get("mode") == "model"))
                elif path == "/api/analyze":
                    self.send_data(store.offline_analysis(payload))
                elif path == "/api/research":
                    result = search_public(payload)
                    rid = secrets.token_urlsafe(20)
                    with research_lock:
                        while len(research_cache) >= 32:
                            research_cache.pop(next(iter(research_cache)))
                        research_cache[rid] = (time.monotonic(), result['sources'])
                    self.send_data(dict(result, research_id=rid))
                elif path == "/api/dialogue":
                    rid = str(payload.get('research_id', ''))
                    with research_lock:
                        entry = research_cache.get(rid)
                    sources = entry[1] if entry and time.monotonic()-entry[0] < 1800 else []
                    result = respond(store, payload, sources)
                    if rid and not sources:
                        result['warnings'].append('外部摘录为空或已过期，本轮仅使用本地知识与对话。可重新检索。')
                    self.send_data(result)
                elif path in ("/api/model/analyze", "/api/model/test"):
                    if payload.get("allow_send") is not True:
                        self.send_data({"error":"请先确认将当前问题和检索到的知识发送到所填模型服务。"}, 400)
                        return
                    settings = settings_from(payload.get("settings", {}))
                    if path == "/api/model/test":
                        messages = [{"role":"system", "content":"回答一句简短中文。"}, {"role":"user", "content":"请仅回答：连接成功"}]
                        result = call_model(settings, messages)
                        self.send_data({"ok":True, "message":result["report"], "model":result["model"]})
                        return
                    check_outbound(payload)
                    ctx = store.context(payload, for_model=True)
                    for chunk in ctx["retrieved"]:
                        if store.by_article[chunk["article_id"]].get("origin") == "user":
                            check_outbound({"observations":chunk["text"]})
                    result = call_model(settings, ctx["messages"])
                    warnings = list(result.get("warnings", []))
                    if payload.get("two_pass"):
                        draft = result["report"]
                        review_messages = [ctx["messages"][0], {"role":"user", "content":ctx["messages"][1]["content"]+
                            "\n\n<待核查草稿>\n"+draft[:18000]+"\n</待核查草稿>\n核查草稿是否把假设当事实、混淆工艺路线、捏造数值、缺少反证或验证。输出修订后的完整分析，保留不确定性。"}]
                        try:
                            reviewed = call_model(settings, review_messages)
                            result["report"] = reviewed["report"]
                            result["review_usage"] = reviewed.get("usage", {})
                            warnings.extend(reviewed.get("warnings", []))
                        except ProviderError as exc:
                            warnings.append("复核调用未完成，以下保留第一轮结果："+str(exc))
                    result.update({"mode":"model", "context":ctx, "warnings":warnings+review_flags(result["report"])})
                    self.send_data(result)
                else:
                    self.send_data({"error":"未找到此操作。"}, 404)
            except ProviderError as exc:
                self.send_data({"error":str(exc)}, 502)
            except (ValueError, TypeError, KeyError) as exc:
                message = str(exc) if isinstance(exc, ValueError) and not isinstance(exc, json.JSONDecodeError) else "请求字段格式不正确。"
                self.send_data({"error":message[:200]}, 400)
            except Exception:
                self.send_data({"error":"处理失败。请检查知识文件完整性或重新启动工作台。"}, 500)

    return Handler


def main():
    parser = argparse.ArgumentParser(description="隔膜质量知识工作台")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", action="store_true", help="启动后打开浏览器")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("端口需在 1024 到 65535 之间")
    store = KnowledgeStore()
    token = secrets.token_urlsafe(32)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(store, token, args.port))
    server.daemon_threads = True
    print(f"Separator workbench: http://127.0.0.1:{args.port}", flush=True)
    print("Loopback only. Ctrl+C to stop.", flush=True)
    if args.open:
        threading.Timer(0.5, lambda:webbrowser.open(f"http://127.0.0.1:{args.port}")).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
