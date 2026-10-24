from pathlib import Path
from html import unescape
import unittest


ROOT = Path(__file__).resolve().parents[1]


class DesktopLauncherTests(unittest.TestCase):
    def test_desktop_binary_and_available_browser_fallback_are_present(self):
        desktop = ROOT / "隔膜研析.exe"
        self.assertTrue(desktop.is_file())
        self.assertEqual(desktop.read_bytes()[:2], b"MZ")
        browser = ROOT / "start-workbench.ps1"
        self.assertTrue(browser.is_file())
        self.assertIn("http://127.0.0.1:8765", browser.read_text(encoding="utf-8"))
        for legacy in ("启动工作台.cmd", "启动工作台.ps1"):
            if (ROOT / legacy).exists():
                self.assertTrue((ROOT / legacy).is_file())

    def test_launcher_is_loopback_only_and_keeps_owned_process_boundary(self):
        source = (ROOT / "desktop" / "SeparatorAtlasLauncher.cs").read_text(encoding="utf-8")
        self.assertIn("http://127.0.0.1:", source)
        self.assertIn("--app=", source)
        self.assertIn("NotifyIcon", source)
        self.assertIn("ownsServer", source)
        self.assertNotIn("0.0.0.0", source)
        self.assertNotIn("首批文件", source)

    def test_project_credit_is_consistent_across_desktop_web_and_readme(self):
        signature = "BUILT & CURATED BY 刘鸿志"
        for relative in (
            "desktop/SeparatorAtlasLauncher.cs",
            "app/web/dist/index.html",
            "README.md",
            "desktop/README.md",
        ):
            self.assertIn(signature, unescape((ROOT / relative).read_text(encoding="utf-8")))
        self.assertIn("QUALITY · CONTINUOUS IMPROVEMENT · 2026", (ROOT / "app/web/dist/index.html").read_text(encoding="utf-8"))

    def test_environment_requirements_are_explicit(self):
        runtime = (ROOT / "requirements.txt").read_text(encoding="utf-8")
        development = (ROOT / "requirements-dev.txt").read_text(encoding="utf-8")
        guide = (ROOT / "docs" / "环境与依赖.md").read_text(encoding="utf-8")
        self.assertIn("standard library", runtime)
        self.assertIn("Pillow", development)
        self.assertIn("Python 3.10", guide)
        self.assertIn("DeepSeek", guide)

    def test_nebula_dialogue_and_fta_controls_are_present(self):
        page = (ROOT / "app" / "web" / "dist" / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "app" / "web" / "dist" / "cosmos.js").read_text(encoding="utf-8")
        self.assertIn("与星云对话", page)
        self.assertIn('id="cosmic-mode-label">模型<', page)
        self.assertIn('id="fta-dialog"', page)
        self.assertIn('id="fta-viewport"', page)
        self.assertIn('id="fta-detail"', page)
        self.assertIn('id="fta-maximize"', page)
        self.assertIn("保存可载入 Markdown", page)
        self.assertIn("继续深入分析", script)
        self.assertIn("function fitFta", script)
        self.assertIn("addEventListener('wheel'", script)
        self.assertIn("对此问题选择另外选项", script)
        self.assertIn('id="fta-detail-previous"', page)
        self.assertIn('id="fta-detail-question"', page)
        self.assertIn("sessions.deleteFta", script)


if __name__ == "__main__":
    unittest.main()
