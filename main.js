const { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, nativeImage, session, shell, desktopCapturer } = require("electron");
const { execFile, execFileSync } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

const storePath = path.join(app.getPath("userData"), "store.json");
const scriptPath = path.join(__dirname, "devices.ps1");
const isAutostart = process.argv.includes("--autostart");

let mainWindow = null;
let tray = null;
let store = {};
let isQuitting = false;
let isLoopbackMuted = true;
let saveTimer = 0;
let trayState = { isActive: false, isMuted: false, volume: 100, presets: [] };

function readStore() {

	try {
		const parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}

}

function writeStore() {

	clearTimeout(saveTimer);
	try {
		fs.mkdirSync(path.dirname(storePath), { recursive: true });
		fs.writeFileSync(`${storePath}.tmp`, JSON.stringify(store));
		fs.renameSync(`${storePath}.tmp`, storePath);
	} catch (error) {
		console.warn(`[Main] Could not save settings: ${error.message}`);
	}

}

function queueStore() {

	clearTimeout(saveTimer);
	saveTimer = setTimeout(writeStore, 300);

}

function powershell(args) {

	return new Promise((resolve, reject) => {
		if (process.platform !== "win32") {
			reject(new Error("Windows only"));
			return;
		}
		execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args], { windowsHide: true, timeout: 20000 }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error((stderr || error.message).trim().split("\n")[0]));
				return;
			}
			try {
				resolve(JSON.parse(stdout.trim().split("\n").pop()));
			} catch {
				reject(new Error("The device helper returned something unreadable."));
			}
		});
	});

}

function installCable() {

	return new Promise(resolve => {
		if (process.platform !== "win32") {
			resolve({ ok: false, error: "The cable driver is for Windows." });
			return;
		}
		const script = path.join(__dirname, "install-cable.ps1").replace(/'/g, "''");
		const command = `$process = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File "${script}"'; exit $process.ExitCode`;
		execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, timeout: 600000 }, error => {
			const code = error ? error.code : 0;
			if (code === 0) {
				resolve({ ok: true });
				return;
			}
			if (code === 2) {
				resolve({ ok: false, error: "The driver was not detected after setup. Approve the Windows driver prompt, or restart the PC and rescan." });
				return;
			}
			let detail = "";
			try {
				detail = fs.readFileSync(path.join(os.tmpdir(), "blackpill-cable", "install.log"), "utf8").trim().split("\n").pop();
			} catch {
				detail = "";
			}
			resolve({ ok: false, error: detail || "Setup was canceled or blocked. Approve the Windows administrator prompt and try again." });
		});
	});

}

async function routeTo(name) {

	const list = await powershell(["list"]);
	const wanted = String(name ?? "").toLowerCase();
	const target = list.devices.find(device => device.name.toLowerCase() === wanted)
		?? list.devices.find(device => wanted && device.name.toLowerCase().includes(wanted))
		?? list.devices.find(device => /cable input|voicemeeter input|voicemeeter vaio/i.test(device.name));
	if (!target) throw new Error("No virtual cable playback device was found in Windows.");
	if (list.default === target.id) return { ok: true, name: target.name, isChanged: false };

	if (!store.restoreDevice) {
		store.restoreDevice = list.default;
		writeStore();
	}
	await powershell(["set", target.id]);
	return { ok: true, name: target.name, isChanged: true };

}

async function restoreRoute() {

	const id = store.restoreDevice;
	if (!id) return { ok: true, isChanged: false };

	delete store.restoreDevice;
	writeStore();
	await powershell(["set", id]);
	return { ok: true, isChanged: true };

}

function restoreRouteSync() {

	const id = store.restoreDevice;
	if (!id || process.platform !== "win32") return;

	delete store.restoreDevice;
	writeStore();
	try {
		execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "set", id], { windowsHide: true, timeout: 20000 });
	} catch (error) {
		console.warn(`[Main] Could not restore the playback device: ${error.message}`);
	}

}

function send(channel, payload) {

	if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);

}

function showWindow() {

	if (!mainWindow) return;
	if (mainWindow.isMinimized()) mainWindow.restore();
	mainWindow.show();
	mainWindow.focus();

}

function toggleWindow() {

	if (!mainWindow) return;
	if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
	else showWindow();

}

function runCommand(command) {

	if (command === "show-window") {
		toggleWindow();
		return;
	}
	send("command", command);

}

