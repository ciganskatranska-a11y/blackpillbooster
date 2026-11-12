let controlCounter = 0;

function el(tag, className, text) {

	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;

}

function roundTo(value, step) {

	const decimals = (String(step).split(".")[1] ?? "").length;
	return Number((Math.round(value / step) * step).toFixed(decimals));

}

function showNumber(value) {
	return String(Math.round(value * 100) / 100);
}

function readNumber(text) {
	return Number.parseFloat(String(text).trim().replace("−", "-").replace(",", "."));
}

function sliderScale(spec) {

	if (spec.scale !== "log") {
		return { min: spec.min, max: spec.max, step: spec.step, to: value => value, from: position => position };
	}

	const ratio = Math.log(spec.max / spec.min);
	return {
		min: 0,
		max: 1000,
		step: 1,
		to: value => Math.round(1000 * Math.log(value / spec.min) / ratio),
		from: position => Math.min(spec.max, Math.max(spec.min, roundTo(spec.min * Math.exp(ratio * position / 1000), spec.step))),
	};

}

function paintRange(input, center) {

	const min = Number(input.min);
	const max = Number(input.max);
	const position = (Number(input.value) - min) / (max - min) * 100;
	const origin = center === undefined ? 0 : (center - min) / (max - min) * 100;
	input.style.setProperty("--a", Math.min(position, origin));
	input.style.setProperty("--b", Math.max(position, origin));

}

function applyTheme(prefs) {

	const root = document.documentElement;
	const red = parseInt(prefs.accent.slice(1, 3), 16) / 255;
	const green = parseInt(prefs.accent.slice(3, 5), 16) / 255;
	const blue = parseInt(prefs.accent.slice(5, 7), 16) / 255;
	const luminance = .2126 * red + .7152 * green + .0722 * blue;
	root.style.setProperty("--accent", prefs.accent);
	root.style.setProperty("--hot", prefs.hot);
	root.style.setProperty("--on-accent", luminance > .45 ? "#000000" : "#ffffff");

}

function createNumberField(spec, onCommit) {

	const field = el("input", "num");
	const low = spec.typeMin ?? spec.min;
	const high = spec.typeMax ?? spec.max;
	field.type = "number";
	field.min = low;
	field.max = high;
	field.step = "any";
	field.inputMode = "decimal";
	field.setAttribute("aria-label", `${spec.label} in ${spec.unit}`);

	let shown = "";
	const commit = () => {
		const number = readNumber(field.value);
		if (!Number.isFinite(number)) {
			field.value = shown;
			return;
		}
		onCommit(Math.round(Math.min(high, Math.max(low, number)) * 100) / 100);
	};

	field.addEventListener("change", commit);
	field.addEventListener("keydown", event => {
		if (event.key === "Enter") {
			event.preventDefault();
			field.blur();
		} else if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			field.value = shown;
			field.blur();
		}
	});

	return {
		element: field,
		show(value) {
			shown = showNumber(value);
			if (document.activeElement !== field) field.value = shown;
		},
	};

}

function createRange(spec, store) {

	const id = `control-${++controlCounter}`;
	const wrapper = el("div", "control");
	const label = el("label", "", spec.label);
	const word = el("span", "word");
	const box = el("span", "box");
	const input = el("input");
	const scale = sliderScale(spec);
	const center = spec.center === undefined ? undefined : scale.to(spec.center);
	const toPatch = value => spec.patch ? spec.patch(value) : { [spec.key]: value };
	const number = createNumberField(spec, value => store.change(toPatch(value)));

	label.htmlFor = id;
	if (spec.tip) label.title = spec.tip;
	label.append(word);
	box.append(number.element, el("span", "unit", spec.unit));
	input.type = "range";
	input.id = id;
	input.min = scale.min;
	input.max = scale.max;
	input.step = scale.step;
	wrapper.append(label, box, input);

	input.addEventListener("input", () => store.change(toPatch(scale.from(Number(input.value)))));
	input.addEventListener("dblclick", () => store.change(toPatch(spec.reset ?? defaultSettings()[spec.key])));

	return {
		element: wrapper,
		update(settings) {
			const current = settings[spec.key];
			input.value = scale.to(Math.min(spec.max, Math.max(spec.min, current)));
			number.show(current);
			word.textContent = spec.word?.(current) ?? "";
			paintRange(input, center);
		},
	};

}

