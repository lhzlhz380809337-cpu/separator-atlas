# 桌面版说明

**BUILT & CURATED BY 刘鸿志**<br>
QUALITY · CONTINUOUS IMPROVEMENT · 2026

桌面版是现有本地 Web 工作台的 Windows 外壳，共用同一套知识、图谱和本地服务，不复制业务数据。同一浏览器用户配置下的模型地址及本机对话记忆会继续沿用；跨浏览器时可用页面中的“保存进度”和“载入进度”交接对话。

## 使用

1. 双击根目录的 `隔膜研析.exe`，程序会检查或启动本地知识服务，并以无地址栏窗口打开首页。
2. 关闭主窗口后，桌面启动器仍保留在 Windows 任务栏托盘。双击托盘图标可以再次打开。
3. 右键托盘图标选择“退出桌面版”，程序只停止由桌面版自己启动的服务。
4. 可运行根目录的 `start-workbench.ps1` 使用浏览器入口，或直接访问 `http://127.0.0.1:8765/#home`。

桌面窗口优先调用 Microsoft Edge，找不到 Edge 时调用 Google Chrome；两者都不可用时会退回默认浏览器。首次运行需要本机有 Python 3.10 或更新版本。当前电脑会优先复用工作环境中已经可用的 Python。

程序运行时只使用 Python 标准库，不需要安装第三方包。完整环境检查和故障排查见根目录的 `docs/环境与依赖.md`。

## 重新生成启动器

在项目根目录运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\desktop\build-desktop.ps1
```

启动器只负责本地服务生命周期、桌面窗口和托盘入口，不读取或打包原始报告。
