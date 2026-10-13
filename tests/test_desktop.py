from pathlib import Path
from html import unescape
import unittest


ROOT = Path(__file__).resolve().parents[1]


class DesktopLauncherTests(unittest.TestCase):
    def test_desktop_binary_and_browser_fallback_are_both_present(self):
        desktop = ROOT / "隔膜研析.exe"
        self.assertTrue(desktop.is_file())
        self.assertEqual(desktop.read_bytes()[:2], b"MZ")
        for original in ("启动工作台.cmd", "启动工作台.ps1", "start-workbench.ps1"):
            self.assertTrue((ROOT / original).is_file())

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


if __name__ == "__main__":
    unittest.main()
