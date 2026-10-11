from pathlib import Path
import io
import json
import os
import tempfile
import threading
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib import request, error
import zipfile

from app.core import ROOT, KnowledgeStore
from app.providers import call_model, endpoint, settings_from, ProviderError
from app.privacy import check_outbound
from app.server import make_handler
from tools.validate import validate
from tools.evaluate import evaluate


class KnowledgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.store = KnowledgeStore()

    def test_graph_references_conditions_and_article_paths(self):
        self.assertEqual(validate()["errors"], [])

    def test_retrieval_regressions(self):
        result = evaluate()
        failures = [r["id"] for r in result["cases"] if r["retrieval_pass"] is False]
        self.assertEqual(failures, [])

    def test_context_budget_and_provenance(self):
        for budget in (6000, 16000, 30000):
            ctx = self.store.context({"issue":"涂覆后透气增值偏高，厚度正常", "stage":"涂覆", "context_chars":budget})
            self.assertLessEqual(ctx["knowledge_chars"], budget)
            self.assertGreater(len(ctx["retrieved"]), 0)
            self.assertIn("适用", ctx["messages"][0]["content"])
            self.assertNotIn("首批文件/", json.dumps(ctx, ensure_ascii=False))
            self.assertIn("pb_coat_air_increment", [p["id"] for p in ctx["playbooks"]])

    def test_offline_hypotheses_are_not_observed_facts(self):
        with patch("app.providers.call_model", side_effect=AssertionError("No network allowed")):
            report = self.store.offline_analysis({"issue":"电芯耐压不良，穿刺合格", "stage":"电芯"})
        self.assertIn("尚未调用模型或确认根因", report["report"])
        self.assertIn("反对证据（需要核查）", report["report"])
        self.assertGreaterEqual(len(report["hypotheses"]), 3)

    def test_generic_sample_description_does_not_displace_mechanism(self):
        ctx = self.store.context({"issue":"涂覆后透气增值升高，但克重和厚度合格，应该先查什么？", "stage":"涂覆", "observations":"人工构造的练习情景，尚无现场数据。"})
        ids = [r["article_id"] for r in ctx["retrieved"]]
        self.assertIn("coat_drying", ids[:10])
        self.assertNotEqual(ids[0], "method_knowledge_governance")

    def test_failed_reload_keeps_complete_previous_state(self):
        store = KnowledgeStore()
        previous = store.stats().copy()
        with patch("app.core.read_json", side_effect=ValueError("synthetic invalid index")):
            with self.assertRaises(ValueError):
                store.reload()
        self.assertEqual(store.stats(), previous)
        self.assertTrue(store.search("陶瓷涂覆"))

    def test_bundle_allowlist_and_unlisted_file_exclusion(self):
        bundle = self.store.portable_bundle()
        with zipfile.ZipFile(io.BytesIO(bundle)) as z:
            names = z.namelist()
            self.assertIn("agent/system_prompt.md", names)
            self.assertFalse(any(n.startswith(("首批文件", "config", "private", "exports")) for n in names))
            self.assertFalse(any(n.lower().endswith((".xlsx", ".pptx", ".pdf")) for n in names))
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "knowledge").mkdir()
            (root / "knowledge/secret.md").write_text("SYNTHETIC_SECRET")
            (root / "README.md").write_text("public")
            (root / "bundle_manifest.json").write_text(json.dumps({"knowledge_files":["README.md"]}))
            isolated = KnowledgeStore(root)
            with zipfile.ZipFile(io.BytesIO(isolated.portable_bundle())) as z:
                self.assertEqual(z.namelist(), ["README.md"])

    def test_unsafe_index_and_bundle_paths_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "knowledge/x").mkdir(parents=True)
            (root / "knowledge/x/index.json").write_text(json.dumps({"articles":[{"file":"../../escape.md"}]}))
            with self.assertRaises(ValueError):
                KnowledgeStore(root)


