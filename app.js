const quickToggles = [
	{ key: "agc", label: "Auto-mog", title: "Keeps everything at the same loudness" },
	{ key: "multiband", label: "Gigamog", title: "3-band maximizer" },
	{ key: "clip", label: "Clip-maxx", title: "Shaves peaks before the limiter" },
	{ key: "punch", label: "Punch-maxx", title: "Snappier hits" },
	{ key: "phantom", label: "Phantom bass", title: "Bass you can hear on small speakers" },
	{ key: "sub", label: "Jaw drop", title: "Sub-octave bass" },
	{ key: "exciter", label: "Hunter eyes", title: "Sharper, clearer highs" },
	{ key: "monoBass", label: "Bass mono", title: "Bass in the center, louder on speakers" },
	{ key: "deesser", label: "Tongue posture", title: "De-esser for harsh S sounds" },
	{ key: "npc", label: "NPC mode", title: "Robot voice" },
	{ key: "echo", label: "Rent-free", title: "Echo" },
	{ key: "reverb", label: "Echo chamber", title: "Reverb" },
];

const loudStages = ["agc", "multiband", "clip", "punch", "phantom", "sub", "exciter", "monoBass"];

const state = {
	isActive: false,
	settings: defaultSettings(),
	prefs: defaultPrefs(),
	presets: [],
	stats: {},
	info: { platform: "win32", version: "", isAutostart: false },
	context: null,
	engine: null,
	stream: null,
	sourceNode: null,
	route: null,
	routeNote: "",
	inputs: [],
	outputs: [],
	defaultOutputLabel: "",
	windowsDevices: [],
	compare: "boosted",
	slot: "A",
	otherSlot: null,
	past: [],
	future: [],
	historyStamp: 0,
	recordingSince: 0,
	starting: null,
	isApplyQueued: false,
	levelTimer: 0,
	meterPeak: -Infinity,
	meterReduction: 0,
	spectrumView: "after",
	peaks: [],
	lastTier: "",
	panel: "mog",
	volumeField: null,
	presetCursor: -1,
	voiceCursor: 0,
	saveTimers: new Map(),
	trayTimer: 0,
	failedHotkeys: [],
	capturing: null,
};

const store = {
	get settings() {
		return state.settings;
	},
	change(patch) {
		change(patch);
	},
};

const updaters = [];
const prefUpdaters = [];
const quickButtons = [];
const ladderButtons = [];
const presetButtons = [];
const userPresetRows = [];
const element = id => document.getElementById(id);

function animate(target, name) {

	if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	target.classList.remove(name);
	void target.offsetWidth;
	target.classList.add(name);

}

function save(key, value, delay = 400) {

	clearTimeout(state.saveTimers.get(key));
	state.saveTimers.set(key, setTimeout(() => {
		state.saveTimers.delete(key);
		desktop.saveStore({ [key]: value });
	}, delay));

}

function savePrefs() {

	save("prefs", state.prefs, 150);
	applyTheme(state.prefs);
	for (const update of prefUpdaters) update();
	render();

}

function pushHistory(before) {

	const now = Date.now();
	if (now - state.historyStamp > 700) {
		state.past.push(before);
		if (state.past.length > 100) state.past.shift();
	}
	state.historyStamp = now;
	state.future = [];

}

function change(patch, isHistory = true) {

	const before = state.settings;
	const next = mergeSettings({ ...before, ...patch });
	if (patch.volume !== undefined && next.volume > state.prefs.normalCap) next.ultimate = true;
	if (settingsMatch(before, next) && before.muted === next.muted) {
		render();
		return;
	}

	if (isHistory && !settingsMatch(before, next)) pushHistory(before);
	state.settings = next;
	if (!before.ultimate && next.ultimate) animate(element("big"), "is-ascending");
	if (!before.distortion && next.distortion) animate(element("big"), "is-shattering");
	if (before.limiter && !next.limiter) animate(document.body, "is-quaking");
	render();
	commit();

}

function commit() {

	save("last", state.settings);
	if (!state.engine || state.isApplyQueued) return;

	state.isApplyQueued = true;
	requestAnimationFrame(() => {
		state.isApplyQueued = false;
		state.engine?.apply(state.settings);
	});

}

function showError(message) {

	const banner = element("banner");
	banner.textContent = message;
	banner.hidden = !message;

}

function describeError(error) {

	const message = String(error?.message ?? error);
	if (/NotFoundError|Requested device not found/i.test(message)) return "That device is gone. Rescan in Route and pick another one.";
	if (/NotAllowedError|Permission denied/i.test(message)) return "Windows blocked audio capture. Allow desktop apps to use the microphone in Windows privacy settings, then try again.";
	if (/NotReadableError|Could not start audio source/i.test(message)) return "Another app holds that device exclusively. Close it or turn off exclusive mode in the device's Windows properties.";
	return message;

}

async function loadDevices() {

	let list = [];
	try {
		list = await navigator.mediaDevices.enumerateDevices();
		if (list.length && list.every(device => !device.label)) {
			const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
			for (const track of probe.getTracks()) track.stop();
			list = await navigator.mediaDevices.enumerateDevices();
		}
	} catch {
		list = list ?? [];
	}

	const isReal = device => device.deviceId !== "default" && device.deviceId !== "communications";
	state.inputs = list.filter(device => device.kind === "audioinput" && isReal(device));
	state.outputs = list.filter(device => device.kind === "audiooutput" && isReal(device));
	state.defaultOutputLabel = list.find(device => device.kind === "audiooutput" && device.deviceId === "default")?.label ?? "";

	const windows = await desktop.listDevices().catch(() => null);
	state.windowsDevices = windows?.ok ? windows.devices : [];
	renderRoute();

}

function currentOutput() {
	return state.outputs.find(device => device.label && state.defaultOutputLabel.endsWith(device.label)) ?? null;
}

function resolveSource() {

	const prefs = state.prefs;
	if (prefs.source === "loopback") return { kind: "loopback", deviceId: "", label: "System loopback" };
	if (prefs.source !== "auto") {
		const chosen = state.inputs.find(device => device.deviceId === prefs.source) ?? state.inputs.find(device => device.label && device.label === prefs.sourceLabel);
		if (chosen) return { kind: "device", deviceId: chosen.deviceId, label: chosen.label };
	}
	const cable = state.inputs.find(device => /cable output/i.test(device.label)) ?? state.inputs.find(device => isVirtualDevice(device.label));
	return cable ? { kind: "device", deviceId: cable.deviceId, label: cable.label } : null;

}

function resolveOutput() {

	const prefs = state.prefs;
	if (prefs.output !== "auto") {
		const chosen = state.outputs.find(device => device.deviceId === prefs.output) ?? state.outputs.find(device => device.label && device.label === prefs.outputLabel);
		if (chosen) return chosen;
	}
	const current = currentOutput();
	if (current && !isVirtualDevice(current.label)) return current;

	const real = state.outputs.filter(device => !isVirtualDevice(device.label));
	return real.find(device => device.label === prefs.lastOutputLabel) ?? real[0] ?? null;

}

function planRoute() {

	const source = resolveSource();
	const output = resolveOutput();
	if (!source) return { error: "No virtual cable found. Install it from the Route tab, or pick another source there." };
	if (!output) return { error: "No output device found. Pick one in Route." };

	const isCable = source.kind === "device" && isVirtualDevice(source.label);
	if (isCable && isVirtualDevice(output.label)) return { error: "The output is a virtual cable too, which would feed the sound back into itself. Pick your real speakers or headphones in Route." };
	if (source.kind === "loopback" && currentOutput()?.deviceId === output.deviceId) {
		return { error: "System loopback captures your Windows output device, so the boosted sound has to play on a different one. Pick another output in Route, or use a virtual cable." };
	}
	return { source, output, isCable };

}