function rebuildTray() {

	if (!tray) return;

	const command = name => () => runCommand(name);
	const menu = Menu.buildFromTemplate([
		{ label: "Open Blackpill Booster", click: showWindow },
		{ type: "separator" },
		{ label: "Boost the whole PC", type: "checkbox", checked: trayState.isActive, click: command("toggle-power") },
		{ label: "Ghost (mute)", type: "checkbox", checked: trayState.isMuted, click: command("toggle-mute") },
		{ label: "Mog harder", click: command("volume-up") },
		{ label: "Mog softer", click: command("volume-down") },
		{ label: "Toggle Loudmaxx", click: command("toggle-maxx") },
		{ label: "Panic: back to 100%", click: command("panic") },
		{ label: "Presets", submenu: trayState.presets.map(preset => ({ label: preset.name, click: command(preset.id) })) },
		{ type: "separator" },
		{ label: "Quit", click: () => {
			isQuitting = true;
			app.quit();
		} },
	]);
	tray.setContextMenu(menu);
	tray.setToolTip(trayState.isActive ? `Blackpill Booster · ${trayState.isMuted ? "Ghosted" : `${Math.round(trayState.volume)}%`}` : "Blackpill Booster · Off");

}

function registerHotkeys(hotkeys) {

	globalShortcut.unregisterAll();
	const failed = [];
	for (const [command, accelerator] of Object.entries(hotkeys ?? {})) {
		if (!accelerator) continue;
		try {
			if (!globalShortcut.register(accelerator, () => runCommand(command))) failed.push(command);
		} catch {
			failed.push(command);
		}
	}
	return failed;

}

function recordingFolder() {
	return store.prefs?.recordFolder || path.join(app.getPath("music"), "Blackpill Booster");
}

function createWindow() {

	const bounds = store.window ?? {};
	mainWindow = new BrowserWindow({
		width: bounds.width ?? 500,
		height: bounds.height ?? 860,
		x: bounds.x,
		y: bounds.y,
		minWidth: 440,
		minHeight: 560,
		show: false,
		backgroundColor: "#000000",
		title: "Blackpill Booster",
		icon: path.join(__dirname, "icons", "icon128.png"),
		autoHideMenuBar: true,
		titleBarStyle: "hidden",
		titleBarOverlay: { color: "#000000", symbolColor: "#ededed", height: 34 },
		alwaysOnTop: Boolean(store.prefs?.alwaysOnTop),
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			backgroundThrottling: false,
			spellcheck: false,
		},
	});
	mainWindow.removeMenu();
	mainWindow.loadFile(path.join(__dirname, "index.html"));

	mainWindow.once("ready-to-show", () => {
		if (!(isAutostart && store.prefs?.startMinimized && tray)) mainWindow.show();
	});
	mainWindow.on("close", event => {
		store.window = mainWindow.getBounds();
		queueStore();
		if (isQuitting || !store.prefs?.closeToTray || !tray) return;
		event.preventDefault();
		mainWindow.hide();
	});
	mainWindow.on("session-end", () => {
		restoreRouteSync();
		writeStore();
	});
	mainWindow.on("closed", () => {
		mainWindow = null;
	});
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https:\/\//.test(url)) shell.openExternal(url);
		return { action: "deny" };
	});
	mainWindow.webContents.on("will-navigate", event => event.preventDefault());

}

function createTray() {

	try {
		tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "icons", "icon32.png")));
		tray.on("click", toggleWindow);
		rebuildTray();
	} catch (error) {
		tray = null;
		console.warn(`[Main] Tray is unavailable: ${error.message}`);
	}

}

function setupSession() {

	session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(["media", "speaker-selection", "display-capture", "clipboard-sanitized-write"].includes(permission)));
	session.defaultSession.setPermissionCheckHandler((contents, permission) => ["media", "speaker-selection", "display-capture", "clipboard-sanitized-write", "clipboard-read"].includes(permission));
	session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
		desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } })
			.then(sources => callback({ video: sources[0], audio: isLoopbackMuted ? "loopbackWithMute" : "loopback" }))
			.catch(() => callback({}));
	});

}

