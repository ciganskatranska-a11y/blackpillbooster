// Blackpill Booster setup: a styled window around the silent NSIS installer.
// installer/pack.ps1 compiles this with the .NET Framework csc (C# 5 only) and appends
// the NSIS installer to the end of the exe: [stub][payload][int64 length]["BPBOOST1"].
// With /S (used by the auto-updater) it skips the window and passes all arguments through.

using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Program {
	[DllImport("user32.dll")]
	static extern bool SetProcessDPIAware();

	[STAThread]
	static int Main() {
		string arguments = RawArguments();
		if (HasFlag(arguments, "/S")) {
			try {
				return Installer.RunSilent(arguments);
			} catch (Exception error) {
				try {
					File.AppendAllText(Path.Combine(Path.GetTempPath(), "blackpill-setup.log"), DateTime.Now.ToString("s") + " " + error + Environment.NewLine);
				} catch {
				}
				return 1;
			}
		}
		try {
			SetProcessDPIAware();
		} catch {
		}
		Application.EnableVisualStyles();
		Application.SetCompatibleTextRenderingDefault(false);
		Application.Run(new SetupForm());
		return 0;
	}

	static string RawArguments() {
		string line = Environment.CommandLine.TrimStart();
		int end;
		if (line.StartsWith("\"")) {
			end = line.IndexOf('"', 1);
			end = end < 0 ? line.Length : end + 1;
		} else {
			end = line.IndexOf(' ');
			if (end < 0) end = line.Length;
		}
		return line.Substring(end).Trim();
	}

	static bool HasFlag(string arguments, string flag) {
		foreach (string token in arguments.Split(' ')) {
			if (token == flag) return true;
		}
		return false;
	}
}

static class Installer {
	const string Magic = "BPBOOST1";
	public static readonly string CableLog = Path.Combine(Path.Combine(Path.GetTempPath(), "blackpill-cable"), "install.log");

	public static string Extract(Action<float> progress) {
		string folder = Path.Combine(Path.GetTempPath(), "blackpill-setup-" + Guid.NewGuid().ToString("N").Substring(0, 8));
		Directory.CreateDirectory(folder);
		string target = Path.Combine(folder, "blackpill-booster-core.exe");
		using (FileStream input = new FileStream(Application.ExecutablePath, FileMode.Open, FileAccess.Read, FileShare.Read)) {
			byte[] trailer = new byte[16];
			input.Seek(-16, SeekOrigin.End);
			ReadFully(input, trailer);
			long length = BitConverter.ToInt64(trailer, 0);
			long start = input.Length - 16 - length;
			if (Encoding.ASCII.GetString(trailer, 8, 8) != Magic || length <= 0 || start <= 0) {
				throw new InvalidDataException("This installer is damaged. Download it again.");
			}
			input.Seek(start, SeekOrigin.Begin);
			using (FileStream output = File.Create(target)) {
				byte[] buffer = new byte[1 << 20];
				long done = 0;
				while (done < length) {
					int count = input.Read(buffer, 0, (int)Math.Min(buffer.Length, length - done));
					if (count <= 0) throw new EndOfStreamException("This installer is damaged. Download it again.");
					output.Write(buffer, 0, count);
					done += count;
					if (progress != null) progress((float)done / length);
				}
			}
		}
		return target;
	}

	static void ReadFully(Stream stream, byte[] buffer) {
		int offset = 0;
		while (offset < buffer.Length) {
			int count = stream.Read(buffer, offset, buffer.Length - offset);
			if (count <= 0) throw new EndOfStreamException();
			offset += count;
		}
	}