async function openSource(source) {

	if (source.kind === "loopback") {
		await desktop.setLoopbackMute(state.prefs.muteOriginal);
		const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
		for (const track of stream.getVideoTracks()) {
			track.stop();
			stream.removeTrack(track);
		}
		if (!stream.getAudioTracks().length) throw new Error("Windows did not hand over the system audio.");
		return stream;
	}
	return navigator.mediaDevices.getUserMedia({
		audio: { deviceId: { exact: source.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 },
		video: false,
	});

}

function start() {

	if (state.isActive) return Promise.resolve();
	if (state.starting) return state.starting;

	state.starting = (async () => {
		let stream = null;
		let context = null;
		try {
			await loadDevices();
			const plan = planRoute();
			if (plan.error) throw new Error(plan.error);

			stream = await openSource(plan.source);
			context = new AudioContext({ latencyHint: state.prefs.latency });
			await context.audioWorklet.addModule("processors.js");
			await context.setSinkId(plan.output.deviceId);
			await context.resume();

			const engine = new Engine(context, state.settings, { isGuardEnabled: state.prefs.cpuGuard });
			const sourceNode = context.createMediaStreamSource(stream);
			sourceNode.connect(engine.input);
			for (const track of stream.getAudioTracks()) {
				track.addEventListener("ended", () => {
					if (state.stream !== stream) return;
					stop().then(() => showError("The source device disconnected, so boosting stopped."));
				}, { once: true });
			}

			Object.assign(state, { context, engine, stream, sourceNode, route: plan, isActive: true, compare: "boosted", routeNote: "" });
			if (!isVirtualDevice(plan.output.label) && state.prefs.lastOutputLabel !== plan.output.label) {
				state.prefs.lastOutputLabel = plan.output.label;
				save("prefs", state.prefs, 150);
			}
			await applyMirror();

			if (plan.isCable && state.prefs.autoRoute) {
				const result = await desktop.route(state.prefs.routeDevice);
				state.routeNote = result?.ok
					? `Windows now plays into ${result.name}. Your device comes back when you stop.`
					: `Windows was not switched automatically (${result?.error ?? "unknown error"}). Set the cable as your Windows output device yourself.`;
			} else if (plan.isCable) {
				state.routeNote = "Set the cable as your Windows output device to feed the booster.";
			}
			showError("");
			startLevels();
		} catch (error) {
			for (const track of stream?.getTracks() ?? []) track.stop();
			await context?.close().catch(() => {});
			state.isActive = false;
			showError(describeError(error));
			if (/virtual cable/i.test(String(error?.message))) selectPanel("route");
		} finally {
			state.starting = null;
			render();
			renderRoute();
		}
	})();
	renderStatus();
	return state.starting;

}

async function stop() {

	if (state.starting) await state.starting;
	if (!state.isActive) return;

	const { engine, context, stream, sourceNode } = state;
	Object.assign(state, { isActive: false, engine: null, context: null, stream: null, sourceNode: null, route: null, routeNote: "" });
	stopLevels();
	if (engine.recorder) await finishRecording(engine);
	engine.destroy();
	sourceNode.disconnect();
	for (const track of stream.getTracks()) track.stop();
	await context.close().catch(() => {});
	await desktop.restoreRoute().catch(() => {});
	state.recordingSince = 0;
	render();
	renderRoute();

}

async function restart() {

	if (!state.isActive) return;
	await stop();
	await start();

}

async function applyMirror() {

	if (!state.engine) return;
	const prefs = state.prefs;
	const device = prefs.mirror ? state.outputs.find(item => item.deviceId === prefs.mirror) ?? state.outputs.find(item => item.label && item.label === prefs.mirrorLabel) : null;
	const isSame = device && device.deviceId === state.route?.output.deviceId;
	await state.engine.setMirror(device && !isSame ? device.deviceId : "", prefs.mirrorVolume).catch(() => {});

}

async function finishRecording(engine) {

	const blob = await engine.stopRecording();
	const status = element("recordStatus");
	if (!blob || !blob.size) return;

	const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
	try {
		const file = await desktop.saveRecording(await blob.arrayBuffer(), `blackpill-recording-${stamp}.webm`);
		status.textContent = `Saved ${file}`;
	} catch (error) {
		status.textContent = `Could not save the recording: ${error.message}`;
	}
	status.hidden = false;

}

async function toggleRecord() {

	if (!state.isActive) await start();
	if (!state.engine) return;

	if (state.engine.recorder) {
		state.recordingSince = 0;
		await finishRecording(state.engine);
	} else {
		state.engine.startRecording();
		state.recordingSince = Date.now();
		element("recordStatus").hidden = true;
	}
	renderTools();

}

function setCompare(mode) {

	if (!state.engine) return;
	state.engine.setCompare(mode);
	state.compare = mode;
	render();

}

function stepHistory(isUndo) {

	const source = isUndo ? state.past : state.future;
	if (!source.length) return;

	(isUndo ? state.future : state.past).push(state.settings);
	state.settings = mergeSettings(source.pop());
	state.historyStamp = 0;
	render();
	commit();

}

function selectSlot(slot) {

	if (slot === state.slot) return;
	const current = state.settings;
	const next = state.otherSlot ?? current;
	state.otherSlot = current;
	state.slot = slot;
	change(next);
	render();

}

function unlockedPresets() {
	return [...allBuiltInPresets.filter(preset => isUnlocked(preset, state.stats)), ...state.presets];
}

function runCommand(command) {

	const settings = state.settings;
	const prefs = state.prefs;

	if (command.startsWith("sound:")) {
		window.soundboard?.play(command.slice(6));
		return;
	}

	if (command.startsWith("preset:") || command.startsWith("builtin:")) {
		const preset = findPreset(command, state.presets);
		if (preset && isUnlocked(preset, state.stats)) change(presetSettings(preset));
		return;
	}

	switch (command) {
		case "toggle-power":
			if (state.isActive || state.starting) stop();
			else start();
			return;
		case "volume-up":
			nudgeVolume(1);
			return;
		case "volume-down":
			nudgeVolume(-1);
			return;
		case "volume-max":
			change({ volume: settings.ultimate ? prefs.ascendCap : prefs.normalCap, muted: false });
			return;
		case "toggle-mute":
			change({ muted: !settings.muted });
			return;
		case "toggle-distortion":
			change({ distortion: !settings.distortion });
			return;
		case "toggle-maxx":
			change(maxxPatch(!isMaxxOn(settings), settings.maxxAmount));
			return;
		case "toggle-automog":
			change({ agc: !settings.agc });
			return;
		case "toggle-gigamog":
			change({ multiband: !settings.multiband });
			return;
		case "toggle-ascend":
			change({ ultimate: !settings.ultimate });
			return;
		case "toggle-limiter":
			change({ limiter: !settings.limiter });
			return;
		case "panic":
			change(panicPatch());
			return;
		case "toggle-original":
			setCompare(state.compare === "original" ? "boosted" : "original");
			return;
		case "toggle-record":
			toggleRecord();
			return;
		case "next-preset": {
			const all = unlockedPresets();
			state.presetCursor = (state.presetCursor + 1) % all.length;
			change(presetSettings(all[state.presetCursor]));
			return;
		}
		case "next-voice": {
			const list = Object.values(voicePresets);
			state.voiceCursor = (state.voiceCursor + 1) % list.length;
			change(list[state.voiceCursor].patch);
			return;
		}
		case "undo":
			stepHistory(true);
			return;
		case "redo":
			stepHistory(false);
			return;
		case "reset":
			change(defaultSettings());
			return;
		default:
			return;
	}

}

function describeRoute() {

	if (!state.isActive || !state.route) return "Whole PC";
	return `${state.route.source.label} → ${state.route.output.label}`;

}

function renderStatus() {

	const settings = state.settings;
	const status = element("status");
	let text = "Off";
	let tone = "";
	if (state.starting) {
		text = "Ascending";
	} else if (state.isActive) {
		if (settings.muted) text = "Ghosted";
		else if (state.compare === "original") text = "Original";
		else if (!settings.limiter) [text, tone] = ["It's over", "is-hot"];
		else if (settings.ultimate) [text, tone] = ["Ascended", "is-hot"];
		else [text, tone] = ["Mogging", "is-on"];
	}

	element("power").checked = state.isActive || Boolean(state.starting);
	status.textContent = text;
	status.className = `status ${tone}`;
	element("siteTitle").textContent = describeRoute();
	document.body.classList.toggle("is-hot", isHot(settings));

	clearTimeout(state.trayTimer);
	state.trayTimer = setTimeout(() => {
		desktop.updateTray({
			isActive: state.isActive,
			isMuted: settings.muted,
			volume: settings.volume,
			presets: unlockedPresets().map(preset => ({ id: preset.id, name: preset.name })),
		});
	}, 120);

}

function renderVolume() {

	const settings = state.settings;
	const prefs = state.prefs;
	const cap = maxVolume(settings, prefs);
	const fader = element("volume");
	const tier = element("tier");
	const tierName = tierFor(settings);

	fader.max = cap;
	fader.step = cap > 100000 ? Math.round(cap / 2000) : cap > 1000 ? 25 : 5;
	fader.value = settings.volume;
	fader.style.setProperty("--h", Math.min(100, 100 / cap * 100));
	fader.style.setProperty("--p", settings.volume / cap * 100);
	state.volumeField.show(settings.volume);
	element("volumeDb").textContent = settings.volume === 0 ? "Silent" : `${signed(20 * Math.log10(settings.volume / 100), 1)} dB`;
	element("big").classList.toggle("is-hot", isHot(settings));
	element("big").classList.toggle("is-muted", settings.muted);
	element("big").classList.toggle("is-long", String(Math.round(settings.volume)).length > 5);
	element("ghost").setAttribute("aria-pressed", String(settings.muted));
	element("ghost").textContent = settings.muted ? "Unghost" : "Ghost";

	tier.hidden = !prefs.showTiers;
	tier.textContent = tierName;
	tier.classList.toggle("is-hot", settings.volume > 600);
	if (state.lastTier && state.lastTier !== tierName) animate(tier, "is-pulsing");
	state.lastTier = tierName;

	element("ladder").hidden = !prefs.showTiers;
	for (const [entry, button] of ladderButtons) {
		button.setAttribute("aria-pressed", String(!settings.muted && tierName === entry.name));
		button.classList.toggle("is-hot", entry.volume > prefs.normalCap);
		button.title = `${entry.volume}%`;
	}

}

function renderTools() {

	for (const button of element("compare").children) {
		button.setAttribute("role", "radio");
		button.setAttribute("aria-checked", String(button.dataset.value === state.compare));
		button.disabled = !state.isActive;
	}
	element("undo").disabled = !state.past.length;
	element("redo").disabled = !state.future.length;
	element("slotA").setAttribute("aria-pressed", String(state.slot === "A"));
	element("slotB").setAttribute("aria-pressed", String(state.slot === "B"));

	const record = element("record");
	const isRecording = state.isActive && state.recordingSince > 0;
	record.classList.toggle("is-recording", isRecording);
	record.setAttribute("aria-pressed", String(isRecording));
	if (!isRecording) {
		record.textContent = "Record";
		return;
	}
	const seconds = Math.max(0, Math.floor((Date.now() - state.recordingSince) / 1000));
	record.textContent = `Stop ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

}

function renderToggles() {

	const settings = state.settings;
	for (const button of element("toggles").children) {
		const key = button.dataset.key;
		const isOn = key === "maxx" ? isMaxxOn(settings) : settings[key];
		button.setAttribute("aria-pressed", String(isOn));
		if (key === "ultimate") button.querySelector("span").textContent = `Slider to ${isOn ? state.prefs.ascendCap : state.prefs.normalCap}%`;
		if (key !== "limiter") continue;
		button.classList.toggle("is-warning", !isOn);
		button.querySelector("strong").textContent = isOn ? "Cope limiter" : "No cope";
		button.querySelector("span").textContent = isOn ? "Clean peaks" : "Clipping at full scale";
	}
	element("quickMaxx").hidden = !isMaxxOn(settings);
	element("quickSmash").hidden = !settings.distortion;

	for (const [toggle, button] of quickButtons) button.setAttribute("aria-pressed", String(state.settings[toggle.key]));
	element("maxxEverything").textContent = isMaxxOn(settings) ? "Unmaxx" : "Maxx it";

}

function renderFlags() {

	const settings = state.settings;
	const count = loudStages.filter(key => settings[key]).length + (settings.night > 0 ? 1 : 0) + (settings.postGain !== 0 ? 1 : 0);
	const isEq = settings.eq.some(gain => gain !== 0) || settings.bass || settings.treble || settings.presence || settings.lowCut > 20 || settings.highCut < 20000;
	const isChannels = settings.swap || settings.mono || settings.invertLeft || settings.invertRight || settings.gainLeft !== 0 || settings.gainRight !== 0 || settings.delay > 0;
	const isVoice = isChannels || settings.pitch !== 0 || settings.cents !== 0 || settings.formant !== 0 || settings.vocals !== "normal" || settings.npc || settings.echo || settings.reverb || settings.balance !== 0 || settings.width !== 100 || settings.center !== 0;
	const flags = { loud: count ? String(count) : "", eq: isEq ? "•" : "", voice: isVoice ? "•" : "", smash: settings.distortion ? "•" : "", route: state.isActive ? "•" : "" };
	for (const flag of document.querySelectorAll("[data-flag]")) flag.textContent = flags[flag.dataset.flag];

}

function presetProgress(preset) {

	const value = state.stats[preset.unlock.stat] ?? 0;
	const minutes = milliseconds => Math.floor(milliseconds / 60000);
	return `${preset.unlock.text} · ${minutes(value)}/${minutes(preset.unlock.value)} min`;

}

function renderPresets() {

	for (const [preset, target, button, detail] of presetButtons) {
		const isLocked = !isUnlocked(preset, state.stats);
		button.disabled = isLocked;
		button.classList.toggle("is-locked", isLocked);
		if (preset.unlock) detail.textContent = isLocked ? presetProgress(preset) : `${target.volume}%`;
		button.setAttribute("aria-pressed", String(!isLocked && settingsMatch(target, state.settings)));
	}
	for (const [preset, row, star] of userPresetRows) {
		row.classList.toggle("is-active", settingsMatch(presetSettings(preset), state.settings));
		star.setAttribute("aria-pressed", String(state.prefs.newTabs === preset.id));
	}

}

function renderStats() {

	const stats = state.stats;
	const minutes = value => `${Math.floor((value ?? 0) / 60000)} min`;
	const cells = [
		["Boosted", minutes(stats.boostedMs)],
		["Ascended", minutes(stats.ascendedMs)],
		["Bonesmashed", minutes(stats.smashedMs)],
		["Peak volume", `${Math.round(stats.peakVolume ?? 0)}%`],
	];
	element("statGrid").replaceChildren(...cells.map(([label, value]) => {
		const cell = el("div", "stat");
		cell.append(el("strong", "", value), el("span", "", label));
		return cell;
	}));

}

function render() {

	renderStatus();
	renderVolume();
	renderTools();
	renderToggles();
	renderFlags();
	for (const update of updaters) update(state.settings);
	renderPresets();

}

function fillSelect(select, options, value) {

	select.replaceChildren(...options.map(([optionValue, text]) => new Option(text, optionValue)));
	select.value = options.some(([optionValue]) => optionValue === value) ? value : options[0][0];

}

function renderRoute() {

	const prefs = state.prefs;
	const plan = planRoute();
	const cable = state.inputs.find(device => isVirtualDevice(device.label));
	const savedSource = state.inputs.find(device => device.deviceId === prefs.source) ?? state.inputs.find(device => device.label && device.label === prefs.sourceLabel);
	const savedOutput = state.outputs.find(device => device.deviceId === prefs.output) ?? state.outputs.find(device => device.label && device.label === prefs.outputLabel);
	const savedMirror = state.outputs.find(device => device.deviceId === prefs.mirror) ?? state.outputs.find(device => device.label && device.label === prefs.mirrorLabel);
	const name = (device, index, word) => device.label || `${word} ${index + 1}`;

	fillSelect(element("source"), [
		["auto", cable ? `Auto · ${cable.label}` : "Auto · virtual cable (none found)"],
		["loopback", "System loopback · needs a second output device"],
		...state.inputs.map((device, index) => [device.deviceId, name(device, index, "Input")]),
	], prefs.source === "auto" || prefs.source === "loopback" ? prefs.source : savedSource?.deviceId ?? "auto");

	const auto = prefs.output === "auto" ? resolveOutput() : (currentOutput() ?? resolveOutput());
	fillSelect(element("sink"), [
		["auto", auto ? `Auto · ${auto.label}` : "Auto · current speakers"],
		...state.outputs.map((device, index) => [device.deviceId, name(device, index, "Output")]),
	], prefs.output === "auto" ? "auto" : savedOutput?.deviceId ?? "auto");

	fillSelect(element("mirror"), [
		["", "Off"],
		...state.outputs.map((device, index) => [device.deviceId, name(device, index, "Output")]),
	], savedMirror?.deviceId ?? "");

	const guess = state.windowsDevices.find(device => /cable input|voicemeeter input|voicemeeter vaio/i.test(device.name));
	fillSelect(element("routeDevice"), [
		["", guess ? `Auto · ${guess.name}` : "Auto · first virtual cable"],
		...state.windowsDevices.map(device => [device.name, device.name]),
	], prefs.routeDevice);
	element("autoRoute").checked = prefs.autoRoute;
	element("muteOriginal").checked = prefs.muteOriginal;

	const steps = [
		[Boolean(cable), cable ? `Virtual cable found: ${cable.label}` : "No virtual cable yet. Hit the install button below"],
		[!plan.error, plan.error ?? `Route ready: ${plan.source.label} → ${plan.output.label}`],
		[state.isActive, state.isActive ? "Boosting. Every app that plays into the Windows output gets mogged." : "Flip the power switch"],
	];
	element("routeSteps").replaceChildren(...steps.map(([isDone, text]) => el("li", isDone ? "is-done" : "", text)));
	element("installCable").hidden = Boolean(cable) || state.info.platform !== "win32";
	element("routeStatus").textContent = state.routeNote || (state.info.platform === "win32" ? "" : "Whole-PC routing is built for Windows.");
	renderFlags();
	renderStatus();

}

function buildHero() {

	state.volumeField = createNumberField({ label: "Volume", unit: "%", min: 0, max: volumeControl.max }, value => change({ volume: Math.round(value), muted: false }));
	state.volumeField.element.id = "volumeInput";
	element("big").prepend(state.volumeField.element);

	for (const entry of tiers) {
		const button = el("button");
		button.type = "button";
		button.append(el("strong", "", entry.name), el("span", "", `${entry.volume}`));
		button.addEventListener("click", () => change({ volume: entry.volume, muted: false }));
		element("ladder").append(button);
		ladderButtons.push([entry, button]);
	}

}

function buildQuick() {

	const smashDrive = sections.find(section => section.id === "smash").controls.find(control => control.key === "distDrive");
	const push = sections.find(section => section.id === "push").controls[0];
	for (const [id, spec, isHotControl] of [["quickMaxx", maxxControl, false], ["quickSmash", smashDrive, true], ["quickPush", push, true]]) {
		const range = createRange(spec, store);
		range.element.id = id;
		range.element.classList.toggle("is-hot", isHotControl);
		element("quickSliders").append(range.element);
		updaters.push(range.update);
	}

	for (const toggle of quickToggles) {
		const button = el("button", "", toggle.label);
		button.type = "button";
		button.title = toggle.title;
		button.addEventListener("click", () => change({ [toggle.key]: !state.settings[toggle.key] }));
		element("quick").append(button);
		quickButtons.push([toggle, button]);
	}

}

function buildPanels() {

	const strength = createRange(maxxControl, store);
	element("loudStrength").append(strength.element);
	updaters.push(strength.update);
	updaters.push(createSections(element("panel-loud"), sections.filter(section => section.group === "loud"), store));

	updaters.push(createEqualizer(element("equalizer"), store));
	updaters.push(createSections(element("panel-eq"), sections.filter(section => section.group === "eq"), store));

	const voices = createPresetChips(voicePresets, store);
	element("voicePresets").append(voices.element);
	updaters.push(voices.update);
	updaters.push(createSections(element("panel-voice"), sections.filter(section => section.group === "voice"), store));

	updaters.push(createSections(element("panel-smash"), sections.filter(section => section.group === "smash"), store));

	const mirrorStore = {
		get settings() {
			return { mirrorVolume: state.prefs.mirrorVolume };
		},
		change(patch) {
			state.prefs.mirrorVolume = patch.mirrorVolume;
			save("prefs", state.prefs, 150);
			mirror.update(mirrorStore.settings);
			applyMirror();
		},
	};
	const mirror = createRange({ key: "mirrorVolume", label: "Second output level", min: 0, max: 200, typeMax: 1000, step: 1, reset: 100, unit: "%" }, mirrorStore);
	element("mirrorVolume").append(mirror.element);
	prefUpdaters.push(() => mirror.update(mirrorStore.settings));

}

function buildPresets() {

	const add = (container, preset, className) => {
		const target = presetSettings(preset);
		const button = el("button", [isHot(target) ? "is-hot" : "", className].join(" ").trim());
		const detail = el("span", "", className === "is-over" ? preset.description : `${target.volume}%`);
		button.type = "button";
		button.title = preset.description;
		button.append(el("strong", "", preset.name), detail);
		button.addEventListener("click", () => {
			if (isUnlocked(preset, state.stats)) change(presetSettings(preset));
		});
		container.append(button);
		presetButtons.push([preset, target, button, detail]);
	};

	for (const preset of builtInPresets.filter(item => item.id !== "builtin:over")) add(element("builtIns"), preset, "");
	for (const preset of secretPresets) add(element("secrets"), preset, "is-secret");
	add(element("overSlot"), builtInPresets.find(item => item.id === "builtin:over"), "is-over");

}

function systemGroup(title, note) {

	const group = el("section", "group is-static");
	group.append(el("h3", "", title));
	if (note) group.append(el("p", "hint", note));
	element("systemGroups").append(group);
	return group;

}

function prefSwitch(group, key, label, tip, onChange) {

	const row = el("div", "switch-row");
	const text = el("span", "", label);
	const toggle = createToggle(label, false, isOn => {
		state.prefs[key] = isOn;
		savePrefs();
		onChange?.(isOn);
	});
	if (tip) text.title = tip;
	row.append(text, toggle.element);
	group.append(row);
	prefUpdaters.push(() => {
		toggle.input.checked = state.prefs[key];
	});

}

function prefNumber(group, key, label, unit) {

	const row = el("div", "switch-row");
	const box = el("span", "box");
	const [min, max] = prefLimits[key];
	const field = createNumberField({ label, unit, min, max }, value => {
		state.prefs[key] = Math.round(value);
		savePrefs();
	});
	box.append(field.element, el("span", "unit", unit));
	row.append(el("span", "", label), box);
	group.append(row);
	prefUpdaters.push(() => field.show(state.prefs[key]));

}

function prefSelect(group, key, label, options, onChange) {

	const row = el("div", "switch-row");
	const select = el("select");
	select.setAttribute("aria-label", label);
	select.addEventListener("change", () => {
		state.prefs[key] = select.value;
		savePrefs();
		onChange?.();
	});
	row.append(el("span", "", label), select);
	group.append(row);
	prefUpdaters.push(() => fillSelect(select, options(), state.prefs[key]));

}

function prefColor(group, key, label) {

	const row = el("div", "switch-row");
	const input = el("input");
	input.type = "color";
	input.setAttribute("aria-label", label);
	input.addEventListener("input", () => {
		state.prefs[key] = input.value;
		savePrefs();
	});
	row.append(el("span", "", label), input);
	group.append(row);
	prefUpdaters.push(() => {
		input.value = state.prefs[key];
	});

}

function acceleratorFrom(event) {

	const codes = {
		ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Space: "Space", Enter: "Return", Tab: "Tab",
		Backspace: "Backspace", Delete: "Delete", Insert: "Insert", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
		Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/", Semicolon: ";", BracketLeft: "[", BracketRight: "]", Backquote: "`",
		NumpadAdd: "numadd", NumpadSubtract: "numsub", NumpadMultiply: "nummult", NumpadDivide: "numdiv",
		MediaPlayPause: "MediaPlayPause", MediaTrackNext: "MediaNextTrack", MediaTrackPrevious: "MediaPreviousTrack", MediaStop: "MediaStop",
	};
	const code = event.code;
	let key = codes[code] ?? "";
	if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
	else if (/^Digit\d$/.test(code)) key = code.slice(5);
	else if (/^F\d{1,2}$/.test(code)) key = code;
	else if (/^Numpad\d$/.test(code)) key = `num${code.slice(6)}`;
	if (!key) return "";

	const modifiers = [];
	if (event.ctrlKey) modifiers.push("Ctrl");
	if (event.altKey) modifiers.push("Alt");
	if (event.shiftKey) modifiers.push("Shift");
	if (event.metaKey) modifiers.push("Super");
	if (!modifiers.length && !/^(F\d{1,2}|Media)/.test(key)) return "";
	return [...modifiers, key].join("+");

}