function setupIpc() {

	ipcMain.handle("store:load", () => store);
	ipcMain.handle("store:save", (event, patch) => {
		if (!patch || typeof patch !== "object") return false;
		Object.assign(store, patch);
		queueStore();
		if (patch.prefs && mainWindow) mainWindow.setAlwaysOnTop(Boolean(patch.prefs.alwaysOnTop));
		return true;
	});
	ipcMain.handle("store:reset", () => {
		const restoreDevice = store.restoreDevice;
		store = restoreDevice ? { restoreDevice } : {};
		writeStore();
		return true;
	});

	ipcMain.handle("devices:list", () => powershell(["list"]).then(list => ({ ok: true, ...list }), error => ({ ok: false, error: error.message })));
	ipcMain.handle("devices:route", (event, name) => routeTo(name).catch(error => ({ ok: false, error: error.message })));
	ipcMain.handle("devices:restore", () => restoreRoute().catch(error => ({ ok: false, error: error.message })));
	ipcMain.handle("cable:install", () => installCable());
	ipcMain.handle("devices:loopbackMute", (event, isMuted) => {
		isLoopbackMuted = Boolean(isMuted);
		return true;
	});

	ipcMain.handle("hotkeys:set", (event, hotkeys) => registerHotkeys(hotkeys));
	ipcMain.handle("tray:update", (event, state) => {
		trayState = { isActive: Boolean(state?.isActive), isMuted: Boolean(state?.isMuted), volume: Number(state?.volume) || 0, presets: Array.isArray(state?.presets) ? state.presets.slice(0, 60) : [] };
		rebuildTray();
		return true;
	});

	ipcMain.handle("autostart:set", (event, isOn) => {
		app.setLoginItemSettings({ openAtLogin: Boolean(isOn), args: ["--autostart"] });
		return app.getLoginItemSettings({ args: ["--autostart"] }).openAtLogin;
	});

	ipcMain.handle("recording:save", async (event, bytes, name) => {
		const folder = recordingFolder();
		const file = path.join(folder, path.basename(String(name)));
		await fs.promises.mkdir(folder, { recursive: true });
		await fs.promises.writeFile(file, Buffer.from(bytes));
		return file;
	});
	ipcMain.handle("recording:folder", () => recordingFolder());
	ipcMain.handle("recording:choose", async () => {
		const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory", "createDirectory"], defaultPath: recordingFolder() });
		return result.canceled ? "" : result.filePaths[0];
	});
	ipcMain.handle("recording:open", async () => {
		const folder = recordingFolder();
		await fs.promises.mkdir(folder, { recursive: true });
		return shell.openPath(folder);
	});
	ipcMain.handle("recording:reveal", (event, file) => shell.showItemInFolder(String(file)));

	ipcMain.handle("backup:export", async (event, text) => {
		const result = await dialog.showSaveDialog(mainWindow, { defaultPath: "blackpill-backup.json", filters: [{ name: "JSON", extensions: ["json"] }] });
		if (result.canceled) return "";
		await fs.promises.writeFile(result.filePath, String(text));
		return result.filePath;
	});
	ipcMain.handle("backup:import", async () => {
		const result = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"], filters: [{ name: "JSON", extensions: ["json"] }] });
		if (result.canceled) return "";
		return fs.promises.readFile(result.filePaths[0], "utf8");
	});

	ipcMain.handle("open:external", (event, target) => {
		const allowed = { sound: "ms-settings:sound", mixer: "ms-settings:apps-volume", cable: "https://vb-audio.com/Cable/" };
		return allowed[target] ? shell.openExternal(allowed[target]) : false;
	});
	ipcMain.handle("app:info", () => ({ platform: process.platform, version: app.getVersion(), isAutostart: app.getLoginItemSettings({ args: ["--autostart"] }).openAtLogin }));
	ipcMain.handle("app:hide", () => {
		if (tray) mainWindow?.hide();
		else mainWindow?.minimize();
	});
	ipcMain.handle("app:quit", () => {
		isQuitting = true;
		app.quit();
	});

}

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
if (process.env.BLACKPILL_FAKE_AUDIO) {
	app.commandLine.appendSwitch("use-fake-device-for-media-stream");
	app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
}
if (process.env.BLACKPILL_DEBUG_PORT) app.commandLine.appendSwitch("remote-debugging-port", process.env.BLACKPILL_DEBUG_PORT);

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.setAppUserModelId("com.blackpill.booster");
	app.on("second-instance", showWindow);

	app.whenReady().then(async () => {
		store = readStore();
		if (store.restoreDevice) await restoreRoute().catch(() => {});
		setupSession();
		setupIpc();
		createTray();
		createWindow();
	});

	app.on("window-all-closed", () => {
		isQuitting = true;
		app.quit();
	});

	app.on("before-quit", () => {
		isQuitting = true;
		globalShortcut.unregisterAll();
		restoreRouteSync();
		writeStore();
	});
}
