// Soundboard tab: user sounds live in %APPDATA%\Blackpill Booster\sounds (main.js sounds:* IPC),
// the list and playback settings live in the store under "soundboard".
// Sounds play on their own AudioContext(s) so they work whether or not the booster is on.

(() => {
	const MAX_BYTES = 40 * 1024 * 1024;
	const MAX_SOUNDS = 200;
	const AUDIO_NAME = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm|weba)$/i;
	const $ = id => document.getElementById(id);

	const board = { sounds: [], volume: 100, output: "", outputLabel: "", monitor: "", monitorLabel: "", overlap: true };
	const buffers = new Map();
	const playing = new Map();
	const outputs = { main: null, monitor: null };
	let devices = [];
	let capturing = null;
	let armedDelete = null;
	let saveTimer = 0;
	let frame = 0;

	const make = (tag, className, text) => {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	};

	function sanitize(saved) {
		if (!saved || typeof saved !== "object") return;
		board.volume = Number.isFinite(saved.volume) ? Math.min(200, Math.max(0, saved.volume)) : 100;
		board.overlap = saved.overlap !== false;
		for (const key of ["output", "outputLabel", "monitor", "monitorLabel"]) board[key] = typeof saved[key] === "string" ? saved[key] : "";
		board.sounds = (Array.isArray(saved.sounds) ? saved.sounds : [])
			.filter(sound => sound && /^[a-z0-9]+\.[a-z0-9]{1,5}$/.test(sound.file))
			.slice(0, MAX_SOUNDS)
			.map(sound => ({
				id: String(sound.id || sound.file.split(".")[0]),
				name: String(sound.name || "Sound").slice(0, 40),
				file: sound.file,
				key: typeof sound.key === "string" ? sound.key.slice(0, 60) : "",
			}));
	}

	function persist() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => desktop.saveStore({ soundboard: board }), 200);
	}

	function status(text) {
		const node = $("soundStatus");
		node.hidden = !text;
		node.textContent = text || "";
	}

	// Audio

	const pickDevice = (id, label) => devices.find(device => device.deviceId === id) ?? devices.find(device => label && device.label === label);

	async function setSink(target, id, label) {
		const device = id ? pickDevice(id, label) : null;
		try {
			await target.context.setSinkId(device ? device.deviceId : "");
		} catch {
			await target.context.setSinkId("").catch(() => {});
		}
	}

	async function ensureOutputs() {
		if (!outputs.main) {
			const context = new AudioContext({ latencyHint: "interactive" });
			const gain = context.createGain();
			gain.connect(context.destination);
			outputs.main = { context, gain };
			await setSink(outputs.main, board.output, board.outputLabel);
		}
		const wantsMonitor = Boolean(board.monitor && pickDevice(board.monitor, board.monitorLabel));
		if (wantsMonitor && !outputs.monitor) {
			const context = new AudioContext({ latencyHint: "interactive" });
			const gain = context.createGain();
			gain.connect(context.destination);
			outputs.monitor = { context, gain };
			await setSink(outputs.monitor, board.monitor, board.monitorLabel);
		} else if (!wantsMonitor && outputs.monitor) {
			outputs.monitor.context.close().catch(() => {});
			outputs.monitor = null;
		}
		applyVolume();
		for (const target of Object.values(outputs)) {
			if (target && target.context.state !== "running") await target.context.resume().catch(() => {});
		}
		return Object.values(outputs).filter(Boolean);
	}

	function applyVolume() {
		const gain = (board.volume / 100) ** 2;
		for (const target of Object.values(outputs)) {
			if (target) target.gain.gain.setTargetAtTime(gain, target.context.currentTime, .01);
		}
	}

	function decoder() {
		if (!outputs.main) {
			const context = new AudioContext({ latencyHint: "interactive" });
			const gain = context.createGain();
			gain.connect(context.destination);
			outputs.main = { context, gain };
			setSink(outputs.main, board.output, board.outputLabel);
			applyVolume();
		}
		return outputs.main.context;
	}

	function load(sound) {
		if (!buffers.has(sound.file)) {
			const promise = desktop.readSound(sound.file).then(bytes => decoder().decodeAudioData(bytes));
			promise.catch(() => buffers.delete(sound.file));
			buffers.set(sound.file, promise);
		}
		return buffers.get(sound.file);
	}

	function stop(id) {
		const entry = playing.get(id);
		if (!entry) return;
		playing.delete(id);
		for (const source of entry.sources) {
			try {
				source.stop();
			} catch {}
		}
		renderPlaying();
	}

	function stopAll() {
		for (const id of [...playing.keys()]) stop(id);
	}

	async function play(id, isRestart = false) {
		const sound = board.sounds.find(item => item.id === id);
		if (!sound) return;
		if (playing.has(id)) {
			stop(id);
			if (!isRestart) return;
		}
		if (!board.overlap) stopAll();
		try {
			const [buffer, targets] = await Promise.all([load(sound), ensureOutputs()]);
			const sources = targets.map(target => {
				const source = target.context.createBufferSource();
				source.buffer = buffer;
				source.connect(target.gain);
				source.start();
				return source;
			});
			const entry = { sources, started: performance.now(), duration: buffer.duration * 1000 };
			sources[0].onended = () => {
				if (playing.get(id) !== entry) return;
				playing.delete(id);
				renderPlaying();
			};
			playing.set(id, entry);
			renderPlaying();
		} catch (error) {
			status(`Could not play "${sound.name}": ${error?.message || error}`);
		}
	}

	// Files

	async function importFiles(fileList) {
		const files = [...fileList];
		const errors = [];
		let added = 0;
		for (const file of files) {
			if (!(file.type.startsWith("audio/") || AUDIO_NAME.test(file.name))) {
				errors.push(`${file.name} is not an audio file`);
				continue;
			}
			if (file.size > MAX_BYTES) {
				errors.push(`${file.name} is over 40 MB`);
				continue;
			}
			if (board.sounds.length >= MAX_SOUNDS) {
				errors.push(`the board is full (${MAX_SOUNDS} sounds)`);
				break;
			}
			status(`Adding ${file.name}…`);
			try {
				const bytes = await file.arrayBuffer();
				const buffer = await decoder().decodeAudioData(bytes.slice(0));
				const stored = await desktop.importSound(file.name, bytes);
				buffers.set(stored, Promise.resolve(buffer));
				board.sounds.push({ id: stored.split(".")[0], name: file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "Sound", file: stored, key: "" });
				added++;
			} catch {
				errors.push(`${file.name} could not be read as audio`);
			}
		}
		persist();
		render();
		if (errors.length) status(`Added ${added}. Skipped: ${errors.join("; ")}.`);
		else status(added ? `Added ${added} sound${added === 1 ? "" : "s"}.` : "");
	}

	async function remove(id) {
		const sound = board.sounds.find(item => item.id === id);
		if (!sound) return;
		stop(id);
		board.sounds = board.sounds.filter(item => item.id !== id);
		buffers.delete(sound.file);
		await desktop.deleteSound(sound.file).catch(() => {});
		persist();
		render();
		if (sound.key) applyHotkeys();
	}

	// Hotkeys (registered globally together with the app's own hotkeys)

	function hotkeys() {
		const map = {};
		for (const sound of board.sounds) {
			if (sound.key) map[`sound:${sound.id}`] = sound.key;
		}
		return map;
	}

	function onCaptureKey(event) {
		if (!capturing) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		const sound = board.sounds.find(item => item.id === capturing);
		if (event.key === "Escape" || !sound) {
			capturing = null;
			render();
			return;
		}
		if (event.key === "Backspace" || event.key === "Delete") {
			sound.key = "";
		} else {
			const accelerator = acceleratorFrom(event);
			if (!accelerator) return;
			for (const other of board.sounds) {
				if (other.key === accelerator) other.key = "";
			}
			sound.key = accelerator;
		}
		capturing = null;
		persist();
		render();
		applyHotkeys().then(render);
	}

	// Rendering

	function renderPlaying() {
		for (const pad of document.querySelectorAll("#soundGrid .pad")) {
			const isPlaying = playing.has(pad.dataset.id);
			pad.classList.toggle("is-playing", isPlaying);
			if (!isPlaying) pad.querySelector(".pad-bar").style.width = "0";
		}
		if (playing.size && !frame) frame = requestAnimationFrame(tick);
	}

	function tick() {
		frame = 0;
		if (!playing.size) return;
		const now = performance.now();
		for (const [id, entry] of playing) {
			const bar = document.querySelector(`#soundGrid .pad[data-id="${id}"] .pad-bar`);
			if (bar) bar.style.width = `${Math.min(100, ((now - entry.started) / entry.duration) * 100)}%`;
		}
		frame = requestAnimationFrame(tick);
	}

	function startRename(pad, sound) {
		const button = pad.querySelector(".pad-play");
		const input = make("input", "pad-name-input");
		input.type = "text";
		input.maxLength = 40;
		input.value = sound.name;
		input.setAttribute("aria-label", "Sound name");
		let isDone = false;
		const finish = isSaved => {
			if (isDone) return;
			isDone = true;
			if (isSaved && input.value.trim()) {
				sound.name = input.value.trim().slice(0, 40);
				persist();
			}
			render();
		};
		input.addEventListener("keydown", event => {
			event.stopPropagation();
			if (event.key === "Enter") finish(true);
			if (event.key === "Escape") finish(false);
		});
		input.addEventListener("blur", () => finish(true));
		button.replaceWith(input);
		input.focus();
		input.select();
	}

	function render() {
		const grid = $("soundGrid");
		const failed = new Set(typeof state === "object" ? state.failedHotkeys : []);
		grid.replaceChildren(...board.sounds.map(sound => {
			const pad = make("div", "pad");
			pad.dataset.id = sound.id;
			const button = make("button", "pad-play");
			button.type = "button";
			button.title = `Play ${sound.name}`;
			button.append(make("span", "pad-name", sound.name));
			if (sound.key) button.append(make("span", `pad-key${failed.has(`sound:${sound.id}`) ? " is-taken" : ""}`, sound.key.replace(/CommandOrControl|Control/g, "Ctrl")));
			button.append(make("i", "pad-bar"));
			button.addEventListener("click", () => play(sound.id));

			const tools = make("div", "pad-tools");
			const keyButton = make("button", capturing === sound.id ? "is-armed" : "", capturing === sound.id ? "Press key" : sound.key ? "Rebind" : "Hotkey");
			keyButton.type = "button";
			keyButton.title = "Press a key combo to play this from anywhere. Backspace clears it, Esc cancels.";
			keyButton.addEventListener("click", () => {
				capturing = capturing === sound.id ? null : sound.id;
				render();
			});
			const renameButton = make("button", "", "Rename");
			renameButton.type = "button";
			renameButton.addEventListener("click", () => startRename(pad, sound));
			const deleteButton = make("button", armedDelete === sound.id ? "is-armed" : "", armedDelete === sound.id ? "Sure?" : "Delete");
			deleteButton.type = "button";
			deleteButton.addEventListener("click", () => {
				if (armedDelete === sound.id) {
					armedDelete = null;
					remove(sound.id);
					return;
				}
				armedDelete = sound.id;
				render();
				setTimeout(() => {
					if (armedDelete !== sound.id) return;
					armedDelete = null;
					render();
				}, 3000);
			});
			tools.append(keyButton, renameButton, deleteButton);
			pad.append(button, tools);
			return pad;
		}));
		$("soundEmpty").hidden = board.sounds.length > 0;
		renderPlaying();
	}

	function renderSettings() {
		const volume = $("soundVolume");
		volume.value = String(board.volume);
		volume.style.setProperty("--b", String(board.volume / 2));
		$("soundVolumeText").textContent = `${Math.round(board.volume)}%`;
		$("soundOverlap").checked = board.overlap;
		const options = devices.map((device, index) => [device.deviceId, device.label || `Output ${index + 1}`]);
		const fill = (select, list, id, label) => {
			select.replaceChildren(...list.map(([value, text]) => new Option(text, value)));
			const device = id ? pickDevice(id, label) : null;
			select.value = device ? device.deviceId : "";
		};
		fill($("soundOutput"), [["", "Default output"], ...options], board.output, board.outputLabel);
		fill($("soundMonitor"), [["", "Off"], ...options], board.monitor, board.monitorLabel);
	}

	async function loadDevices() {
		try {
			const list = await navigator.mediaDevices.enumerateDevices();
			devices = list.filter(device => device.kind === "audiooutput" && !["default", "communications"].includes(device.deviceId));
		} catch {
			devices = [];
		}
		renderSettings();
	}

	function bindDeviceSelect(id, key, labelKey, after) {
		$(id).addEventListener("change", async event => {
			board[key] = event.target.value;
			board[labelKey] = devices.find(device => device.deviceId === event.target.value)?.label ?? "";
			persist();
			await after();
		});
	}

	function bind() {
		$("soundAdd").addEventListener("click", () => $("soundFile").click());
		$("soundFile").addEventListener("change", event => {
			importFiles(event.target.files);
			event.target.value = "";
		});
		$("soundVolume").addEventListener("input", event => {
			board.volume = Number(event.target.value);
			applyVolume();
			renderSettings();
			persist();
		});
		$("soundVolume").addEventListener("dblclick", () => {
			board.volume = 100;
			applyVolume();
			renderSettings();
			persist();
		});
		$("soundOverlap").addEventListener("change", event => {
			board.overlap = event.target.checked;
			persist();
		});
		bindDeviceSelect("soundOutput", "output", "outputLabel", async () => {
			if (outputs.main) await setSink(outputs.main, board.output, board.outputLabel);
		});
		bindDeviceSelect("soundMonitor", "monitor", "monitorLabel", async () => {
			if (outputs.monitor) {
				outputs.monitor.context.close().catch(() => {});
				outputs.monitor = null;
			}
			if (playing.size || board.monitor) await ensureOutputs();
		});
		$("soundStopAll").addEventListener("click", stopAll);
		$("soundFolder").addEventListener("click", () => desktop.openSounds());

		const panel = $("panel-sounds");
		const isFileDrag = event => [...(event.dataTransfer?.types ?? [])].includes("Files");
		document.addEventListener("dragover", event => {
			if (!isFileDrag(event)) return;
			event.preventDefault();
			event.dataTransfer.dropEffect = panel.hidden ? "none" : "copy";
			panel.classList.toggle("is-drop", !panel.hidden);
		});
		document.addEventListener("dragleave", event => {
			if (!event.relatedTarget) panel.classList.remove("is-drop");
		});
		document.addEventListener("drop", event => {
			if (!isFileDrag(event)) return;
			event.preventDefault();
			panel.classList.remove("is-drop");
			if (!panel.hidden) importFiles(event.dataTransfer.files);
		});
		document.addEventListener("keydown", onCaptureKey, true);
		document.addEventListener("keydown", event => {
			if (event.key === "Escape" && !panel.hidden && !capturing && playing.size) stopAll();
		});
		navigator.mediaDevices.addEventListener("devicechange", loadDevices);
	}

	window.soundboard = {
		hotkeys,
		play: id => play(id, true),
		stopAll,
	};

	bind();
	desktop.loadStore().then(stored => {
		sanitize(stored.soundboard);
		render();
		loadDevices();
		if (board.sounds.some(sound => sound.key)) applyHotkeys();
	});
})();