async function applyHotkeys() {

	const hotkeys = { ...state.prefs.hotkeys, ...(window.soundboard?.hotkeys() ?? {}) };
	state.failedHotkeys = await desktop.setHotkeys(hotkeys).catch(() => []);
	for (const update of prefUpdaters) update();

}

function buildHotkeys(group) {

	const list = el("ul", "preset-list hotkeys");
	group.append(list);

	for (const [command, label] of commands) {
		const row = el("li");
		const name = el("span", "name", label);
		const bind = el("button", "mini");
		const clear = el("button", "mini", "Clear");
		bind.type = "button";
		clear.type = "button";
		row.append(name, bind, clear);
		list.append(row);

		bind.addEventListener("click", () => {
			if (state.capturing === command) {
				state.capturing = null;
			} else {
				state.capturing = command;
				desktop.setHotkeys({});
			}
			for (const update of prefUpdaters) update();
			if (!state.capturing) applyHotkeys();
		});
		clear.addEventListener("click", () => {
			delete state.prefs.hotkeys[command];
			state.capturing = null;
			savePrefs();
			applyHotkeys();
		});
		prefUpdaters.push(() => {
			const accelerator = state.prefs.hotkeys[command] ?? "";
			const isFailed = state.failedHotkeys.includes(command);
			bind.textContent = state.capturing === command ? "Press keys…" : accelerator || "Set";
			bind.setAttribute("aria-pressed", String(state.capturing === command));
			bind.classList.toggle("is-failed", isFailed);
			bind.title = isFailed ? "Another app already owns this shortcut" : "Click, then press the shortcut";
			clear.disabled = !accelerator;
		});
	}

}