	// Versions up to 7.1.3 installed for all users in Program Files; returns that uninstall command.
	public static string FindMachineInstall() {
		foreach (RegistryView view in new[] { RegistryView.Registry64, RegistryView.Registry32 }) {
			using (RegistryKey hive = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view))
			using (RegistryKey root = hive.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall")) {
				if (root == null) continue;
				foreach (string name in root.GetSubKeyNames()) {
					using (RegistryKey key = root.OpenSubKey(name)) {
						if (key == null) continue;
						string display = key.GetValue("DisplayName") as string;
						if (display == null || !display.StartsWith("Blackpill Booster")) continue;
						string quiet = key.GetValue("QuietUninstallString") as string;
						if (!string.IsNullOrEmpty(quiet)) return quiet;
						string normal = key.GetValue("UninstallString") as string;
						if (!string.IsNullOrEmpty(normal)) return normal + " /S";
					}
				}
			}
		}
		return null;
	}

	public static void RemoveMachineInstall(string command) {
		string exe;
		string arguments;
		command = command.Trim();
		if (command.StartsWith("\"")) {
			int end = command.IndexOf('"', 1);
			exe = command.Substring(1, end - 1);
			arguments = command.Substring(end + 1).Trim();
		} else {
			int end = command.IndexOf(' ');
			exe = end < 0 ? command : command.Substring(0, end);
			arguments = end < 0 ? "" : command.Substring(end + 1).Trim();
		}
		if (!File.Exists(exe)) return;
		ProcessStartInfo info = new ProcessStartInfo(exe, arguments);
		info.UseShellExecute = true;
		info.Verb = "runas";
		using (Process process = Process.Start(info)) {
			process.WaitForExit();
		}
		// The NSIS uninstaller relaunches itself from %TEMP%, so wait for its registry entry to go.
		DateTime until = DateTime.Now.AddSeconds(90);
		while (FindMachineInstall() != null && DateTime.Now < until) Thread.Sleep(500);
	}

	public static int RunCore(string core, string arguments) {
		ProcessStartInfo info = new ProcessStartInfo(core, arguments);
		info.UseShellExecute = false;
		using (Process process = Process.Start(info)) {
			process.WaitForExit();
			return process.ExitCode;
		}
	}

	public static void Cleanup(string core) {
		try {
			Directory.Delete(Path.GetDirectoryName(core), true);
		} catch {
		}
	}

	public static int RunSilent(string arguments) {
		string core = Extract(null);
		try {
			string old = FindMachineInstall();
			if (old != null) {
				try {
					RemoveMachineInstall(old);
				} catch {
				}
			}
			return RunCore(core, arguments);
		} finally {
			Cleanup(core);
		}
	}
}

sealed class SetupForm : Form {
	static readonly Color Background = Color.FromArgb(0, 0, 0);
	static readonly Color Line = Color.FromArgb(42, 42, 42);
	static readonly Color Track = Color.FromArgb(18, 18, 18);
	static readonly Color Raised = Color.FromArgb(22, 22, 22);
	static readonly Color TextColor = Color.FromArgb(237, 237, 237);
	static readonly Color Muted = Color.FromArgb(138, 138, 138);
	static readonly Color Accent = Color.FromArgb(230, 220, 195);
	static readonly Color AccentHover = Color.FromArgb(245, 238, 220);
	static readonly Color Hot = Color.FromArgb(210, 31, 43);

	enum Phase { Ready, Working, Done, Failed }

	const int BaseWidth = 480;
	const int BaseHeight = 300;

	Phase phase = Phase.Ready;
	string heading = "Ready to install";
	string message = "Installs the app and the VB-CABLE audio driver it needs. Windows asks for permission once, for the driver.";
	volatile float progress;
	float shownProgress;
	volatile bool isInstalling;
	DateTime installStart;
	bool isCableShown;
	bool isHoverButton;
	bool isHoverClose;
	Rectangle buttonRect;
	Rectangle closeRect;
	readonly float scale;
	readonly Font titleFont;
	readonly Font headingFont;
	readonly Font buttonFont;
	readonly Font bodyFont;
	readonly Font smallFont;
	readonly Bitmap logo;
	readonly System.Windows.Forms.Timer timer;