class ProviderTests(unittest.TestCase):
    def fake(self, value, assertions=None):
        def open_request(req, timeout):
            if assertions:
                assertions(req, json.loads(req.data))
            return io.BytesIO(json.dumps(value).encode())
        return open_request

    def test_chat_payload_and_text(self):
        def inspect(req, body):
            self.assertEqual(req.full_url, "https://example.invalid/v1/chat/completions")
            self.assertEqual(req.get_header("Authorization"), "Bearer synthetic-key")
            self.assertEqual(body["messages"][1]["content"], "synthetic question")
        result = call_model({"base_url":"https://example.invalid", "model":"synthetic", "api_key":"synthetic-key"},
            [{"role":"system","content":"rules"},{"role":"user","content":"synthetic question"}],
            self.fake({"choices":[{"message":{"content":"test answer"},"finish_reason":"stop"}]}, inspect))
        self.assertEqual(result["report"], "test answer")
        self.assertEqual(result["warnings"], [])

    def test_responses_payload_and_incomplete(self):
        def inspect(req, body):
            self.assertEqual(body["instructions"], "rules")
            self.assertFalse(body["store"])
        result = call_model({"base_url":"http://127.0.0.1:1234/v1", "model":"synthetic", "protocol":"responses"},
            [{"role":"system","content":"rules"},{"role":"user","content":"question"}],
            self.fake({"output":[{"content":[{"type":"output_text","text":"partial"}]}],"status":"incomplete"}, inspect))
        self.assertTrue(result["warnings"])

    def test_chat_truncation_and_malformed_responses(self):
        settings = {"base_url":"https://example.invalid/v1", "model":"synthetic"}
        messages = [{"role":"system","content":"rules"},{"role":"user","content":"question"}]
        result = call_model(settings, messages, self.fake({"choices":[{"message":{"content":"partial"},"finish_reason":"length"}]}))
        self.assertTrue(result["warnings"])
        for data in ([], {"output":[None]}, {"output":{}}, {"output":[{"content":[None]}]}):
            with self.assertRaises(ProviderError):
                call_model(dict(settings, protocol="responses"), messages, self.fake(data))

    def test_environment_key_does_not_follow_destination_change(self):
        with patch.dict(os.environ, {"SEPARATOR_BASE_URL":"https://one.invalid/v1", "SEPARATOR_API_KEY":"synthetic-env"}):
            self.assertEqual(settings_from({"base_url":"https://one.invalid/v1"})["api_key"], "synthetic-env")
            self.assertEqual(settings_from({"base_url":"https://two.invalid/v1"})["api_key"], "")
            self.assertEqual(settings_from({"base_url":"https://one.invalid/other"})["api_key"], "")
            self.assertEqual(settings_from({"use_env_key":False})["api_key"], "")

    def test_endpoint_and_outbound_boundary(self):
        for value in ("http://remote.invalid", "https://key@remote.invalid", "https://remote.invalid?key=secret", "file:///tmp"):
            with self.assertRaises(ProviderError):
                endpoint(value)
        for issue in ("客户名称：示例企业", "原文件 demo.xlsx", "test@example.invalid", "请读 C:\\example\\file.md"):
            with self.assertRaises(ValueError):
                check_outbound({"issue":issue})
        check_outbound({"issue":"涂覆后透气增值上升，如何验证？"})

    def test_provider_error_does_not_echo_response_body(self):
        def reject(req, timeout):
            raise error.HTTPError(req.full_url, 401, "SYNTHETIC_SECRET", {}, io.BytesIO(b"SYNTHETIC_SECRET"))
        with self.assertRaises(ProviderError) as caught:
            call_model({"base_url":"https://example.invalid", "model":"synthetic"}, [{"role":"user","content":"test"}], reject)
        self.assertNotIn("SYNTHETIC_SECRET", str(caught.exception))


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = ThreadingHTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler)
        cls.port = cls.http.server_address[1]
        cls.http.RequestHandlerClass = make_handler(KnowledgeStore(), "synthetic-csrf", cls.port)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join(timeout=3)

    def send(self, path, payload=None, headers=None):
        h = {"Content-Type":"application/json", "X-Workbench-Token":"synthetic-csrf"}
        h.update(headers or {})
        data = json.dumps(payload).encode() if payload is not None else None
        req = request.Request(f"http://127.0.0.1:{self.port}"+path, data=data, headers=h)
        try:
            response = request.urlopen(req, timeout=5)
        except error.HTTPError as exc:
            response = exc
        with response:
            return response.status, response.read()

    def test_private_and_traversal_paths_are_unavailable(self):
        for path in ("/README.md", "/config/model.example.json", "/../README.md", "/%2e%2e/README.md", "/%E9%A6%96%E6%89%B9%E6%96%87%E4%BB%B6/"):
            self.assertEqual(self.send(path)[0], 404)

    def test_csrf_origin_and_host(self):
        self.assertEqual(self.send("/api/analyze", {"issue":"test"}, {"X-Workbench-Token":"wrong"})[0], 403)
        self.assertEqual(self.send("/api/bootstrap", headers={"Origin":"https://outside.invalid"})[0], 403)
        self.assertEqual(self.send("/api/bootstrap", headers={"Host":"outside.invalid"})[0], 403)

    def test_model_requires_consent_and_checks_input_before_call(self):
        with patch("app.server.call_model") as model:
            self.assertEqual(self.send("/api/model/analyze", {"issue":"test"})[0], 400)
            self.assertEqual(self.send("/api/model/analyze", {"issue":"客户名称：示例", "allow_send":True})[0], 400)
            model.assert_not_called()

    def test_offline_api_and_context_download(self):
        status, raw = self.send("/api/analyze", {"issue":"涂覆透气增值升高", "stage":"涂覆"})
        self.assertEqual(status, 200)
        data = json.loads(raw)
        self.assertEqual(data["mode"], "offline")
        self.assertIn("反对证据", data["report"])
        self.assertTrue(data["context"]["messages"])


if __name__ == "__main__":
    unittest.main()