function backupPayload() {
	return { app: "blackpill-booster", version: 7, last: state.settings, presets: state.presets, prefs: state.prefs, stats: state.stats };
}

async function importBackup(status) {

	try {
		const text = await desktop.importBackup();
		if (!text) return;
		const parsed = JSON.parse(text);
		if (!parsed || typeof parsed !== "object") throw new Error("empty");
		state.presets = migratePresets(parsed);
		state.prefs = mergePrefs(parsed.prefs);
		state.stats = parsed.stats && typeof parsed.stats === "object" ? parsed.stats : state.stats;
		await desktop.saveStore({ presets: state.presets, prefs: state.prefs, stats: state.stats });
		if (parsed.last) change(mergeSettings(parsed.last));
		savePrefs();
		renderUserPresets();
		renderStats();
		applyHotkeys();
		status.textContent = `Imported ${state.presets.length} presets and all preferences.`;
	} catch {
		status.textContent = "That file isn't a Blackpill backup.";
	}

}

function buildSystem() {

	const startup = systemGroup("Startup and window");
	prefSwitch(startup, "startWithWindows", "Start with Windows", "", isOn => desktop.setAutostart(isOn));
	prefSwitch(startup, "startMinimized", "Start hidden in the tray", "Applies when Windows starts the app");
	prefSwitch(startup, "boostOnLaunch", "Start boosting on launch");
	prefSwitch(startup, "closeToTray", "Closing the window keeps it running in the tray");
	prefSwitch(startup, "alwaysOnTop", "Always on top");
	prefSelect(startup, "newTabs", "On launch use", () => [["last", "Last settings"], ...unlockedPresets().map(preset => [preset.id, preset.name])]);

	const controls = systemGroup("Volume controls", "The slider caps only set how far the slider reaches. Typed volumes have no cap.");
	prefNumber(controls, "volumeStep", "Volume step", "%");
	prefNumber(controls, "normalCap", "Slider reach", "%");
	prefNumber(controls, "ascendCap", "Slider reach when ascended", "%");
	prefSwitch(controls, "showSpectrum", "Show the spectrum");
	prefSwitch(controls, "showTiers", "Show PSL tiers");

	const engine = systemGroup("Engine");
	prefSelect(engine, "latency", "Latency", () => [["interactive", "Lowest delay"], ["balanced", "Balanced"], ["playback", "Most stable"]], restart);
	prefSwitch(engine, "cpuGuard", "CPU guard", "Drops oversampling and HD pitch when the PC can't keep up", isOn => state.engine?.setGuardEnabled(isOn));

	const look = systemGroup("Colors");
	prefColor(look, "accent", "Accent");
	prefColor(look, "hot", "Danger");
	const resetColors = el("button", "ghost", "Reset colors");
	resetColors.type = "button";
	resetColors.addEventListener("click", () => {
		state.prefs.accent = defaultPrefs().accent;
		state.prefs.hot = defaultPrefs().hot;
		savePrefs();
	});
	look.append(resetColors);

	const recording = systemGroup("Recordings");
	const folder = el("p", "hint");
	const folderButtons = el("div", "button-row");
	const choose = el("button", "ghost", "Change folder");
	const open = el("button", "ghost", "Open folder");
	choose.type = "button";
	open.type = "button";
	choose.addEventListener("click", async () => {
		const picked = await desktop.chooseRecordingFolder();
		if (!picked) return;
		state.prefs.recordFolder = picked;
		await desktop.saveStore({ prefs: state.prefs });
		savePrefs();
	});
	open.addEventListener("click", () => desktop.openRecordingFolder());
	folderButtons.append(choose, open);
	recording.append(folder, folderButtons);
	prefUpdaters.push(async () => {
		folder.textContent = await desktop.recordingFolder();
	});

	buildHotkeys(systemGroup("Global hotkeys", "Work everywhere in Windows, even in fullscreen games. Click a shortcut, then press the keys."));

	const backup = systemGroup("Backup");
	const backupButtons = el("div", "button-row");
	const status = el("p", "hint");
	const exportButton = el("button", "solid", "Export backup");
	const importButton = el("button", "ghost", "Import backup");
	const resetButton = el("button", "ghost danger", "Reset everything");
	for (const button of [exportButton, importButton, resetButton]) button.type = "button";
	status.setAttribute("role", "status");
	exportButton.addEventListener("click", async () => {
		const file = await desktop.exportBackup(JSON.stringify(backupPayload(), null, "\t"));
		if (file) status.textContent = `Saved ${file}`;
	});
	importButton.addEventListener("click", () => importBackup(status));
	resetButton.addEventListener("click", async () => {
		if (resetButton.dataset.armed !== "true") {
			resetButton.dataset.armed = "true";
			resetButton.textContent = "Click again to wipe everything";
			setTimeout(() => {
				resetButton.dataset.armed = "false";
				resetButton.textContent = "Reset everything";
			}, 4000);
			return;
		}
		await stop();
		for (const timer of state.saveTimers.values()) clearTimeout(timer);
		state.saveTimers.clear();
		await desktop.resetStore();
		await desktop.setAutostart(false);
		location.reload();
	});
	backupButtons.append(exportButton, importButton, resetButton);
	backup.append(backupButtons, status);

}

