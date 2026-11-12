// Blackpill Booster setup + uninstaller: styled windows around the silent NSIS installer/uninstaller.
// installer/pack.ps1 compiles this with the .NET Framework csc (C# 5 only).
//
// Setup:       [this exe][NSIS installer][int64 length]["BPBOOST1"]  -> Blackpill-Booster-Setup.exe
// Uninstaller: this exe with no payload, installed as "Blackpill Booster Uninstaller.exe";
//              installer.nsh points the Windows "Uninstall" entry at it.
// With /S (auto-updater, or the NSIS upgrade step) no window is shown: setup passes the arguments to
// the embedded installer, the uninstaller passes them to the real NSIS uninstaller in the install folder.

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
		bool isUninstaller = !Installer.HasPayload();
		if (HasFlag(arguments, "/S") && !isUninstaller && HasFlag(arguments, "--updated")) {
			// Auto-update: same silent install, but with a small progress window so it isn't a blank wait.
			try {
				PrepareUi();
				return RunForm(new SetupForm(false, null, arguments));
			} catch (Exception error) {
				Log(error);
			}
		}
		if (HasFlag(arguments, "/S")) {
			try {
				return isUninstaller ? Uninstaller.RunSilent(arguments) : Installer.RunSilent(arguments);
			} catch (Exception error) {
				Log(error);
				return 1;
			}
		}

		string installDir = null;
		if (isUninstaller) {
			installDir = DirArgument();
			if (installDir == null) {
				// Run from a temp copy so the install folder (and this exe) can be deleted.
				try {
					Uninstaller.Relaunch();
					return 0;
				} catch (Exception error) {
					Log(error);
					installDir = Path.GetDirectoryName(Application.ExecutablePath);
				}
			}
		}

		PrepareUi();
		return RunForm(new SetupForm(isUninstaller, installDir, null));
	}

	static bool isUiReady;

	static int RunForm(SetupForm form) {
		Application.Run(form);
		return form.ExitCode;
	}

	public static void PrepareUi() {
		if (isUiReady) return;
		isUiReady = true;
		try {
			SetProcessDPIAware();
		} catch {
		}
		Application.EnableVisualStyles();
		Application.SetCompatibleTextRenderingDefault(false);
	}

	public static void Log(Exception error) {
		try {
			File.AppendAllText(Path.Combine(Path.GetTempPath(), "blackpill-setup.log"), DateTime.Now.ToString("s") + " " + error + Environment.NewLine);
		} catch {
		}
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

	static string DirArgument() {
		foreach (string argument in Environment.GetCommandLineArgs()) {
			if (argument.StartsWith("--dir=")) return argument.Substring(6).TrimEnd('\\');
		}
		return null;
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

	public static bool HasPayload() {
		try {
			using (FileStream input = new FileStream(Application.ExecutablePath, FileMode.Open, FileAccess.Read, FileShare.Read)) {
				if (input.Length < 16) return false;
				byte[] trailer = new byte[8];
				input.Seek(-8, SeekOrigin.End);
				ReadFully(input, trailer);
				return Encoding.ASCII.GetString(trailer) == Magic;
			}
		} catch {
			return false;
		}
	}

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

	public static int Run(string exe, string arguments) {
		ProcessStartInfo info = new ProcessStartInfo(exe, arguments);
		info.UseShellExecute = false;
		using (Process process = Process.Start(info)) {
			process.WaitForExit();
			return process.ExitCode;
		}
	}

	// Deletes this run's temp folder, and any left by earlier runs (antivirus can hold the exe briefly).
	public static void Cleanup(string core) {
		string own = Path.GetDirectoryName(core);
		for (int attempt = 0; attempt < 10 && Directory.Exists(own); attempt++) {
			try {
				Directory.Delete(own, true);
			} catch {
				Thread.Sleep(300);
			}
		}
		try {
			foreach (string stale in Directory.GetDirectories(Path.GetTempPath(), "blackpill-setup-*")) {
				try {
					if (Directory.GetCreationTime(stale) < DateTime.Now.AddMinutes(-10)) Directory.Delete(stale, true);
				} catch {
				}
			}
		} catch {
		}
	}

	// The NSIS upgrade step runs whatever UninstallString names. Point it back at the real NSIS
	// uninstaller first (installer.nsh re-points it at the styled one when the install finishes).
	public static void ResetUninstallString() {
		try {
			using (RegistryKey root = Registry.CurrentUser.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", true)) {
				if (root == null) return;
				foreach (string name in root.GetSubKeyNames()) {
					using (RegistryKey key = root.OpenSubKey(name, true)) {
						if (key == null) continue;
						string display = key.GetValue("DisplayName") as string;
						string current = key.GetValue("UninstallString") as string;
						if (display == null || current == null || !display.StartsWith(Uninstaller.AppName)) continue;
						int at = current.IndexOf(Uninstaller.StyledName, StringComparison.OrdinalIgnoreCase);
						if (at < 0) continue;
						string dir = current.Substring(0, at).Trim('"', ' ').TrimEnd(Path.DirectorySeparatorChar);
						key.SetValue("UninstallString", (char)34 + Path.Combine(dir, Uninstaller.NsisName) + (char)34 + " /currentuser");
					}
				}
			}
		} catch (Exception error) {
			Program.Log(error);
		}
	}

	public static int RunSilent(string arguments) {
		string core = Extract(null);
		try {
			ResetUninstallString();
			string old = FindMachineInstall();
			if (old != null) {
				try {
					RemoveMachineInstall(old);
				} catch {
				}
			}
			return Run(core, arguments);
		} finally {
			Cleanup(core);
		}
	}
}

static class Uninstaller {
	public const string AppName = "Blackpill Booster";
	public const string NsisName = "Uninstall Blackpill Booster.exe";
	public const string StyledName = "Blackpill Booster Uninstaller.exe";
	public const string TempPrefix = "blackpill-uninstall-";

	// Runs the NSIS uninstaller from a temp copy (like NSIS itself does). Run from inside the install
	// folder it can't remove itself, and older builds' app-running check killed anything in that folder.
	static int RunNsis(string dir, string arguments) {
		string nsis = Path.Combine(dir, NsisName);
		string folder = Path.Combine(Path.GetTempPath(), "blackpill-unnsis-" + Guid.NewGuid().ToString("N").Substring(0, 8));
		Directory.CreateDirectory(folder);
		string copy = Path.Combine(folder, "uninstall.exe");
		try {
			File.Copy(nsis, copy, true);
			return Installer.Run(copy, arguments);
		} finally {
			try {
				Directory.Delete(folder, true);
			} catch {
			}
		}
	}

	// NSIS upgrade step: '"<copy of this exe>" /S /KEEP_APP_DATA /currentuser --updated _?=<install dir>'
	public static int RunSilent(string arguments) {
		string dir = null;
		int marker = arguments.IndexOf("_?=");
		if (marker >= 0) dir = arguments.Substring(marker + 3).Trim().Trim('"');
		if (string.IsNullOrEmpty(dir)) {
			dir = Path.GetDirectoryName(Application.ExecutablePath);
			arguments += " _?=" + dir;
		}
		if (!File.Exists(Path.Combine(dir, NsisName))) return 0;
		return RunNsis(dir, arguments);
	}

	public static void Relaunch() {
		string self = Application.ExecutablePath;
		string folder = Path.Combine(Path.GetTempPath(), TempPrefix + Guid.NewGuid().ToString("N").Substring(0, 8));
		Directory.CreateDirectory(folder);
		string copy = Path.Combine(folder, Path.GetFileName(self));
		File.Copy(self, copy, true);
		ProcessStartInfo info = new ProcessStartInfo(copy, "\"--dir=" + Path.GetDirectoryName(self) + "\"");
		info.UseShellExecute = false;
		Process.Start(info).Dispose();
	}

	static Process[] Running() {
		return Process.GetProcessesByName(AppName);
	}

	// Ask the app to quit normally so it puts the Windows audio device back, then force it if needed.
	public static void CloseApp(string dir) {
		Process[] running = Running();
		if (running.Length == 0) return;
		string exe = Path.Combine(dir, AppName + ".exe");
		if (File.Exists(exe)) {
			try {
				ProcessStartInfo info = new ProcessStartInfo(exe, "--quit");
				info.UseShellExecute = false;
				Process.Start(info).Dispose();
			} catch {
			}
		}
		DateTime until = DateTime.Now.AddSeconds(8);
		while (Running().Length > 0 && DateTime.Now < until) Thread.Sleep(200);
		foreach (Process process in Running()) {
			try {
				process.Kill();
				process.WaitForExit(5000);
			} catch {
			}
		}
	}

	public static int Remove(string dir) {
		string nsis = Path.Combine(dir, NsisName);
		if (!File.Exists(nsis)) throw new FileNotFoundException("Blackpill Booster's files were not found in " + dir + ". It may already be removed.");
		int code = RunNsis(dir, "/S /currentuser _?=" + dir);
		// With _?= NSIS leaves its own uninstaller (and so the folder) behind; remove them.
		for (int attempt = 0; attempt < 10; attempt++) {
			try {
				if (File.Exists(nsis)) File.Delete(nsis);
				if (Directory.Exists(dir)) Directory.Delete(dir, true);
				break;
			} catch {
				Thread.Sleep(500);
			}
		}
		return code;
	}

	public static void DeleteUserData() {
		string[] folders = {
			Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), AppName),
			Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "blackpill-booster-updater"),
		};
		foreach (string folder in folders) {
			for (int attempt = 0; attempt < 8 && Directory.Exists(folder); attempt++) {
				try {
					Directory.Delete(folder, true);
				} catch {
					Thread.Sleep(400);
				}
			}
		}
	}

	public static void ScheduleSelfDelete() {
		string folder = Path.GetDirectoryName(Application.ExecutablePath);
		if (!Path.GetFileName(folder).StartsWith(TempPrefix)) return;
		try {
			ProcessStartInfo info = new ProcessStartInfo("cmd.exe", "/c ping 127.0.0.1 -n 3 > nul & rmdir /s /q \"" + folder + "\"");
			info.UseShellExecute = false;
			info.CreateNoWindow = true;
			Process.Start(info).Dispose();
		} catch {
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
	static readonly Color HotHover = Color.FromArgb(232, 52, 64);

	enum Phase { Ready, Working, Done, Failed }

	const int BaseWidth = 480;
	const int BaseHeight = 300;

	readonly bool isUninstall;
	readonly bool isUpdate;
	readonly string updateArguments;
	public int ExitCode;
	readonly string installDir;
	Phase phase = Phase.Ready;
	string heading;
	string message;
	volatile float progress;
	float shownProgress;
	volatile bool isBusy;
	DateTime busyStart;
	float busyFrom;
	float busyTo;
	bool isCableShown;
	bool isHoverButton;
	bool isHoverClose;
	bool isHoverCheck;
	bool deleteData;
	Rectangle buttonRect;
	Rectangle closeRect;
	Rectangle checkRect;
	readonly float scale;
	readonly Font titleFont;
	readonly Font headingFont;
	readonly Font buttonFont;
	readonly Font bodyFont;
	readonly Font smallFont;
	readonly Bitmap logo;
	readonly System.Windows.Forms.Timer timer;

	public SetupForm(bool isUninstall, string installDir, string updateArguments) {
		this.isUninstall = isUninstall;
		this.installDir = installDir;
		this.updateArguments = updateArguments;
		isUpdate = updateArguments != null;
		if (isUpdate) {
			heading = "Updating";
			message = "Installing the new version. Blackpill Booster opens again when it's done.";
		} else if (isUninstall) {
			heading = "Remove Blackpill Booster";
			message = "Removes the app, its shortcuts and its files. VB-CABLE stays installed; remove it from Windows Settings > Apps if you don't need it.";
		} else {
			heading = "Ready to install";
			message = "Installs the app and the VB-CABLE audio driver it needs. Windows asks for permission once, for the driver.";
		}

		using (Graphics graphics = CreateGraphics()) {
			scale = graphics.DpiX / 96f;
		}
		FormBorderStyle = FormBorderStyle.None;
		StartPosition = FormStartPosition.CenterScreen;
		ClientSize = new Size(S(BaseWidth), S(BaseHeight));
		BackColor = Background;
		DoubleBuffered = true;
		Text = isUninstall ? "Uninstall Blackpill Booster" : isUpdate ? "Blackpill Booster Update" : "Blackpill Booster Setup";
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
		checkRect = new Rectangle(margin, buttonRect.Y - S(36), ClientSize.Width - margin * 2, S(22));

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

	void Busy(float from, float to) {
		busyFrom = from;
		busyTo = to;
		busyStart = DateTime.Now;
		isBusy = true;
	}

	void OnTick(object sender, EventArgs e) {
		if (isBusy) {
			double seconds = (DateTime.Now - busyStart).TotalSeconds;
			float fake = busyFrom + (busyTo - busyFrom) * (float)(1 - Math.Exp(-seconds / (isUninstall ? 4 : isUpdate ? 8 : 22)));
			if (fake > progress) progress = fake;
			if (!isUninstall && !isUpdate && !isCableShown && File.Exists(Installer.CableLog)) {
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
		TextFormatFlags flags = TextFormatFlags.NoPadding | TextFormatFlags.SingleLine;

		// Header
		int iconSize = S(48);
		int headerTop = S(30);
		if (logo != null) graphics.DrawImage(logo, margin, headerTop, iconSize, iconSize);
		int titleLeft = margin + iconSize + S(14);
		Size first = TextRenderer.MeasureText(graphics, "BLACKPILL ", titleFont, Size.Empty, flags);
		TextRenderer.DrawText(graphics, "BLACKPILL ", titleFont, new Point(titleLeft, headerTop - S(2)), TextColor, flags);
		TextRenderer.DrawText(graphics, "BOOSTER", titleFont, new Point(titleLeft + first.Width, headerTop - S(2)), Hot, flags);
		string subtitle = (isUninstall ? "UNINSTALL" : isUpdate ? "UPDATE" : "SETUP") + "  " + (char)183 + "  V" + BuildInfo.Version;
		TextRenderer.DrawText(graphics, subtitle, smallFont, new Point(titleLeft + S(1), headerTop + first.Height + S(2)), Muted, flags);

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

		// "Delete my data" checkbox (uninstall only, before starting)
		if (isUninstall && phase == Phase.Ready) {
			int box = S(16);
			Rectangle boxRect = new Rectangle(checkRect.X, checkRect.Y + (checkRect.Height - box) / 2, box, box);
			using (Pen pen = new Pen(deleteData ? Hot : (isHoverCheck ? Muted : Line), Math.Max(2f, scale * 2f))) graphics.DrawRectangle(pen, boxRect);
			if (deleteData) {
				using (SolidBrush brush = new SolidBrush(Hot)) graphics.FillRectangle(brush, Rectangle.Inflate(boxRect, -S(4), -S(4)));
			}
			TextRenderer.DrawText(graphics, "Also delete my settings, presets and sounds", bodyFont, new Point(boxRect.Right + S(10), checkRect.Y + (checkRect.Height - bodyFont.Height) / 2), isHoverCheck || deleteData ? TextColor : Muted, flags);
		}

		// Progress bar
		if (phase != Phase.Ready) {
			Rectangle track = new Rectangle(margin, buttonRect.Y - S(20), width - margin * 2, Math.Max(3, S(4)));
			using (SolidBrush brush = new SolidBrush(Track)) graphics.FillRectangle(brush, track);
			int fillWidth = (int)(track.Width * Math.Min(1f, Math.Max(0f, shownProgress)));
			Color barColor = phase == Phase.Failed || isUninstall ? Hot : Accent;
			using (SolidBrush brush = new SolidBrush(barColor)) graphics.FillRectangle(brush, track.X, track.Y, fillWidth, track.Height);
		}

		// Main button
		string label;
		Color fill;
		Color ink;
		if (phase == Phase.Working) {
			label = (isUninstall ? "REMOVING  " : isUpdate ? "UPDATING  " : "INSTALLING  ") + (int)Math.Round(shownProgress * 100) + "%";
			fill = Raised;
			ink = Muted;
		} else if (isUninstall && phase != Phase.Done) {
			label = phase == Phase.Ready ? "UNINSTALL" : "TRY AGAIN";
			fill = isHoverButton ? HotHover : Hot;
			ink = Color.White;
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

	bool IsCheckVisible() {
		return isUninstall && phase == Phase.Ready;
	}

	protected override void OnMouseMove(MouseEventArgs e) {
		base.OnMouseMove(e);
		bool overButton = buttonRect.Contains(e.Location) && phase != Phase.Working;
		bool overClose = closeRect.Contains(e.Location);
		bool overCheck = IsCheckVisible() && checkRect.Contains(e.Location);
		if (overButton != isHoverButton || overClose != isHoverClose || overCheck != isHoverCheck) {
			isHoverButton = overButton;
			isHoverClose = overClose;
			isHoverCheck = overCheck;
			Cursor = overButton || overCheck ? Cursors.Hand : Cursors.Default;
			Invalidate();
		}
	}

	protected override void OnMouseLeave(EventArgs e) {
		base.OnMouseLeave(e);
		isHoverButton = false;
		isHoverClose = false;
		isHoverCheck = false;
		Invalidate();
	}

	protected override void OnMouseDown(MouseEventArgs e) {
		base.OnMouseDown(e);
		if (e.Button != MouseButtons.Left) return;
		if (closeRect.Contains(e.Location)) {
			if (phase != Phase.Working) Close();
			return;
		}
		if (IsCheckVisible() && checkRect.Contains(e.Location)) {
			deleteData = !deleteData;
			Invalidate();
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

	protected override void OnShown(EventArgs e) {
		base.OnShown(e);
		if (isUpdate) Start();
	}

	protected override void OnFormClosed(FormClosedEventArgs e) {
		base.OnFormClosed(e);
		if (isUninstall) Uninstaller.ScheduleSelfDelete();
	}

	void Start() {
		phase = Phase.Working;
		progress = 0;
		shownProgress = 0;
		isCableShown = false;
		isHoverButton = false;
		isHoverCheck = false;
		Cursor = Cursors.Default;
		Thread worker = new Thread(isUninstall ? (ThreadStart)UninstallWork : InstallWork);
		worker.IsBackground = true;
		worker.Start();
	}

	void InstallWork() {
		string core = null;
		try {
			SetText("Unpacking", "Getting everything ready.");
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
			Installer.ResetUninstallString();
			if (isUpdate) SetText("Updating", "Installing the new version. Blackpill Booster opens again when it's done.");
			else SetText("Installing", "Copying Blackpill Booster. If it's open, it will restart.");
			Busy(0.12f, 0.95f);
			int code = Installer.Run(core, isUpdate ? updateArguments : "/S --force-run");
			isBusy = false;
			ExitCode = code;
			if (code != 0) {
				Fail(isUpdate ? "Update failed" : "Install failed", "The installer stopped with code " + code + ". Close Blackpill Booster if it's open, then try again.");
				return;
			}
			progress = 1;
			if (isUpdate) {
				BeginInvoke((MethodInvoker)delegate { phase = Phase.Done; Close(); });
				return;
			}
			string cable = CableResult();
			SetText("Installed", "Blackpill Booster is starting. " + (cable ?? "You can close this window."));
			SetPhase(Phase.Done);
		} catch (Exception error) {
			isBusy = false;
			ExitCode = 1;
			Program.Log(error);
			Fail(isUpdate ? "Update failed" : "Install failed", error.Message);
		} finally {
			if (core != null) Installer.Cleanup(core);
		}
	}

	void UninstallWork() {
		try {
			SetText("Closing Blackpill Booster", "Putting your Windows audio device back the way it was.");
			Busy(0f, 0.3f);
			Uninstaller.CloseApp(installDir);
			SetText("Removing", "Deleting the app, its shortcuts and its files.");
			Busy(0.3f, 0.95f);
			int code = Uninstaller.Remove(installDir);
			isBusy = false;
			if (code != 0) {
				Fail("Uninstall failed", "The uninstaller stopped with code " + code + ". Close Blackpill Booster if it's open, then try again.");
				return;
			}
			if (deleteData) Uninstaller.DeleteUserData();
			progress = 1;
			SetText("Removed", deleteData
				? "Blackpill Booster and your settings are gone. VB-CABLE is still installed."
				: "Blackpill Booster is gone. Your settings and sounds are kept in case you come back. VB-CABLE is still installed.");
			SetPhase(Phase.Done);
		} catch (Exception error) {
			isBusy = false;
			Program.Log(error);
			Fail("Uninstall failed", error.Message);
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