function createChoice(spec, store) {

	const wrapper = el("div", "choice");
	const group = el("div", "segmented");
	group.setAttribute("role", "radiogroup");
	group.setAttribute("aria-label", spec.label ?? spec.key);
	if (spec.label) wrapper.append(el("p", "choice-label", spec.label));

	const buttons = spec.options.map(([value, text]) => {
		const button = el("button", "", text);
		button.type = "button";
		button.setAttribute("role", "radio");
		button.addEventListener("click", () => store.change({ [spec.key]: value }));
		group.append(button);
		return [value, button];
	});
	wrapper.append(group);

	return {
		element: wrapper,
		update(settings) {
			for (const [value, button] of buttons) button.setAttribute("aria-checked", String(settings[spec.key] === value));
		},
	};

}

function createToggle(label, isHot, onChange) {

	const toggle = el("label", isHot ? "switch hot" : "switch");
	const input = el("input");
	input.type = "checkbox";
	input.setAttribute("role", "switch");
	input.setAttribute("aria-label", label);
	toggle.append(input, el("span"));
	input.addEventListener("change", () => onChange(input.checked));
	return { element: toggle, input };

}

function createSwitch(spec, store, isHot) {

	const row = el("div", "switch-row");
	const label = el("span", "", spec.label);
	const toggle = createToggle(spec.label, isHot, isOn => store.change({ [spec.key]: isOn }));

	if (spec.tip) label.title = spec.tip;
	row.append(label, toggle.element);

	return {
		element: row,
		update(settings) {
			toggle.input.checked = settings[spec.key];
		},
	};

}

function createPresetChips(presets, store, extra) {

	const container = el("div", "chips");
	const buttons = Object.values(presets).map(preset => {
		const button = el("button", "", preset.name);
		button.type = "button";
		button.addEventListener("click", () => store.change({ ...preset.patch, ...extra }));
		container.append(button);
		return [preset, button];
	});

	return {
		element: container,
		update(settings) {
			for (const [preset, button] of buttons) button.setAttribute("aria-pressed", String(patchMatches(settings, preset.patch)));
		},
	};

}

function sectionDefaults(section) {

	const defaults = defaultSettings();
	return Object.fromEntries(section.controls.map(control => [control.key, defaults[control.key]]));

}

function createSection(section, store) {

	const element = el("section", section.isHot ? "group is-hot" : "group");
	const head = el("div", "group-head");
	const text = el("div", "group-text");
	const body = el("div", "group-body");
	const reset = el("button", "reset", "↺");
	const parts = [];
	let toggle = null;

	element.dataset.section = section.id;
	text.append(el("h3", "", section.title));
	if (section.description) text.append(el("p", "", section.description));
	reset.type = "button";
	reset.title = `Reset ${section.title}`;
	reset.setAttribute("aria-label", `Reset ${section.title}`);
	reset.addEventListener("click", () => store.change(sectionDefaults(section)));
	head.append(text, reset);

	if (section.toggle) {
		toggle = createToggle(section.title, section.isHot, isOn => store.change({ [section.toggle]: isOn }));
		head.append(toggle.element);
	}

	if (section.presets === "smash") parts.push(createPresetChips(smashPresets, store, { distortion: true }));
	if (section.meter) {
		const live = el("p", "live");
		live.dataset.meter = section.meter;
		body.append(live);
	}
	for (const control of section.controls) {
		if (control.type === "range") parts.push(createRange(control, store));
		else if (control.type === "choice") parts.push(createChoice(control, store));
		else parts.push(createSwitch(control, store, section.isHot));
	}
	for (const part of parts) body.append(part.element);
	element.append(head, body);

	return {
		element,
		update(settings) {
			if (toggle) {
				toggle.input.checked = settings[section.toggle];
				element.classList.toggle("is-off", !settings[section.toggle]);
				body.hidden = !settings[section.toggle];
			}
			for (const part of parts) part.update(settings);
		},
	};

}

