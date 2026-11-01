using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace WorkProof.WordNative
{
    /// <summary>
    /// Word runs this pane on its UI thread, so every Word object stays on that thread.
    /// Only counts and digests leave the machine; the collector signs the record.
    /// </summary>
    internal sealed class Recorder : Form
    {
        private const int DefaultPort = 43127;
        private const int MaxCharacters = 8000000;
        private const int HashEveryTicks = 8;
        private const int BatchLimit = 128;
        private const string Fallback = "本次操作未完成。请确认桌面端 WorkProof 正在运行、文档已保存且没有切换，然后重试。";

        private readonly dynamic word;
        private readonly HttpClient http;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };
        private readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
        private readonly Stopwatch clock = new Stopwatch();
        private readonly List<Dictionary<string, object>> pending = new List<Dictionary<string, object>>();

        private readonly Label statusText = new Label();
        private readonly Label counter = new Label();
        private readonly Button startButton = new Button();
        private readonly Button pauseButton = new Button();
        private readonly Button exportButton = new Button();
        private readonly Button cancelButton = new Button();

        private CancellationTokenSource lifetime = new CancellationTokenSource();
        private string token = string.Empty;
        private string session = string.Empty;
        private string identity = string.Empty;
        private string documentName = string.Empty;
        private Snapshot previous;
        private long sequence;
        private long lastSampleMs;
        private int generation;
        private int ticks;
        private bool paused = true;
        private bool closed;
        private bool sampling;
        private bool delivering;
        private bool acting;

        private sealed class Snapshot
        {
            public string Identity;
            public string Name;
            public long Characters;
            public int Paragraphs;
            public string Hash;
        }

        public Recorder(object application)
        {
            word = application;
            Text = "WorkProof · Word 创作记录";
            AutoScaleMode = AutoScaleMode.Font;
            Font = new Font("Microsoft YaHei UI", 9.75f, FontStyle.Regular, GraphicsUnit.Point);
            BackColor = Palette.Canvas;
            ForeColor = Palette.Ink;
            ClientSize = new Size(474, 508);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            MinimizeBox = true;
            StartPosition = FormStartPosition.CenterScreen;
            ShowIcon = false;

            http = new HttpClient(new HttpClientHandler { UseProxy = false })
            {
                BaseAddress = new Uri("http://127.0.0.1:" + EnginePort().ToString(CultureInfo.InvariantCulture)),
                Timeout = TimeSpan.FromSeconds(15)
            };

            BuildLayout();

            startButton.Click += async (sender, args) => await Run(StartRecording);
            pauseButton.Click += async (sender, args) => await Run(TogglePause);
            exportButton.Click += async (sender, args) => await Run(Export);
            cancelButton.Click += (sender, args) => { try { lifetime.Cancel(); } catch (Exception) { } };
            verifierLink.LinkClicked += (sender, args) => OpenVerifier();

            timer.Interval = 1500;
            timer.Tick += OnTick;

            FormClosing += OnClosing;
            FormClosed += OnClosed;
            PaintState();
        }

        private readonly LinkLabel verifierLink = new LinkLabel();

        // ---------------------------------------------------------------- layout

        private void BuildLayout()
        {
            var root = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 1,
                RowCount = 6,
                Padding = new Padding(22, 20, 22, 18),
                BackColor = Palette.Canvas
            };
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 122f));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100f));
            Controls.Add(root);

            root.Controls.Add(Caption("Word 创作记录", 15.5f, FontStyle.Bold, Palette.Ink, new Padding(0, 0, 0, 4)), 0, 0);
            root.Controls.Add(Caption("在 Word 里记录这份文档的创作过程，导出后与作品一起交付。", 9.75f, FontStyle.Regular, Palette.Muted, new Padding(0, 0, 0, 14)), 0, 1);

            var card = new Panel { Dock = DockStyle.Fill, BackColor = Palette.Card, Padding = new Padding(14, 12, 14, 12), Margin = new Padding(0, 0, 0, 6) };
            card.Paint += (sender, args) =>
            {
                using (var pen = new Pen(Palette.Line)) args.Graphics.DrawRectangle(pen, 0, 0, card.Width - 1, card.Height - 1);
            };
            statusText.Text = "请先保存文档，再点击开始。";
            statusText.AutoSize = false;
            statusText.Dock = DockStyle.Top;
            statusText.Height = 74;
            statusText.Font = new Font(Font.FontFamily, 10.5f, FontStyle.Bold);
            statusText.ForeColor = Palette.Ink;
            counter.Text = "尚未开始";
            counter.AutoSize = false;
            counter.Dock = DockStyle.Bottom;
            counter.Height = 22;
            counter.ForeColor = Palette.Muted;
            card.Controls.Add(statusText);
            card.Controls.Add(counter);
            root.Controls.Add(card, 0, 2);

            Style(startButton, "开始记录", true);
            Style(pauseButton, "暂停记录", false);
            Style(exportButton, "导出作品和证书", false);
            Style(cancelButton, "取消连接", false);
            cancelButton.Visible = false;

            var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, Padding = new Padding(0, 12, 0, 4), WrapContents = true };
            buttons.Controls.Add(startButton);
            buttons.Controls.Add(pauseButton);
            buttons.Controls.Add(exportButton);
            buttons.Controls.Add(cancelButton);
            root.Controls.Add(buttons, 0, 3);

            verifierLink.Text = "打开本地核验页（拖入作品和 .wproof 即可核验）";
            verifierLink.AutoSize = true;
            verifierLink.LinkColor = Palette.Accent;
            verifierLink.ActiveLinkColor = Palette.AccentDark;
            verifierLink.Padding = new Padding(0, 0, 0, 10);
            root.Controls.Add(verifierLink, 0, 4);

            root.Controls.Add(Caption(
                "只发送编辑数量、段落数、时间与保存摘要，不发送正文、剪贴板或路径。采样可能合并或遗漏修改，不能证明作者身份或原创性；关闭窗口即停止记录，未提交的操作可能丢失。",
                8.75f, FontStyle.Regular, Palette.Faint, new Padding(0)), 0, 5);
        }

        private static Label Caption(string text, float size, FontStyle style, Color color, Padding margin)
        {
            return new Label
            {
                Text = text,
                AutoSize = true,
                MaximumSize = new Size(412, 0),
                Font = new Font("Microsoft YaHei UI", size, style, GraphicsUnit.Point),
                ForeColor = color,
                Margin = margin
            };
        }

        private void Style(Button button, string text, bool primary)
        {
            button.Text = text;
            button.AutoSize = true;
            button.AutoSizeMode = AutoSizeMode.GrowAndShrink;
            button.Padding = new Padding(12, 6, 12, 6);
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderSize = 1;
            button.FlatAppearance.BorderColor = primary ? Palette.Accent : Palette.Line;
            button.BackColor = primary ? Palette.Accent : Palette.Card;
            button.ForeColor = primary ? Color.White : Palette.Ink;
            button.Margin = new Padding(0, 0, 8, 8);
            button.Cursor = Cursors.Hand;
        }

        // --------------------------------------------------------------- actions

        private async Task Run(Func<Task> action)
        {
            if (acting || closed) return;
            acting = true;
            PaintState();
            try
            {
                await action();
            }
            catch (OperationCanceledException)
            {
                Message("已取消连接或窗口已关闭。桌面端未批准的请求会自动过期。");
            }
            catch (Exception error) when (error is InvalidOperationException || error is HttpRequestException || error is TaskCanceledException)
            {
                Message(Friendly(error));
            }
            catch (Exception)
            {
                Message(Fallback);
            }
            finally
            {
                acting = false;
                PaintState();
            }
        }

        private async Task StartRecording()
        {
            if (!string.IsNullOrEmpty(session)) return;
            var opened = Read(false);
            lifetime.Dispose();
            lifetime = new CancellationTokenSource();
            cancelButton.Visible = true;
            try
            {
                Message("请在桌面端 WorkProof 核对来源“word”，再点击允许连接。");
                var request = JsonObject(await Send("POST", "/v1/native-pairing", new Dictionary<string, object> { { "source", "word" } }, false));
                var ticket = Field(request, "ticket");
                string granted = null;
                for (int attempt = 0; attempt < 100 && granted == null; attempt++)
                {
                    await Task.Delay(1000, lifetime.Token);
                    var poll = JsonObject(await Send("GET", "/v1/native-pairing/" + Uri.EscapeDataString(ticket), null, false));
                    if (poll.ContainsKey("approved") && poll["approved"] is bool && (bool)poll["approved"]) granted = Field(poll, "token");
                }
                if (granted == null) throw new InvalidOperationException("连接请求已失效或已被拒绝。请重新点击开始，并在桌面窗口点允许。");
                token = granted;

                var current = Read(false);
                if (current.Identity != opened.Identity) throw new InvalidOperationException("等待批准期间文档被切换，已停止。请切回原文档后重新开始。");
                var created = JsonObject(await Send("POST", "/v1/sessions", new Dictionary<string, object>
                {
                    { "file_name", current.Name },
                    { "started_at", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) },
                    { "source", "word" }
                }, true));
                session = Field(created, "session_id");
                if (string.IsNullOrEmpty(session)) throw new InvalidOperationException("桌面端没有返回记录编号，本次开始未完成。");
                identity = current.Identity;
                documentName = current.Name;
                previous = current;
                pending.Clear();
                sequence = 0;
                ticks = 0;
                generation++;
                clock.Restart();
                AddEvent("start", current);
                await Flush();
                paused = false;
                lastSampleMs = clock.ElapsedMilliseconds;
                timer.Start();
                Message("记录中。只发送数量与摘要，不发送正文。");
            }
            finally
            {
                cancelButton.Visible = false;
                PaintState();
            }
        }

        private async Task TogglePause()
        {
            if (closed) return;
            if (!paused)
            {
                // Flip the flag and bump the generation before any await: a hanging snapshot can no longer add events.
                paused = true;
                generation++;
                timer.Stop();
                Message("已暂停本机采样，正在保存已有操作。");
                PaintState();
                AddEvent("pause", previous);
                try
                {
                    await Flush();
                    Message("已暂停。继续记录时会标明未记录的时间。");
                }
                catch (Exception error) when (error is InvalidOperationException || error is HttpRequestException || error is TaskCanceledException)
                {
                    Message("已暂停本机采样，但还有操作未保存。" + Friendly(error));
                }
                return;
            }

            await Flush();
            var current = Read(false);
            if (current.Identity != identity) throw new InvalidOperationException("当前文档不是开始记录的那一份。请切回原文档后再继续。");
            previous = current;
            AddEvent("gap", current);
            AddEvent("resume", current);
            await Flush();
            paused = false;
            generation++;
            lastSampleMs = clock.ElapsedMilliseconds;
            timer.Start();
            Message("继续记录中。");
        }

        private async Task Export()
        {
            if (paused) throw new InvalidOperationException("请先继续记录，再导出。暂停状态下无法生成最终检查点。");
            await Sample(true);
            dynamic document = word.ActiveDocument;
            var before = Read(true);
            if (before.Identity != identity) throw new InvalidOperationException("当前文档不是记录中的那一份，已停止导出。");
            if (!File.Exists(EnginePath())) throw new InvalidOperationException("找不到随插件一起安装的记录引擎，请重新运行安装脚本。");

            string folder;
            using (var choose = new FolderBrowserDialog { Description = "选择交付目录；会在其中新建子目录，不覆盖原作品。", ShowNewFolderButton = true })
            {
                if (choose.ShowDialog(this) != DialogResult.OK) { Message("已取消导出。记录仍在继续。"); return; }
                folder = Path.Combine(choose.SelectedPath, "WorkProof-" + DateTime.Now.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture) + "-" + Guid.NewGuid().ToString("N").Substring(0, 6));
            }

            if ((bool)document.ReadOnly) throw new InvalidOperationException("文档处于只读状态，无法保存最终作品。请另存为可写副本后重新开始记录。");
            document.Save();
            var saved = Read(true);
            if (saved.Identity != before.Identity || saved.Hash != before.Hash || !(bool)document.Saved)
                throw new InvalidOperationException("保存后内容仍在变化，已停止导出。请再次保存并重试。");

            Directory.CreateDirectory(folder);
            string artifact = Path.Combine(folder, documentName);
            File.Copy(saved.Identity, artifact, false);
            var after = Read(true);
            if (after.Hash != saved.Hash || after.Identity != saved.Identity) throw new InvalidOperationException("复制作品期间文档发生变化，已停止导出。");

            var fingerprint = JsonObject(RunEngine("fingerprint \"" + artifact + "\"", 60000));
            string digest = Field(fingerprint, "hash");
            if (string.IsNullOrEmpty(digest)) throw new InvalidOperationException("记录引擎没有返回文件摘要，本次导出已中止。");
            long bytes = Convert.ToInt64(fingerprint["bytes"], CultureInfo.InvariantCulture);

            var check = Read(true);
            if (check.Hash != saved.Hash) throw new InvalidOperationException("生成摘要期间文档发生变化，已停止导出。请重新导出。");
            AddEvent("save", check, 0, 0, digest);
            await Flush();

            var exported = await Send("POST", "/v1/sessions/" + session + "/export", new Dictionary<string, object> { { "artifact_hash", digest }, { "artifact_bytes", bytes } }, true);
            var proof = JsonObject(exported);
            var manifest = proof.ContainsKey("manifest") ? proof["manifest"] as Dictionary<string, object> : null;
            if (manifest == null) throw new InvalidOperationException("记录服务没有返回可用的证书内容，本次导出已中止。");
            if (Field(manifest, "artifact_hash") != digest || Convert.ToInt64(manifest["artifact_bytes"], CultureInfo.InvariantCulture) != bytes)
                throw new InvalidOperationException("证书绑定的文件摘要与作品不一致，本次导出已中止。");

            string certificate = artifact + ".wproof";
            File.WriteAllText(certificate, exported, new UTF8Encoding(false));
            var latest = Read(true);
            if (latest.Hash != saved.Hash) throw new InvalidOperationException("导出后作品又被修改。请重新导出以生成新的证书。");

            bool verified;
            try
            {
                RunEngine("verify \"" + artifact + "\" \"" + certificate + "\"", 60000);
                verified = true;
            }
            catch (InvalidOperationException)
            {
                verified = false;
            }

            Message(verified ? "已导出，本地独立核验通过。" : "已导出，但本地独立核验未通过，请重新导出。");
            MessageBox.Show(
                "已保存到：" + folder + "\n\n作品：" + documentName + "\n证书：" + documentName + ".wproof\n\n" +
                (verified ? "本地独立核验：通过（作品与证书互相匹配）。" : "本地独立核验：未通过，请不要交付这份证书，重新导出后再试。") +
                "\n\n请把这两份文件一起交付；之后任何修改都需要重新导出。",
                "WorkProof", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        // -------------------------------------------------------------- sampling

        private async void OnTick(object sender, EventArgs args)
        {
            try
            {
                await Sample(false);
            }
            catch (Exception)
            {
                // A tick never interrupts the user; the pane already explains the paused state.
            }
        }

        private async Task Sample(bool forceHash)
        {
            if (paused || sampling || closed) return;
            sampling = true;
            int current = generation;
            try
            {
                ticks++;
                var snapshot = Read(forceHash || ticks % HashEveryTicks == 0);
                if (paused || closed || current != generation) return;
                if (snapshot.Identity != identity)
                {
                    paused = true;
                    timer.Stop();
                    Message("你把编辑对象切换到了另一份文档，记录已暂停。请切回原文档后点“继续记录”。");
                    return;
                }
                long now = clock.ElapsedMilliseconds;
                if (lastSampleMs != 0 && now - lastSampleMs > 15000) AddEvent("gap", snapshot);
                lastSampleMs = now;
                if (Changed(snapshot, previous))
                    AddEvent("edit", snapshot, Math.Max(0, snapshot.Characters - previous.Characters), Math.Max(0, previous.Characters - snapshot.Characters));
                previous = snapshot;
                await Flush();
            }
            catch (OperationCanceledException) { }
            catch (Exception error) when (error is InvalidOperationException || error is HttpRequestException || error is TaskCanceledException)
            {
                paused = true;
                timer.Stop();
                Message("本次采样未完成，记录已暂停。" + Friendly(error));
            }
            finally
            {
                sampling = false;
                PaintState();
            }
        }

        private static bool Changed(Snapshot current, Snapshot previous)
        {
            if (previous == null) return false;
            if (current.Characters != previous.Characters || current.Paragraphs != previous.Paragraphs) return true;
            return current.Hash != null && previous.Hash != null && !string.Equals(current.Hash, previous.Hash, StringComparison.Ordinal);
        }

        // ----------------------------------------------------------------- state

        private void PaintState()
        {
            if (closed) return;
            bool recording = !paused && !string.IsNullOrEmpty(session);
            startButton.Enabled = !acting && string.IsNullOrEmpty(session);
            pauseButton.Enabled = !acting && !string.IsNullOrEmpty(session) && token.Length > 0;
            pauseButton.Text = paused ? "继续记录" : "暂停记录";
            exportButton.Enabled = !acting && recording;
            cancelButton.Enabled = acting;
            counter.Text = string.IsNullOrEmpty(session)
                ? "尚未开始 · 采样间隔 1.5 秒"
                : "已保存 " + Math.Max(0, sequence - pending.Count).ToString(CultureInfo.InvariantCulture) + " 条操作 · 采样间隔 1.5 秒";
            statusText.ForeColor = recording ? Palette.AccentDark : Palette.Ink;
        }

        private void Message(string text)
        {
            if (closed) return;
            statusText.Text = text;
            PaintState();
        }

        // ------------------------------------------------------------------- io

        private Snapshot Read(bool includeHash)
        {
            if (word == null) throw new InvalidOperationException("Word 还没有完成加载。请保存文档后重新打开 Word 再试。");
            dynamic document = word.ActiveDocument;
            if (document == null) throw new InvalidOperationException("请先打开一份文档。");
            string path = (string)document.Path;
            string fullName = (string)document.FullName;
            if (string.IsNullOrEmpty(path) || string.IsNullOrEmpty(fullName))
                throw new InvalidOperationException("请先保存这份文档。未保存的文档没有可绑定的文件，也无法导出证书。");

            long characters = (int)document.Content.End;
            if (characters > MaxCharacters) throw new InvalidOperationException("文档超过 800 万字符，超出本版记录范围。请拆分文档后重试。");
            string hash = null;
            if (includeHash)
            {
                string text = (string)document.Content.Text;
                if (text.Length > MaxCharacters) throw new InvalidOperationException("文档超过 800 万字符，超出本版记录范围。请拆分文档后重试。");
                using (var sha = SHA256.Create()) hash = Hex(sha.ComputeHash(Encoding.UTF8.GetBytes(text)));
            }
            return new Snapshot
            {
                Identity = fullName,
                Name = (string)document.Name,
                Characters = characters,
                Paragraphs = (int)document.Paragraphs.Count,
                Hash = hash
            };
        }

        private void AddEvent(string kind, Snapshot snapshot, long inserted = 0, long deleted = 0, string checkpoint = "")
        {
            if (snapshot == null) throw new InvalidOperationException("还没有可记录的状态。请先保存文档后重新开始。");
            if (pending.Count >= 2048)
            {
                paused = true;
                timer.Stop();
                throw new InvalidOperationException("尚未保存的操作太多，记录已暂停。请确认桌面端 WorkProof 仍在运行，再点击继续。");
            }
            pending.Add(new Dictionary<string, object>
            {
                { "seq", sequence++ },
                { "elapsed_ms", clock.ElapsedMilliseconds },
                { "kind", kind },
                { "inserted", inserted },
                { "deleted", deleted },
                { "chars", snapshot.Characters },
                { "checkpoint", checkpoint },
                { "metrics", new Dictionary<string, long> { { "characters", snapshot.Characters }, { "paragraphs", snapshot.Paragraphs } } }
            });
            PaintState();
        }

        private async Task Flush()
        {
            if (delivering) return;
            delivering = true;
            try
            {
                while (pending.Count > 0)
                {
                    var batch = pending.GetRange(0, Math.Min(BatchLimit, pending.Count));
                    await Send("POST", "/v1/sessions/" + session + "/events", new Dictionary<string, object> { { "events", batch } }, true);
                    pending.RemoveRange(0, batch.Count);
                    PaintState();
                }
            }
            finally
            {
                delivering = false;
            }
        }

        private async Task<string> Send(string method, string path, object body, bool authorized)
        {
            using (var request = new HttpRequestMessage(new HttpMethod(method), path))
            {
                if (authorized) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                if (body != null) request.Content = new StringContent(json.Serialize(body), new UTF8Encoding(false), "application/json");
                using (var response = await http.SendAsync(request, lifetime.Token))
                {
                    string raw = await response.Content.ReadAsStringAsync();
                    if (raw.Length > 4 * 1024 * 1024) throw new InvalidOperationException("记录服务的响应异常，请重新打开 Word 加载项后再试。");
                    if (!response.IsSuccessStatusCode)
                    {
                        string code = string.Empty;
                        try { code = Field(JsonObject(raw), "error"); } catch (Exception) { }
                        if (code == "PAIRING_REQUIRED" || ((int)response.StatusCode == 401 || (int)response.StatusCode == 403) && string.IsNullOrEmpty(code))
                        {
                            token = string.Empty;
                            paused = true;
                            timer.Stop();
                            throw new InvalidOperationException("连接已被撤销或过期，记录已暂停。请重新点击开始并在桌面端允许。已有记录保留。");
                        }
                        throw new InvalidOperationException(Describe(code));
                    }
                    return raw;
                }
            }
        }

        private static string Describe(string code)
        {
            switch (code)
            {
                case "PAIRING_REQUIRED": return "连接已被撤销或过期。请重新点击开始并在桌面端允许。";
                case "PAIRING_EXPIRED": return "连接请求已失效。请重新点击开始，并在桌面窗口允许连接。";
                case "PAIRING_LIMIT": return "待确认的连接太多。请先在桌面窗口处理已有请求，再重试。";
                case "PAIRING_CHANNEL_MISMATCH": return "连接来源不一致。请关闭本窗口后重新打开加载项。";
                case "SAVE_CHECKPOINT_REQUIRED": return "本次保存尚未记录完成，请再次导出。";
                case "SEQUENCE_CONFLICT": return "记录未能按原顺序保存。请暂停并开始一份新记录。";
                case "ADAPTER_SESSION_DENIED": return "这份记录不属于当前连接。请重新打开加载项并开始新记录。";
                case "UNSUPPORTED_NATIVE_ADAPTER": return "桌面端版本过旧，不支持 Word 原生连接。请更新 WorkProof 后再试。";
                case "INVALID_ARTIFACT_HASH": return "作品摘要格式不正确，请重新导出。";
                default: return "记录服务没有完成本次操作。请确认桌面端 WorkProof 仍在运行后重试。";
            }
        }

        private string Friendly(Exception error)
        {
            if (error is HttpRequestException || error is TaskCanceledException)
                return "连不上桌面端 WorkProof（127.0.0.1:" + EnginePort().ToString(CultureInfo.InvariantCulture) + "）。请先打开 WorkProof 桌面程序再试。";
            return string.IsNullOrWhiteSpace(error.Message) ? Fallback : error.Message;
        }

        private static Dictionary<string, object> JsonObject(string raw)
        {
            var value = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 }.DeserializeObject(raw) as Dictionary<string, object>;
            if (value == null) throw new InvalidOperationException("记录服务返回了无法识别的内容。请更新 WorkProof 后重试。");
            return value;
        }

        private static string Field(Dictionary<string, object> source, string name)
        {
            object value;
            return source != null && source.TryGetValue(name, out value) && value is string ? (string)value : string.Empty;
        }

        private static string Hex(byte[] bytes)
        {
            return BitConverter.ToString(bytes).Replace("-", string.Empty).ToLowerInvariant();
        }

        private static string EnginePath()
        {
            string location = typeof(Recorder).Assembly.Location;
            string directory = string.IsNullOrEmpty(location) ? string.Empty : Path.GetDirectoryName(location);
            return Path.Combine(directory ?? string.Empty, "workproof-engine.exe");
        }

        private static int EnginePort()
        {
            int port;
            string configured = Environment.GetEnvironmentVariable("WORKPROOF_ENGINE_PORT");
            return int.TryParse(configured, NumberStyles.Integer, CultureInfo.InvariantCulture, out port) && port > 0 && port < 65536 ? port : DefaultPort;
        }

        private static string RunEngine(string arguments, int timeoutMilliseconds)
        {
            var start = new ProcessStartInfo(EnginePath(), arguments)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            using (var process = new Process { StartInfo = start })
            {
                process.Start();
                var output = process.StandardOutput.ReadToEndAsync();
                var error = process.StandardError.ReadToEndAsync();
                if (!process.WaitForExit(timeoutMilliseconds))
                {
                    try { process.Kill(); } catch (Exception) { }
                    throw new InvalidOperationException("记录引擎没有在预期时间内返回，本次操作已中止。");
                }
                process.WaitForExit();
                string stdout = output.GetAwaiter().GetResult();
                string stderr = error.GetAwaiter().GetResult();
                if (process.ExitCode != 0) throw new InvalidOperationException(string.IsNullOrWhiteSpace(stderr) ? "记录引擎未能完成本次操作。" : "记录引擎报错：" + stderr.Trim());
                return stdout;
            }
        }

        private void OpenVerifier()
        {
            try
            {
                Process.Start(new ProcessStartInfo("http://127.0.0.1:4173/") { UseShellExecute = true });
            }
            catch (Exception)
            {
                Message("没能打开核验页。请先打开桌面端 WorkProof，它会在本机提供核验页面。");
            }
        }

        // ------------------------------------------------------------- lifecycle

        private void OnClosing(object sender, FormClosingEventArgs args)
        {
            if (!paused && !string.IsNullOrEmpty(session))
            {
                var answer = MessageBox.Show("窗口关闭后会停止记录，尚未保存的操作可能丢失。要先暂停再关闭吗？", "WorkProof",
                    MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question);
                if (answer == DialogResult.Cancel) { args.Cancel = true; return; }
                if (answer == DialogResult.Yes)
                {
                    args.Cancel = true;
                    var pause = Run(TogglePause);
                    pause.ContinueWith(_ => { try { BeginInvoke(new Action(Close)); } catch (Exception) { } });
                    return;
                }
            }
            closed = true;
            timer.Stop();
            try { lifetime.Cancel(); } catch (Exception) { }
        }

        private void OnClosed(object sender, FormClosedEventArgs args)
        {
            closed = true;
            timer.Stop();
            timer.Dispose();
            try { lifetime.Cancel(); } catch (Exception) { }
            http.Dispose();
        }
    }

    internal static class Palette
    {
        public static readonly Color Canvas = Color.FromArgb(246, 248, 247);
        public static readonly Color Card = Color.FromArgb(255, 255, 255);
        public static readonly Color Line = Color.FromArgb(219, 227, 223);
        public static readonly Color Ink = Color.FromArgb(26, 36, 33);
        public static readonly Color Muted = Color.FromArgb(92, 107, 102);
        public static readonly Color Faint = Color.FromArgb(124, 138, 133);
        public static readonly Color Accent = Color.FromArgb(31, 111, 92);
        public static readonly Color AccentDark = Color.FromArgb(21, 84, 69);
    }
}