async function copyCode(settings, name) {

	const status = element("codeStatus");
	try {
		const code = await encodeShareCode(settings, name);
		await navigator.clipboard.writeText(code);
		status.textContent = `Copied ${name ? `"${name}" ` : ""}as a ${code.length}-character code. Paste it anywhere.`;
	} catch {
		status.textContent = "Couldn't copy the code. Click the window first, then try again.";
	}

}

function savePreset(name, settings) {

	state.presets.push({ id: `preset:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.slice(0, 40), settings: { ...settings, muted: false } });
	return desktop.saveStore({ presets: state.presets });

}

function renderUserPresets() {

	userPresetRows.length = 0;
	element("userPresets").replaceChildren(...state.presets.map(preset => {
		const row = el("li");
		const name = el("button", "name", preset.name);
		const share = el("button", "mini", "Share");
		const star = el("button", "mini", "Launch");
		const remove = el("button", "mini", "Delete");

		for (const button of [name, share, star, remove]) button.type = "button";
		name.title = "Apply this preset";
		share.title = "Copy a share code for this preset";
		star.title = "Load this preset every time the app starts";
		remove.setAttribute("aria-label", `Delete ${preset.name}`);
		row.append(name, share, star, remove);
		userPresetRows.push([preset, row, star]);

		name.addEventListener("click", () => change(presetSettings(preset)));
		share.addEventListener("click", () => copyCode(presetSettings(preset), preset.name));
		star.addEventListener("click", () => {
			state.prefs.newTabs = state.prefs.newTabs === preset.id ? "last" : preset.id;
			savePrefs();
		});
		remove.addEventListener("click", async () => {
			state.presets = state.presets.filter(item => item.id !== preset.id);
			if (state.prefs.newTabs === preset.id) state.prefs.newTabs = "last";
			await desktop.saveStore({ presets: state.presets, prefs: state.prefs });
			renderUserPresets();
			savePrefs();
		});
		return row;
	}));
	renderPresets();

}

function startLevels() {

	stopLevels();
	state.levelTimer = setInterval(pollLevels, 50);

}

function stopLevels() {

	clearInterval(state.levelTimer);
	state.meterPeak = -Infinity;
	state.meterReduction = 0;
	state.peaks = [];
	element("outputBar").style.width = "100%";
	element("loudnessBar").style.width = "100%";
	element("reductionBar").style.width = "0%";
	element("outputText").textContent = "−∞";
	element("loudnessText").textContent = "−∞";
	element("reductionText").textContent = "0.0";
	element("chainText").textContent = "Not boosting yet. Hit the power switch.";
	element("guard").hidden = true;
	for (const live of document.querySelectorAll("[data-meter]")) live.textContent = "Start boosting to watch it work.";
	drawSpectrum(null);

}

const formatLevel = value => Number.isFinite(value) && value > -99 ? value.toFixed(1).replace("-", "−") : "−∞";

function describeChain(levels) {

	const parts = [];
	const settings = state.settings;
	if (state.compare === "original") return "Original sound · no processing";
	if (settings.agc) parts.push(`Auto-mog ${signed(levels.agc, 1)} dB`);
	if (settings.multiband) parts.push(`Squeeze ${Math.abs(Math.min(...levels.reduction)).toFixed(1)} dB`);
	if (settings.clip) parts.push(`Shave ${levels.shaved.toFixed(1)} dB`);
	parts.push(settings.limiter ? `Limiter ${state.meterReduction < -.05 ? signed(state.meterReduction, 1) : "0.0"} dB` : "No limiter · clipping");
	if (settings.postGain !== 0) parts.push(`Push ${signed(settings.postGain, 1)} dB`);
	if (levels.load) parts.push(`CPU ${Math.round(levels.load * 100)}%`);
	return parts.join(" · ");

}

function pollLevels() {

	if (!state.engine || document.hidden) return;

	const isSpectrum = state.panel === "mog" && state.prefs.showSpectrum;
	const levels = state.engine.report(isSpectrum, state.spectrumView);
	if (typeof levels.peak !== "number") return;

	const push = state.compare === "original" ? 0 : state.settings.postGain;
	const peak = levels.peak > 0 ? 20 * Math.log10(levels.peak) + push : -Infinity;
	const reduction = levels.gain < 1 ? 20 * Math.log10(levels.gain) : 0;
	state.meterPeak = Math.max(peak, state.meterPeak - 1.5);
	state.meterReduction = Math.min(reduction, state.meterReduction + 1);

	const outputLevel = Number.isFinite(state.meterPeak) ? Math.max(0, Math.min(1, (state.meterPeak + 48) / 48)) : 0;
	const loudnessLevel = Math.max(0, Math.min(1, (levels.lufs + 40) / 40));
	element("outputBar").style.width = `${100 - outputLevel * 100}%`;
	element("outputText").textContent = state.meterPeak > 0 ? `+${state.meterPeak.toFixed(1)} clip` : formatLevel(state.meterPeak);
	element("outputText").classList.toggle("is-hot", state.meterPeak > 0);
	element("loudnessBar").style.width = `${100 - loudnessLevel * 100}%`;
	element("loudnessText").textContent = `${formatLevel(levels.lufs)} LUFS`;
	element("reductionBar").style.width = `${Math.min(1, -state.meterReduction / 24) * 100}%`;
	element("reductionText").textContent = state.meterReduction.toFixed(1).replace("-", "−");
	element("guard").hidden = !levels.isGuarded;
	element("chainText").textContent = describeChain(levels);

	const meters = {
		agc: `Riding gain ${signed(levels.agc, 1)} dB`,
		bands: `Squeezing low ${Math.abs(levels.reduction[0]).toFixed(1)} · mid ${Math.abs(levels.reduction[1]).toFixed(1)} · high ${Math.abs(levels.reduction[2]).toFixed(1)} dB`,
		clip: levels.shaved > 0 ? `Shaving ${levels.shaved.toFixed(1)} dB off peaks` : "Peaks are under the clip point",
		deess: levels.deess < -.05 ? `Taming esses by ${Math.abs(levels.deess).toFixed(1)} dB` : "No harsh esses right now",
	};
	for (const live of document.querySelectorAll("[data-meter]")) live.textContent = meters[live.dataset.meter];

	if (state.recordingSince) renderTools();
	if (isSpectrum) drawSpectrum(levels.spectrum);

}

function drawSpectrum(values) {

	const canvas = element("spectrum");
	canvas.hidden = !state.prefs.showSpectrum;
	const width = canvas.clientWidth;
	const height = canvas.clientHeight;
	if (!width) return;

	const ratio = window.devicePixelRatio || 1;
	if (canvas.width !== Math.round(width * ratio)) {
		canvas.width = Math.round(width * ratio);
		canvas.height = Math.round(height * ratio);
	}
	const graphics = canvas.getContext("2d");
	graphics.setTransform(ratio, 0, 0, ratio, 0, 0);
	graphics.clearRect(0, 0, width, height);

	const styles = getComputedStyle(document.documentElement);
	const accent = styles.getPropertyValue("--accent").trim();
	const hot = styles.getPropertyValue("--hot").trim();
	const line = styles.getPropertyValue("--line").trim();
	const muted = styles.getPropertyValue("--muted").trim();
	graphics.fillStyle = line;
	for (let row = 1; row < 4; row++) graphics.fillRect(0, Math.round(height * row / 4), width, 1);
	graphics.font = "800 11px 'Barlow Condensed', sans-serif";
	graphics.fillStyle = muted;
	graphics.textAlign = "right";
	graphics.fillText(state.spectrumView === "before" ? "BEFORE" : "AFTER", width - 4, 11);
	if (!values) return;

	const gap = 2;
	const barWidth = (width - gap * (values.length - 1)) / values.length;
	for (const [index, value] of values.entries()) {
		state.peaks[index] = Math.max(value, (state.peaks[index] ?? 0) - .012);
		const x = index * (barWidth + gap);
		const barHeight = Math.max(1, value * (height - 4));
		graphics.fillStyle = value > .85 ? hot : accent;
		graphics.fillRect(x, height - barHeight, barWidth, barHeight);
		graphics.fillStyle = state.peaks[index] > .85 ? hot : accent;
		graphics.fillRect(x, height - state.peaks[index] * (height - 4) - 3, barWidth, 2);
	}

}

function selectPanel(name) {

	state.panel = element(`panel-${name}`) ? name : "mog";
	for (const button of document.querySelectorAll(".tabs button")) {
		const isSelected = button.dataset.panel === state.panel;
		button.setAttribute("aria-selected", String(isSelected));
		element(`panel-${button.dataset.panel}`).hidden = !isSelected;
	}
	document.querySelector("main").scrollTop = 0;
	try {
		localStorage.setItem("panel", state.panel);
	} catch {
		state.panel = name;
	}
	render();
	if (state.panel === "route") loadDevices();
	if (state.panel === "presets") renderStats();
	if (state.panel === "mog") drawSpectrum(null);

}

function nudgeVolume(direction) {

	const { volume } = state.settings;
	const base = state.prefs.volumeStep;
	const scale = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(volume, 1) / state.prefs.normalCap)) + 1);
	const step = (direction > 0 ? volume >= state.prefs.normalCap : volume > state.prefs.normalCap) ? base * scale : base;
	change({ volume: Math.max(0, volume + step * direction), muted: false });

}

function reroll() {

	const pick = (min, max, step) => roundTo(min + Math.random() * (max - min), step);
	const shapes = ["soft", "hard", "fuzz", "fold", "square"];
	change({
		distortion: true,
		distType: shapes[Math.floor(Math.random() * shapes.length)],
		distDrive: pick(12, 60, .5),
		distBias: pick(-60, 60, 1),
		distBits: Math.random() < .5 ? 16 : pick(3, 12, 1),
		distRate: Math.random() < .5 ? 1 : pick(2, 12, 1),
		distTone: pick(2000, 20000, 1),
		distMix: pick(60, 100, 1),
		distLevel: pick(-6, 0, .5),
	});

}

function recordHeartbeat() {

	if (!state.isActive || state.settings.muted) return;

	const settings = state.settings;
	const next = { boostedMs: 0, ascendedMs: 0, smashedMs: 0, peakVolume: 0, ...state.stats };
	const before = unlockedPresets().length;
	if (settings.volume > 100) next.boostedMs += 15000;
	if (settings.ultimate) next.ascendedMs += 15000;
	if (settings.distortion) next.smashedMs += 15000;
	next.peakVolume = Math.max(next.peakVolume, settings.volume);
	state.stats = next;
	save("stats", next, 0);
	if (unlockedPresets().length > before) render();
	if (state.panel === "presets") renderStats();

}

function bindDeviceSelect(id, key, labelKey, list, after) {

	element(id).addEventListener("change", event => {
		const value = event.target.value;
		state.prefs[key] = value;
		state.prefs[labelKey] = list().find(device => device.deviceId === value)?.label ?? "";
		save("prefs", state.prefs, 150);
		renderRoute();
		after();
	});

}

function bindEvents() {

	for (const button of document.querySelectorAll(".tabs button")) {
		button.addEventListener("click", () => selectPanel(button.dataset.panel));
	}

	element("power").addEventListener("change", event => {
		if (event.target.checked) start();
		else stop();
	});

	element("volume").addEventListener("input", event => change({ volume: Number(event.target.value), muted: false }));
	element("volume").addEventListener("dblclick", () => change({ volume: 100, muted: false }));
	element("volumeDown").addEventListener("click", () => nudgeVolume(-1));
	element("volumeUp").addEventListener("click", () => nudgeVolume(1));
	element("ghost").addEventListener("click", () => change({ muted: !state.settings.muted }));
	element("undo").addEventListener("click", () => stepHistory(true));
	element("redo").addEventListener("click", () => stepHistory(false));
	for (const target of [element("big"), element("volume")]) {
		target.addEventListener("wheel", event => {
			event.preventDefault();
			nudgeVolume(event.deltaY < 0 ? 1 : -1);
		}, { passive: false });
	}
	element("multipliers").addEventListener("click", event => {
		const button = event.target.closest("button");
		if (!button) return;
		change({ volume: Math.round(Math.max(1, state.settings.volume) * Number(button.dataset.factor)), muted: false });
	});

	element("compare").addEventListener("click", event => {
		const button = event.target.closest("button");
		if (button && state.isActive) setCompare(button.dataset.value);
	});

	element("slotA").addEventListener("click", () => selectSlot("A"));
	element("slotB").addEventListener("click", () => selectSlot("B"));
	element("copySlot").addEventListener("click", () => {
		state.otherSlot = state.settings;
		const button = element("copySlot");
		button.textContent = `To ${state.slot === "A" ? "B" : "A"}`;
		setTimeout(() => {
			button.textContent = "Copy";
		}, 1200);
	});

	element("record").addEventListener("click", toggleRecord);
	element("panic").addEventListener("click", () => change(panicPatch()));

	element("toggles").addEventListener("click", event => {
		const button = event.target.closest("button");
		if (!button) return;
		const key = button.dataset.key;
		if (key === "maxx") change(maxxPatch(!isMaxxOn(state.settings), state.settings.maxxAmount));
		else change({ [key]: !state.settings[key] });
	});

	element("maxxEverything").addEventListener("click", () => change(maxxPatch(!isMaxxOn(state.settings), state.settings.maxxAmount)));
	element("reroll").addEventListener("click", reroll);

	element("spectrum").addEventListener("click", () => {
		state.spectrumView = state.spectrumView === "after" ? "before" : "after";
		state.peaks = [];
		drawSpectrum(null);
	});

	element("savePreset").addEventListener("submit", async event => {
		event.preventDefault();
		const input = element("presetName");
		const name = input.value.trim();
		if (!name) return;
		await savePreset(name, state.settings);
		input.value = "";
		renderUserPresets();
		savePrefs();
	});

	element("copyCode").addEventListener("click", () => copyCode(state.settings, ""));

	element("codeForm").addEventListener("submit", async event => {
		event.preventDefault();
		const status = element("codeStatus");
		try {
			const decoded = await decodeShareCode(element("codeInput").value);
			change(decoded.settings);
			status.textContent = `Applied ${decoded.name ? `"${decoded.name}"` : "the shared settings"}.`;
		} catch (error) {
			status.textContent = error.message;
		}
	});

	element("saveCode").addEventListener("click", async () => {
		const status = element("codeStatus");
		try {
			const decoded = await decodeShareCode(element("codeInput").value);
			await savePreset(decoded.name || "Shared preset", decoded.settings);
			renderUserPresets();
			status.textContent = `Saved "${decoded.name || "Shared preset"}" to your presets.`;
		} catch (error) {
			status.textContent = error.message;
		}
	});

	bindDeviceSelect("source", "source", "sourceLabel", () => state.inputs, restart);
	bindDeviceSelect("sink", "output", "outputLabel", () => state.outputs, restart);
	bindDeviceSelect("mirror", "mirror", "mirrorLabel", () => state.outputs, applyMirror);
	element("routeDevice").addEventListener("change", event => {
		state.prefs.routeDevice = event.target.value;
		save("prefs", state.prefs, 150);
		restart();
	});
	element("autoRoute").addEventListener("change", event => {
		state.prefs.autoRoute = event.target.checked;
		save("prefs", state.prefs, 150);
		restart();
	});
	element("muteOriginal").addEventListener("change", event => {
		state.prefs.muteOriginal = event.target.checked;
		save("prefs", state.prefs, 150);
		if (state.route?.source.kind === "loopback") restart();
	});
	element("refreshDevices").addEventListener("click", loadDevices);
	element("openSound").addEventListener("click", () => desktop.open("sound"));
	element("openMixer").addEventListener("click", () => desktop.open("mixer"));
	element("getCable").addEventListener("click", () => desktop.open("cable"));
	element("installCable").addEventListener("click", async event => {
		const button = event.target;
		const status = element("installStatus");
		button.disabled = true;
		status.hidden = false;
		status.textContent = "Downloading VB-CABLE from vb-audio.com and installing it. Approve the two Windows prompts.";
		const result = await desktop.installCable().catch(error => ({ ok: false, error: error.message }));
		await loadDevices();
		button.disabled = false;
		status.textContent = result?.ok ? "Driver installed. If no cable shows up above, restart the PC and rescan." : result?.error ?? "Setup failed.";
	});

	element("resetAll").addEventListener("click", () => change(defaultSettings()));
	element("openRecordings").addEventListener("click", () => desktop.openRecordingFolder());
	element("hideWindow").addEventListener("click", () => desktop.hide());
	element("quit").addEventListener("click", async () => {
		await stop();
		desktop.quit();
	});

	navigator.mediaDevices.addEventListener("devicechange", loadDevices);
	desktop.onCommand(runCommand);

	document.addEventListener("keydown", event => {
		if (state.capturing) {
			event.preventDefault();
			if (event.key === "Escape") {
				state.capturing = null;
				applyHotkeys();
				return;
			}
			const accelerator = acceleratorFrom(event);
			if (!accelerator) return;
			for (const [command, existing] of Object.entries(state.prefs.hotkeys)) {
				if (existing === accelerator) delete state.prefs.hotkeys[command];
			}
			state.prefs.hotkeys[state.capturing] = accelerator;
			state.capturing = null;
			savePrefs();
			applyHotkeys();
			return;
		}
		if (!(event.ctrlKey || event.metaKey) || event.target.closest("input[type='text'], input:not([type])")) return;
		const key = event.key.toLowerCase();
		if (key === "z" && !event.shiftKey) stepHistory(true);
		else if (key === "y" || (key === "z" && event.shiftKey)) stepHistory(false);
		else return;
		event.preventDefault();
	});

}

async function init() {

	buildHero();
	buildQuick();
	buildPanels();
	buildPresets();
	buildSystem();
	bindEvents();

	const [stored, info] = await Promise.all([desktop.loadStore(), desktop.info()]);
	state.info = info;
	state.prefs = mergePrefs(stored.prefs);
	state.presets = migratePresets(stored);
	state.stats = stored.stats && typeof stored.stats === "object" ? stored.stats : {};
	state.prefs.startWithWindows = info.isAutostart;

	const launch = state.prefs.newTabs !== "last" ? findPreset(state.prefs.newTabs, state.presets) : null;
	state.settings = launch && isUnlocked(launch, state.stats) ? presetSettings(launch) : mergeSettings(stored.last);
	element("version").textContent = info.version ? `v${info.version}` : "";
	document.body.classList.toggle("is-windows", info.platform === "win32");

	let panel = "mog";
	try {
		panel = localStorage.getItem("panel") ?? "mog";
	} catch {
		panel = "mog";
	}

	applyTheme(state.prefs);
	for (const update of prefUpdaters) update();
	renderUserPresets();
	selectPanel(panel);
	stopLevels();
	applyHotkeys();
	await loadDevices();
	setInterval(recordHeartbeat, 15000);
	if (state.prefs.boostOnLaunch) start();

}

init();