	public SetupForm() {
		using (Graphics graphics = CreateGraphics()) {
			scale = graphics.DpiX / 96f;
		}
		FormBorderStyle = FormBorderStyle.None;
		StartPosition = FormStartPosition.CenterScreen;
		ClientSize = new Size(S(BaseWidth), S(BaseHeight));
		BackColor = Background;
		DoubleBuffered = true;
		Text = "Blackpill Booster Setup";
		try {
			Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
			using (Icon large = new Icon(Icon, S(48), S(48))) {
				logo = large.ToBitmap();
			}
		} catch {
			logo = null;
		}

		titleFont = PickFont(new[] { "Bahnschrift Condensed", "Bahnschrift SemiCondensed", "Arial Narrow", "Segoe UI" }, 24f, FontStyle.Bold);
		headingFont = PickFont(new[] { "Bahnschrift SemiBold Condensed", "Bahnschrift Condensed", "Arial Narrow", "Segoe UI" }, 15f, FontStyle.Bold);
		buttonFont = PickFont(new[] { "Bahnschrift SemiBold Condensed", "Bahnschrift Condensed", "Arial Narrow", "Segoe UI" }, 14f, FontStyle.Bold);
		bodyFont = PickFont(new[] { "Bahnschrift Light", "Segoe UI" }, 10f, FontStyle.Regular);
		smallFont = PickFont(new[] { "Bahnschrift Light SemiCondensed", "Bahnschrift Light", "Segoe UI" }, 9f, FontStyle.Regular);

		int margin = S(28);
		closeRect = new Rectangle(ClientSize.Width - S(44), 0, S(44), S(38));
		buttonRect = new Rectangle(margin, ClientSize.Height - margin - S(46), ClientSize.Width - margin * 2, S(46));

		timer = new System.Windows.Forms.Timer();
		timer.Interval = 16;
		timer.Tick += OnTick;
		timer.Start();
	}

	int S(float value) {
		return (int)Math.Round(value * scale);
	}

	static Font PickFont(string[] families, float size, FontStyle style) {
		foreach (string family in families) {
			Font font = new Font(family, size, style);
			if (string.Equals(font.Name, family, StringComparison.OrdinalIgnoreCase)) return font;
			font.Dispose();
		}
		return new Font(FontFamily.GenericSansSerif, size, style);
	}

	protected override CreateParams CreateParams {
		get {
			CreateParams parameters = base.CreateParams;
			parameters.ClassStyle |= 0x20000; // CS_DROPSHADOW
			parameters.Style |= 0x20000; // WS_MINIMIZEBOX, so the taskbar button can minimize
			return parameters;
		}
	}

	[DllImport("user32.dll")]
	static extern bool ReleaseCapture();

