using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("隔膜研析")]
[assembly: AssemblyDescription("隔膜质量知识工作台")]
[assembly: AssemblyCompany("刘鸿志")]
[assembly: AssemblyProduct("隔膜研析 · 质量知识工作台")]
[assembly: AssemblyCopyright("BUILT & CURATED BY 刘鸿志 · 2026")]
[assembly: AssemblyVersion("0.4.0.0")]
[assembly: AssemblyFileVersion("0.4.0.0")]

namespace SeparatorAtlasDesktop
{
    internal static class Program
    {
        private const string MutexName = "Local\\SeparatorAtlasDesktopLauncher";

        [STAThread]
        private static void Main(string[] args)
        {
            string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            string selfTestPath = ReadSelfTestPath(args);
            if (!String.IsNullOrEmpty(selfTestPath))
            {
                DesktopContext.WriteSelfTest(root, selfTestPath);
                return;
            }

            bool createdNew;
            using (Mutex instanceMutex = new Mutex(true, MutexName, out createdNew))
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                if (!createdNew)
                {
                    DesktopContext.OpenExistingWindow(root);
                    return;
                }
                Application.Run(new DesktopContext(root));
            }
        }

        private static string ReadSelfTestPath(string[] args)
        {
            foreach (string arg in args)
            {
                if (arg.StartsWith("--self-test=", StringComparison.OrdinalIgnoreCase))
                    return arg.Substring("--self-test=".Length).Trim('"');
            }
            return null;
        }
    }

    internal sealed class DesktopContext : ApplicationContext
    {
        private const int PreferredPort = 8765;
        private readonly string root;
        private readonly Form splash;
        private readonly Label statusLabel;
        private readonly NotifyIcon tray;
        private Process serverProcess;
        private bool ownsServer;
        private int port;
        private string url;

        internal DesktopContext(string rootDirectory)
        {
            root = rootDirectory;
            splash = BuildSplash(out statusLabel);
            tray = BuildTray();
            splash.Show();
            Thread startup = new Thread(StartWorkbench);
            startup.IsBackground = true;
            startup.Name = "SeparatorAtlasStartup";
            startup.Start();
        }

        private Form BuildSplash(out Label state)
        {
            Form form = new Form();
            form.Text = "隔膜研析";
            form.FormBorderStyle = FormBorderStyle.None;
            form.StartPosition = FormStartPosition.CenterScreen;
            form.ClientSize = new Size(500, 280);
            form.BackColor = Color.FromArgb(7, 20, 35);
            form.ShowInTaskbar = true;
            form.TopMost = true;

            PictureBox mark = new PictureBox();
            mark.Size = new Size(56, 56);
            mark.Location = new Point(42, 38);
            mark.SizeMode = PictureBoxSizeMode.StretchImage;
            Icon icon = TryApplicationIcon();
            if (icon != null) mark.Image = icon.ToBitmap();
            form.Controls.Add(mark);

            Label name = new Label();
            name.AutoSize = true;
            name.Location = new Point(112, 38);
            name.Font = new Font("Microsoft YaHei UI", 21F, FontStyle.Bold);
            name.ForeColor = Color.FromArgb(230, 246, 250);
            name.Text = "隔膜研析";
            form.Controls.Add(name);

            Label subtitle = new Label();
            subtitle.AutoSize = true;
            subtitle.Location = new Point(115, 80);
            subtitle.Font = new Font("Segoe UI", 8F, FontStyle.Regular);
            subtitle.ForeColor = Color.FromArgb(86, 175, 188);
            subtitle.Text = "SEPARATOR KNOWLEDGE UNIVERSE";
            form.Controls.Add(subtitle);

            Label line = new Label();
            line.Location = new Point(42, 126);
            line.Size = new Size(416, 1);
            line.BackColor = Color.FromArgb(28, 67, 84);
            form.Controls.Add(line);

            state = new Label();
            state.AutoSize = false;
            state.Location = new Point(42, 154);
            state.Size = new Size(416, 36);
            state.Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Regular);
            state.ForeColor = Color.FromArgb(181, 211, 220);
            state.Text = "正在连接本地知识库…";
            form.Controls.Add(state);

            ProgressBar progress = new ProgressBar();
            progress.Location = new Point(42, 205);
            progress.Size = new Size(416, 4);
            progress.Style = ProgressBarStyle.Marquee;
            progress.MarqueeAnimationSpeed = 28;
            form.Controls.Add(progress);

            Label credit = new Label();
            credit.AutoSize = true;
            credit.Location = new Point(42, 225);
            credit.Font = new Font("Segoe UI", 8F, FontStyle.Bold);
            credit.ForeColor = Color.FromArgb(119, 166, 179);
            credit.Text = "BUILT & CURATED BY 刘鸿志";
            form.Controls.Add(credit);

            Label role = new Label();
            role.AutoSize = true;
            role.Location = new Point(42, 246);
            role.Font = new Font("Segoe UI", 7F, FontStyle.Regular);
            role.ForeColor = Color.FromArgb(70, 104, 122);
            role.Text = "QUALITY · CONTINUOUS IMPROVEMENT · 2026";
            form.Controls.Add(role);
            return form;
        }

        private NotifyIcon BuildTray()
        {
            ContextMenuStrip menu = new ContextMenuStrip();
            ToolStripMenuItem open = new ToolStripMenuItem("打开隔膜研析");
            open.Font = new Font(open.Font, FontStyle.Bold);
            open.Click += delegate { OpenDesktopWindow(url); };
            ToolStripMenuItem browser = new ToolStripMenuItem("在浏览器中打开");
            browser.Click += delegate { OpenDefaultBrowser(url); };
            ToolStripMenuItem exit = new ToolStripMenuItem("退出桌面版");
            exit.Click += delegate { ExitDesktop(); };
            menu.Items.Add(open);
            menu.Items.Add(browser);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(exit);

            NotifyIcon icon = new NotifyIcon();
            icon.Icon = TryApplicationIcon() ?? SystemIcons.Application;
            icon.Text = "隔膜研析 · 本地知识工作台";
            icon.ContextMenuStrip = menu;
            icon.DoubleClick += delegate { OpenDesktopWindow(url); };
            return icon;
        }

        private void StartWorkbench()
        {
            try
            {
                string serverScript = Path.Combine(root, "app", "server.py");
                if (!File.Exists(serverScript))
                    throw new FileNotFoundException("未找到 app\\server.py，请确认桌面程序位于工作台根目录。", serverScript);

                port = ChoosePort();
                url = "http://127.0.0.1:" + port + "/#home";
                if (!IsHealthy(port))
                {
                    SetStatus("正在启动知识服务…");
                    serverProcess = StartServer(root, port);
                    ownsServer = true;
                    WaitForHealth(port, serverProcess);
                }
                SetStatus("知识已经连接，正在打开星图…");
                splash.BeginInvoke(new MethodInvoker(Ready));
            }
            catch (Exception ex)
            {
                splash.BeginInvoke(new MethodInvoker(delegate { StartupFailed(ex); }));
            }
        }

        private void Ready()
        {
            SaveActivePort(port);
            tray.Visible = true;
            splash.Hide();
            OpenDesktopWindow(url);
            tray.ShowBalloonTip(1800, "隔膜研析已启动", "关闭窗口后仍可从任务栏托盘再次打开。", ToolTipIcon.Info);
        }

        private void StartupFailed(Exception ex)
        {
            splash.Hide();
            StopOwnedServer();
            MessageBox.Show(ex.Message + "\r\n\r\n原来的“启动工作台.cmd”仍可继续使用。", "隔膜研析未能启动", MessageBoxButtons.OK, MessageBoxIcon.Error);
            tray.Dispose();
            ExitThread();
        }

        private void SetStatus(string text)
        {
            if (statusLabel.IsHandleCreated)
                statusLabel.BeginInvoke(new MethodInvoker(delegate { statusLabel.Text = text; }));
        }

        private int ChoosePort()
        {
            if (IsHealthy(PreferredPort) || IsPortFree(PreferredPort)) return PreferredPort;
            for (int candidate = PreferredPort + 1; candidate <= PreferredPort + 10; candidate++)
            {
                if (IsPortFree(candidate)) return candidate;
            }
            throw new InvalidOperationException("本机 8765—8775 端口均不可用，请关闭占用端口的程序后重试。");
        }

        private static bool IsPortFree(int candidate)
        {
            TcpListener listener = null;
            try
            {
                listener = new TcpListener(IPAddress.Loopback, candidate);
                listener.Start();
                return true;
            }
            catch (SocketException)
            {
                return false;
            }
            finally
            {
                if (listener != null) listener.Stop();
            }
        }

        private static bool IsHealthy(int candidate)
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + candidate + "/api/health");
                request.Timeout = 900;
                request.ReadWriteTimeout = 900;
                request.Proxy = null;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
                {
                    string body = reader.ReadToEnd();
                    return response.StatusCode == HttpStatusCode.OK && body.Contains("separator-workbench") && body.Contains("\"ok\": true");
                }
            }
            catch
            {
                return false;
            }
        }

        private static void WaitForHealth(int candidate, Process child)
        {
            for (int attempt = 0; attempt < 80; attempt++)
            {
                if (IsHealthy(candidate)) return;
                if (child != null && child.HasExited)
                    throw new InvalidOperationException("本地知识服务提前停止。请用原启动方式查看详细提示，或检查 Python 环境。");
                Thread.Sleep(250);
            }
            throw new TimeoutException("本地知识服务启动超时。请检查知识文件完整性与 Python 状态。");
        }

        private static Process StartServer(string rootDirectory, int candidate)
        {
            string python = FindPython(rootDirectory);
            if (python == null)
                throw new FileNotFoundException("没有找到可用的 Python。请安装 Python 3.10 或更新版本，或继续使用当前电脑上的原启动方式。");
            string filename = Path.GetFileName(python).ToLowerInvariant();
            string prefix = (filename == "py.exe" || filename == "pyw.exe") ? "-3 " : "";
            string script = Path.Combine(rootDirectory, "app", "server.py");
            ProcessStartInfo start = new ProcessStartInfo();
            start.FileName = python;
            start.Arguments = prefix + "-X utf8 \"" + script + "\" --port " + candidate;
            start.WorkingDirectory = rootDirectory;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WindowStyle = ProcessWindowStyle.Hidden;
            Process process = Process.Start(start);
            if (process == null) throw new InvalidOperationException("无法创建本地知识服务进程。");
            return process;
        }

        private static string FindPython(string rootDirectory)
        {
            string profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            List<string> candidates = new List<string>();
            candidates.Add(Path.Combine(rootDirectory, "runtime", "python", "pythonw.exe"));
            candidates.Add(Path.Combine(rootDirectory, "runtime", "python", "python.exe"));
            candidates.Add(Path.Combine(profile, ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "pythonw.exe"));
            candidates.Add(Path.Combine(profile, ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe"));
            AddLocalPythonCandidates(candidates);
            candidates.Add(ResolveFromPath("pythonw.exe"));
            candidates.Add(ResolveFromPath("pyw.exe"));
            candidates.Add(ResolveFromPath("python.exe"));
            candidates.Add(ResolveFromPath("py.exe"));
            foreach (string path in candidates)
            {
                if (!String.IsNullOrEmpty(path) && File.Exists(path)) return path;
            }
            return null;
        }

        private static void AddLocalPythonCandidates(List<string> candidates)
        {
            try
            {
                string baseDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Python");
                if (!Directory.Exists(baseDirectory)) return;
                string[] directories = Directory.GetDirectories(baseDirectory, "Python*");
                Array.Sort(directories, StringComparer.OrdinalIgnoreCase);
                Array.Reverse(directories);
                foreach (string directory in directories)
                {
                    candidates.Add(Path.Combine(directory, "pythonw.exe"));
                    candidates.Add(Path.Combine(directory, "python.exe"));
                }
            }
            catch { }
        }

        private static string ResolveFromPath(string executable)
        {
            string pathValue = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string part in pathValue.Split(Path.PathSeparator))
            {
                try
                {
                    string directory = part.Trim().Trim('"');
                    if (directory.Length == 0) continue;
                    string candidate = Path.Combine(directory, executable);
                    if (File.Exists(candidate)) return candidate;
                }
                catch { }
            }
            return null;
        }

        private static string FindAppBrowser()
        {
            List<string> candidates = new List<string>();
            string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string pf64 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            candidates.Add(Path.Combine(pf86, "Microsoft", "Edge", "Application", "msedge.exe"));
            candidates.Add(Path.Combine(pf64, "Microsoft", "Edge", "Application", "msedge.exe"));
            candidates.Add(Path.Combine(local, "Microsoft", "Edge", "Application", "msedge.exe"));
            candidates.Add(Path.Combine(pf64, "Google", "Chrome", "Application", "chrome.exe"));
            candidates.Add(Path.Combine(pf86, "Google", "Chrome", "Application", "chrome.exe"));
            candidates.Add(Path.Combine(local, "Google", "Chrome", "Application", "chrome.exe"));
            candidates.Add(ResolveFromPath("msedge.exe"));
            candidates.Add(ResolveFromPath("chrome.exe"));
            foreach (string path in candidates)
            {
                if (!String.IsNullOrEmpty(path) && File.Exists(path)) return path;
            }
            return null;
        }

        private static void OpenDesktopWindow(string targetUrl)
        {
            if (String.IsNullOrEmpty(targetUrl)) return;
            try
            {
                string browser = FindAppBrowser();
                if (browser == null)
                {
                    OpenDefaultBrowser(targetUrl);
                    return;
                }
                ProcessStartInfo start = new ProcessStartInfo();
                start.FileName = browser;
                start.Arguments = "--app=\"" + targetUrl + "\" --no-first-run --disable-session-crashed-bubble --window-size=1500,960";
                start.UseShellExecute = true;
                Process.Start(start);
            }
            catch (Exception ex)
            {
                MessageBox.Show("桌面窗口打开失败：" + ex.Message + "\r\n将尝试使用默认浏览器。", "隔膜研析", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                OpenDefaultBrowser(targetUrl);
            }
        }

        private static void OpenDefaultBrowser(string targetUrl)
        {
            if (String.IsNullOrEmpty(targetUrl)) return;
            ProcessStartInfo start = new ProcessStartInfo();
            start.FileName = targetUrl;
            start.UseShellExecute = true;
            Process.Start(start);
        }

        internal static void OpenExistingWindow(string rootDirectory)
        {
            int candidate = ReadActivePort();
            if (!IsHealthy(candidate))
            {
                MessageBox.Show("桌面版正在启动，请稍后再试。原浏览器入口仍可正常使用。", "隔膜研析", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            OpenDesktopWindow("http://127.0.0.1:" + candidate + "/#home");
        }

        private void ExitDesktop()
        {
            tray.Visible = false;
            ClearActivePort(port);
            StopOwnedServer();
            tray.Dispose();
            splash.Dispose();
            ExitThread();
        }

        private void StopOwnedServer()
        {
            if (!ownsServer || serverProcess == null) return;
            try
            {
                if (!serverProcess.HasExited) serverProcess.Kill();
                serverProcess.WaitForExit(2500);
            }
            catch { }
            finally
            {
                serverProcess.Dispose();
                serverProcess = null;
                ownsServer = false;
            }
        }

        protected override void ExitThreadCore()
        {
            tray.Visible = false;
            StopOwnedServer();
            base.ExitThreadCore();
        }

        private static Icon TryApplicationIcon()
        {
            try { return Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
            catch { return null; }
        }

        private static string PortStateFile()
        {
            string directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SeparatorAtlas");
            Directory.CreateDirectory(directory);
            return Path.Combine(directory, "desktop-port.txt");
        }

        private static void SaveActivePort(int activePort)
        {
            try { File.WriteAllText(PortStateFile(), activePort.ToString(), Encoding.ASCII); }
            catch { }
        }

        private static int ReadActivePort()
        {
            try
            {
                int activePort;
                if (Int32.TryParse(File.ReadAllText(PortStateFile(), Encoding.ASCII).Trim(), out activePort) && activePort >= 1024 && activePort <= 65535)
                    return activePort;
            }
            catch { }
            return PreferredPort;
        }

        private static void ClearActivePort(int activePort)
        {
            try
            {
                string stateFile = PortStateFile();
                int recorded;
                if (File.Exists(stateFile) && Int32.TryParse(File.ReadAllText(stateFile, Encoding.ASCII).Trim(), out recorded) && recorded == activePort)
                    File.Delete(stateFile);
            }
            catch { }
        }

        internal static void WriteSelfTest(string rootDirectory, string outputPath)
        {
            try
            {
                string fullPath = Path.GetFullPath(outputPath);
                string parent = Path.GetDirectoryName(fullPath);
                if (!String.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                string python = FindPython(rootDirectory);
                string browser = FindAppBrowser();
                bool serverExists = File.Exists(Path.Combine(rootDirectory, "app", "server.py"));
                bool webExists = File.Exists(Path.Combine(rootDirectory, "app", "web", "dist", "index.html"));
                string json = "{\r\n" +
                    "  \"ok\": " + JsonBool(serverExists && webExists && python != null && browser != null) + ",\r\n" +
                    "  \"server_file\": " + JsonBool(serverExists) + ",\r\n" +
                    "  \"web_file\": " + JsonBool(webExists) + ",\r\n" +
                    "  \"python\": \"" + JsonEscape(python ?? "") + "\",\r\n" +
                    "  \"app_browser\": \"" + JsonEscape(browser ?? "") + "\",\r\n" +
                    "  \"existing_service\": " + JsonBool(IsHealthy(PreferredPort)) + "\r\n" +
                    "}\r\n";
                File.WriteAllText(fullPath, json, new UTF8Encoding(false));
            }
            catch (Exception ex)
            {
                try { File.WriteAllText(outputPath, "{\"ok\":false,\"error\":\"" + JsonEscape(ex.Message) + "\"}", new UTF8Encoding(false)); }
                catch { }
            }
        }

        private static string JsonBool(bool value) { return value ? "true" : "false"; }

        private static string JsonEscape(string value)
        {
            return value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
        }
    }
}