function createSections(container, list, store) {

	const parts = list.map(section => createSection(section, store));
	for (const part of parts) container.append(part.element);
	return settings => {
		for (const part of parts) part.update(settings);
	};

}

function createEqualizer(container, store) {

	const canvas = el("canvas", "curve");
	const bar = el("div", "eq-bar");
	const select = el("select");
	const flatten = el("button", "ghost", "Flatten");
	const bands = el("div", "bands");
	const inputs = [];
	const curve = {
		context: new OfflineAudioContext(1, 128, 48000),
		filters: [],
		dragging: null,
		frequencies: Float32Array.from({ length: 160 }, (_, index) => 20 * 1000 ** (index / 159)),
		magnitude: new Float32Array(160),
		phase: new Float32Array(160),
	};

	canvas.setAttribute("aria-hidden", "true");
	select.setAttribute("aria-label", "Equalizer preset");
	flatten.type = "button";
	for (const [key, preset] of Object.entries(eqPresets)) select.add(new Option(preset.name, key));
	const custom = new Option("Custom", "custom");
	custom.disabled = true;
	select.add(custom);
	bar.append(select, flatten);

	const setBand = (index, gain) => {
		const eq = [...store.settings.eq];
		eq[index] = gain;
		store.change({ eq, preset: "custom" });
	};

	for (const [index, frequency] of eqBands.entries()) {
		const band = el("div", "band");
		const input = el("input");
		const name = frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);
		const label = el("label", "", name);
		const number = createNumberField({ label: `${name} Hz band`, unit: "dB", min: -24, max: 24 }, gain => setBand(index, gain));

		input.type = "range";
		input.id = `band-${++controlCounter}`;
		input.min = -24;
		input.max = 24;
		input.step = .5;
		input.setAttribute("aria-label", `${frequency} Hz`);
		label.htmlFor = input.id;
		band.append(number.element, input, label);
		bands.append(band);
		inputs.push([input, number]);

		input.addEventListener("input", () => setBand(index, Number(input.value)));
		input.addEventListener("dblclick", () => setBand(index, 0));
	}

	select.addEventListener("change", () => {
		const preset = eqPresets[select.value];
		if (preset) store.change({ eq: [...preset.gains], preset: select.value });
	});
	flatten.addEventListener("click", () => store.change({ eq: [...eqPresets.flat.gains], preset: "flat" }));
	container.append(canvas, bar, bands);

	const dragTo = event => {
		const bounds = canvas.getBoundingClientRect();
		const height = bounds.height;
		const scale = (height / 2 - 6) / 24;
		const x = event.clientX - bounds.left;
		const y = event.clientY - bounds.top;
		if (curve.dragging === null) {
			const positions = eqBands.map(frequency => Math.log(frequency / 20) / Math.log(1000) * bounds.width);
			curve.dragging = positions.reduce((best, position, index) => Math.abs(position - x) < Math.abs(positions[best] - x) ? index : best, 0);
		}
		const gain = Math.max(-24, Math.min(24, Math.round((height / 2 - y) / scale * 2) / 2));
		if (store.settings.eq[curve.dragging] === gain) return;
		setBand(curve.dragging, gain);
	};
	canvas.addEventListener("pointerdown", event => {
		curve.dragging = null;
		canvas.setPointerCapture(event.pointerId);
		dragTo(event);
	});
	canvas.addEventListener("pointermove", event => {
		if (curve.dragging !== null && canvas.hasPointerCapture(event.pointerId)) dragTo(event);
	});
	canvas.addEventListener("pointerup", () => {
		curve.dragging = null;
		draw(store.settings);
	});
	canvas.addEventListener("pointercancel", () => {
		curve.dragging = null;
	});

	const draw = settings => {
		const width = canvas.clientWidth;
		const height = canvas.clientHeight;
		if (!width) return;

		const ratio = window.devicePixelRatio || 1;
		canvas.width = Math.round(width * ratio);
		canvas.height = Math.round(height * ratio);
		const graphics = canvas.getContext("2d");
		graphics.scale(ratio, ratio);

		const styles = getComputedStyle(document.documentElement);
		const accent = styles.getPropertyValue("--accent").trim();
		const line = styles.getPropertyValue("--line").trim();
		const muted = styles.getPropertyValue("--muted").trim();
		const specs = filterSpecs(settings);
		if (!curve.filters.length) curve.filters = specs.map(spec => new BiquadFilterNode(curve.context, spec));

		const totals = new Float32Array(curve.frequencies.length);
		for (const [index, filter] of curve.filters.entries()) {
			filter.gain.value = specs[index].gain;
			filter.getFrequencyResponse(curve.frequencies, curve.magnitude, curve.phase);
			for (let point = 0; point < totals.length; point++) totals[point] += 20 * Math.log10(curve.magnitude[point]);
		}

		const middle = height / 2;
		const scale = (height / 2 - 6) / 24;
		const toX = frequency => Math.log(frequency / 20) / Math.log(1000) * width;
		const toY = point => middle - Math.max(-24, Math.min(24, totals[point])) * scale;

		graphics.lineWidth = 1;
		graphics.strokeStyle = line;
		graphics.fillStyle = muted;
		graphics.font = "600 10px 'Barlow Condensed', sans-serif";
		for (const [frequency, text] of [[100, "100"], [1000, "1K"], [10000, "10K"]]) {
			const x = Math.round(toX(frequency)) + .5;
			graphics.beginPath();
			graphics.moveTo(x, 0);
			graphics.lineTo(x, height);
			graphics.stroke();
			graphics.fillText(text, x + 3, height - 4);
		}
		for (const decibels of [-12, 0, 12]) {
			const y = Math.round(middle - decibels * scale) + .5;
			graphics.beginPath();
			graphics.moveTo(0, y);
			graphics.lineTo(width, y);
			graphics.stroke();
		}

		graphics.beginPath();
		for (let point = 0; point < totals.length; point++) {
			if (point === 0) graphics.moveTo(toX(curve.frequencies[point]), toY(point));
			else graphics.lineTo(toX(curve.frequencies[point]), toY(point));
		}
		graphics.lineWidth = 2;
		graphics.strokeStyle = accent;
		graphics.stroke();
		graphics.lineTo(width, middle);
		graphics.lineTo(0, middle);
		graphics.closePath();
		graphics.globalAlpha = .16;
		graphics.fillStyle = accent;
		graphics.fill();
		graphics.globalAlpha = 1;

		for (const [index, frequency] of eqBands.entries()) {
			const isActive = curve.dragging === index;
			const size = isActive ? 10 : 7;
			const x = toX(frequency);
			const y = middle - settings.eq[index] * scale;
			graphics.fillStyle = isActive ? accent : "#000000";
			graphics.fillRect(x - size / 2, y - size / 2, size, size);
			graphics.lineWidth = 2;
			graphics.strokeStyle = accent;
			graphics.strokeRect(x - size / 2, y - size / 2, size, size);
		}
	};

	return settings => {
		for (const [index, [input, number]] of inputs.entries()) {
			input.value = settings.eq[index];
			number.show(settings.eq[index]);
			paintRange(input, 0);
		}
		select.value = eqPresets[settings.preset] ? settings.preset : "custom";
		draw(settings);
	};

}