	[DllImport("user32.dll")]
	static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);

	void OnTick(object sender, EventArgs e) {
		if (isInstalling) {
			double seconds = (DateTime.Now - installStart).TotalSeconds;
			float fake = 0.12f + 0.83f * (float)(1 - Math.Exp(-seconds / 22));
			if (fake > progress) progress = fake;
			if (!isCableShown && File.Exists(Installer.CableLog)) {
				isCableShown = true;
				SetText("Setting up VB-CABLE", "Installing the audio driver. Click Yes if Windows asks for permission, and Install if it asks about device software.");
			}
		}
		float target = progress;
		if (Math.Abs(target - shownProgress) > 0.0005f) {
			shownProgress += (target - shownProgress) * 0.12f;
			Invalidate();
		}
	}

	void SetText(string newHeading, string newMessage) {
		if (InvokeRequired) {
			BeginInvoke((MethodInvoker)delegate { SetText(newHeading, newMessage); });
			return;
		}
		heading = newHeading;
		message = newMessage;
		Invalidate();
	}

	void SetPhase(Phase newPhase) {
		if (InvokeRequired) {
			BeginInvoke((MethodInvoker)delegate { SetPhase(newPhase); });
			return;
		}
		phase = newPhase;
		Cursor = Cursors.Default;
		Invalidate();
	}

	protected override void OnPaint(PaintEventArgs e) {
		Graphics graphics = e.Graphics;
		graphics.SmoothingMode = SmoothingMode.AntiAlias;
		graphics.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
		int width = ClientSize.Width;
		int margin = S(28);

		// Header
		int iconSize = S(48);
		int headerTop = S(30);
		if (logo != null) graphics.DrawImage(logo, margin, headerTop, iconSize, iconSize);
		int titleLeft = margin + iconSize + S(14);
		TextFormatFlags flags = TextFormatFlags.NoPadding | TextFormatFlags.SingleLine;
		Size first = TextRenderer.MeasureText(graphics, "BLACKPILL ", titleFont, Size.Empty, flags);
		TextRenderer.DrawText(graphics, "BLACKPILL ", titleFont, new Point(titleLeft, headerTop - S(2)), TextColor, flags);
		TextRenderer.DrawText(graphics, "BOOSTER", titleFont, new Point(titleLeft + first.Width, headerTop - S(2)), Hot, flags);
		TextRenderer.DrawText(graphics, "SETUP  ·  V" + BuildInfo.Version, smallFont, new Point(titleLeft + S(1), headerTop + first.Height + S(2)), Muted, flags);

		// Close button
		Color closeColor = phase == Phase.Working ? Line : (isHoverClose ? TextColor : Muted);
		if (isHoverClose && phase != Phase.Working) {
			using (SolidBrush brush = new SolidBrush(Hot)) graphics.FillRectangle(brush, closeRect);
		}
		using (Pen pen = new Pen(closeColor, Math.Max(1.4f, scale * 1.4f))) {
			int cx = closeRect.X + closeRect.Width / 2;
			int cy = closeRect.Y + closeRect.Height / 2;
			int arm = S(5);
			graphics.DrawLine(pen, cx - arm, cy - arm, cx + arm, cy + arm);
			graphics.DrawLine(pen, cx + arm, cy - arm, cx - arm, cy + arm);
		}

		// Divider
		int dividerY = S(104);
		using (SolidBrush brush = new SolidBrush(Line)) graphics.FillRectangle(brush, margin, dividerY, width - margin * 2, Math.Max(1, S(1)));

		// Heading + message
		int textTop = dividerY + S(18);
		Color headingColor = phase == Phase.Failed ? Hot : TextColor;
		TextRenderer.DrawText(graphics, heading.ToUpperInvariant(), headingFont, new Point(margin, textTop), headingColor, flags);
		Rectangle messageRect = new Rectangle(margin, textTop + S(28), width - margin * 2, S(60));
		TextRenderer.DrawText(graphics, message, bodyFont, messageRect, Muted, TextFormatFlags.WordBreak | TextFormatFlags.NoPadding);

		// Progress bar
		if (phase != Phase.Ready) {
			Rectangle track = new Rectangle(margin, buttonRect.Y - S(20), width - margin * 2, Math.Max(3, S(4)));
			using (SolidBrush brush = new SolidBrush(Track)) graphics.FillRectangle(brush, track);
			int fillWidth = (int)(track.Width * Math.Min(1f, Math.Max(0f, shownProgress)));
			using (SolidBrush brush = new SolidBrush(phase == Phase.Failed ? Hot : Accent)) graphics.FillRectangle(brush, track.X, track.Y, fillWidth, track.Height);
		}

		// Main button
		string label;
		Color fill;
		Color ink;
		if (phase == Phase.Working) {
			label = "INSTALLING  " + (int)Math.Round(shownProgress * 100) + "%";
			fill = Raised;
			ink = Muted;
		} else {
			label = phase == Phase.Ready ? "INSTALL" : phase == Phase.Failed ? "TRY AGAIN" : "CLOSE";
			fill = isHoverButton ? AccentHover : Accent;
			ink = Color.Black;
		}
		using (SolidBrush brush = new SolidBrush(fill)) graphics.FillRectangle(brush, buttonRect);
		TextRenderer.DrawText(graphics, label, buttonFont, buttonRect, ink, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);

		// Window border
		using (Pen pen = new Pen(Line, 1)) graphics.DrawRectangle(pen, 0, 0, width - 1, ClientSize.Height - 1);
	}

	protected override void OnMouseMove(MouseEventArgs e) {
		base.OnMouseMove(e);
		bool overButton = buttonRect.Contains(e.Location) && phase != Phase.Working;
		bool overClose = closeRect.Contains(e.Location);
		if (overButton != isHoverButton || overClose != isHoverClose) {
			isHoverButton = overButton;
			isHoverClose = overClose;
			Cursor = overButton ? Cursors.Hand : Cursors.Default;
			Invalidate();
		}
	}

	protected override void OnMouseLeave(EventArgs e) {
		base.OnMouseLeave(e);
		isHoverButton = false;
		isHoverClose = false;
		Invalidate();
	}

	protected override void OnMouseDown(MouseEventArgs e) {
		base.OnMouseDown(e);
		if (e.Button != MouseButtons.Left) return;
		if (closeRect.Contains(e.Location)) {
			if (phase != Phase.Working) Close();
			return;
		}
		if (buttonRect.Contains(e.Location)) {
			if (phase == Phase.Ready || phase == Phase.Failed) Start();
			else if (phase == Phase.Done) Close();
			return;
		}
		ReleaseCapture();
		SendMessage(Handle, 0xA1, (IntPtr)2, IntPtr.Zero); // drag the window by its body
	}

	protected override void OnFormClosing(FormClosingEventArgs e) {
		if (phase == Phase.Working && e.CloseReason == CloseReason.UserClosing) e.Cancel = true;
		base.OnFormClosing(e);
	}

	void Start() {
		phase = Phase.Working;
		progress = 0;
		shownProgress = 0;
		isCableShown = false;
		isHoverButton = false;
		Cursor = Cursors.Default;
		SetText("Unpacking", "Getting everything ready.");
		Thread worker = new Thread(Work);
		worker.IsBackground = true;
		worker.Start();
	}

	void Work() {
		string core = null;
		try {
			core = Installer.Extract(delegate(float value) { progress = value * 0.12f; });
			string old = Installer.FindMachineInstall();
			if (old != null) {
				SetText("Removing the old version", "Older versions were installed for all users. Click Yes if Windows asks, so it can be removed. New versions update without asking.");
				try {
					Installer.RemoveMachineInstall(old);
				} catch (Win32Exception) {
				}
			}
			try {
				Directory.Delete(Path.GetDirectoryName(Installer.CableLog), true);
			} catch {
			}
			SetText("Installing", "Copying Blackpill Booster. If it's open, it will restart.");
			installStart = DateTime.Now;
			isInstalling = true;
			int code = Installer.RunCore(core, "/S --force-run");
			isInstalling = false;
			if (code != 0) {
				Fail("Install failed", "The installer stopped with code " + code + ". Close Blackpill Booster if it's open, then try again.");
				return;
			}
			progress = 1;
			string cable = CableResult();
			if (cable == null) {
				SetText("Installed", "Blackpill Booster is starting. You can close this window.");
			} else {
				SetText("Installed", "Blackpill Booster is starting. " + cable);
			}
			SetPhase(Phase.Done);
		} catch (Exception error) {
			isInstalling = false;
			Fail("Install failed", error.Message);
		} finally {
			if (core != null) Installer.Cleanup(core);
		}
	}

	static string CableResult() {
		try {
			if (!File.Exists(Installer.CableLog)) return null;
			string[] lines = File.ReadAllLines(Installer.CableLog);
			string last = lines.Length > 0 ? lines[lines.Length - 1].Trim() : "";
			if (last.StartsWith("VB-CABLE is installed") || last.StartsWith("VB-CABLE is already installed") || last.Length == 0) return null;
			if (last.Contains("Restart the PC")) return "Restart your PC to finish setting up the VB-CABLE driver.";
			return "VB-CABLE was not installed (" + last.TrimEnd('.') + "). You can install it later from the app's Route tab.";
		} catch {
			return null;
		}
	}

	void Fail(string newHeading, string newMessage) {
		SetText(newHeading, newMessage);
		SetPhase(Phase.Failed);
	}
}
