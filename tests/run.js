const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const registry = {};
globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class {
	constructor() {
		this.messages = [];
		this.port = { postMessage: message => this.messages.push(message) };
	}
};
globalThis.registerProcessor = (name, processor) => {
	registry[name] = processor;
};
vm.runInThisContext(fs.readFileSync(path.join(root, "processors.js"), "utf8") + "\nglobalThis.testing = { Biquad, setKWeighting, Upsampler };");
vm.runInThisContext(fs.readFileSync(path.join(root, "shared.js"), "utf8") + "\nglobalThis.shared = { defaultSettings, controlIndex, mergeSettings, mergePrefs, builtInPresets, secretPresets, allBuiltInPresets, smashPresets, voicePresets, sections, groups, levelSection, codeKeys, simpleCodeKeys, encodeShareCode, decodeShareCode, settingsMatch, presetSettings, maxxPatch, isMaxxOn, panicPatch, toBase64Url, ruleMatches, presetIdForHost, migratePresets, isUnlocked, filterSpecs, commands, defaultHotkeys };");

const results = [];
const check = (name, isPassing, detail) => results.push({ name, isPassing, detail });
const toDb = value => 20 * Math.log10(value);
const rms = (samples, from = 0) => {
	let sum = 0;
	for (let index = from; index < samples.length; index++) sum += samples[index] * samples[index];
	return Math.sqrt(sum / (samples.length - from));
};
const peakOf = (samples, from = 0) => {
	let peak = 0;
	for (let index = from; index < samples.length; index++) peak = Math.max(peak, Math.abs(samples[index]));
	return peak;
};
const tone = (samples, frequency, from) => {
	const omega = 2 * Math.PI * frequency / 48000;
	let real = 0;
	let imag = 0;
	for (let index = from; index < samples.length; index++) {
		real += samples[index] * Math.cos(omega * index);
		imag -= samples[index] * Math.sin(omega * index);
	}
	return 2 * Math.hypot(real, imag) / (samples.length - from);
};
const sine = (frequency, amplitude) => time => Math.sin(2 * Math.PI * frequency * time / 48000) * amplitude;
const lastMessage = (processor, key) => [...processor.messages].reverse().find(message => key in message);

function run(name, params, signal, seconds) {

	const processor = new registry[name]();
	const blocks = Math.round(seconds * 48000 / 128);
	const left = new Float64Array(blocks * 128);
	const parameters = Object.fromEntries(Object.entries(params).map(([key, value]) => [key, new Float32Array([value])]));
	for (let block = 0; block < blocks; block++) {
		const inputLeft = new Float32Array(128);
		const inputRight = new Float32Array(128);
		for (let index = 0; index < 128; index++) {
			const time = block * 128 + index;
			inputLeft[index] = signal(time, 0);
			inputRight[index] = signal(time, 1);
		}
		const output = [new Float32Array(128), new Float32Array(128)];
		processor.process([[inputLeft, inputRight]], [output], parameters);
		left.set(output[0], block * 128);
	}
	return { left, processor };

}

const shelf = new testing.Biquad();
const highpass = new testing.Biquad();
testing.setKWeighting(shelf, highpass);
check("K-weighting matches BS.1770 at 48 kHz", Math.abs(shelf.b0 - 1.53512485958697) < 1e-9 && Math.abs(highpass.a1 + 1.99004745483398) < 1e-9);

const hot = (time, channel) => (Math.sin(time * 2 * Math.PI * 11000 / 48000 + channel) * .7 + Math.sin(time * 2 * Math.PI * 70 / 48000) * .5) * (time % 24000 < 4000 ? 20 : 4);
const limited = run("limiter", { enabled: 1, ceiling: -1, release: 40, lookahead: 4, truePeak: 1 }, hot, 2);
const upsampler = new testing.Upsampler();
const phases = new Float64Array(4);
let truePeak = 0;
for (const sample of limited.left.subarray(4800)) {
	upsampler.process(sample, phases);
	for (const value of phases) truePeak = Math.max(truePeak, Math.abs(value));
}
check("Limiter holds the true peak ceiling", toDb(truePeak) <= -.98, `${toDb(truePeak).toFixed(2)} dBTP`);

const meter = run("limiter", { enabled: 0, ceiling: 0, release: 40, lookahead: 4, truePeak: 0 }, sine(1000, 1), 1);
check("Loudness meter reads 0 LUFS for a full-scale stereo 1 kHz sine", Math.abs(lastMessage(meter.processor, "lufs").lufs) < .1, `${lastMessage(meter.processor, "lufs").lufs.toFixed(2)} LUFS`);

for (const frequency of [60, 150, 1000, 3500, 15000]) {
	const flat = run("multiband", { strength: 0, lowPush: 0, midPush: 0, highPush: 0, lowFreq: 150, highFreq: 3500, attack: 5, release: 120 }, sine(frequency, .3), .5);
	const gain = toDb(rms(flat.left, 6000) / (.3 / Math.SQRT2));
	check(`Multiband is transparent at ${frequency} Hz`, Math.abs(gain) < .05, `${gain.toFixed(3)} dB`);
}

const clipped = run("clipper", { drive: 12, softness: 0, oversample: 1 }, sine(2500, .5), .5);
const alias = toDb(tone(clipped.left, 20500, 4000) / tone(clipped.left, 2500, 4000));
check("Oversampled clipper keeps aliasing below -60 dB", alias < -60, `${alias.toFixed(1)} dB`);

const leveled = run("auto-gain", { target: -14, maxBoost: 18, speed: 1 }, sine(1000, .1), 8);
check("Auto-gain lifts a -20 LUFS signal by 6 dB", Math.abs(lastMessage(leveled.processor, "gain").gain - 6) < .5, `${lastMessage(leveled.processor, "gain").gain.toFixed(2)} dB`);

const frequencyOf = samples => {
	let crossings = 0;
	for (let index = 20001; index < samples.length; index++) if (samples[index - 1] < 0 && samples[index] >= 0) crossings++;
	return crossings / ((samples.length - 20000) / 48000);
};
const fastPitch = frequencyOf(run("pitch-shifter", { ratio: 2 ** (7 / 12), grain: 50 }, sine(440, .5), 1.5).left);
check("Fast pitch shifts up 7 semitones", Math.abs(fastPitch - 659.26) < 3, `${fastPitch.toFixed(1)} Hz`);
const hdPitch = frequencyOf(run("pitch-hd", { ratio: 2 ** (7 / 12), formant: 2 ** (7 / 12) }, sine(440, .5), 1.5).left);
check("HD pitch shifts up 7 semitones", Math.abs(hdPitch - 659.26) < 2, `${hdPitch.toFixed(1)} Hz`);
const unity = run("pitch-hd", { ratio: 1, formant: 1 }, sine(440, .5), 1);
check("HD pitch is unity gain at ratio 1", Math.abs(rms(unity.left, 10000) / (.5 / Math.SQRT2) - 1) < .02);

const sibilant = time => sine(300, .4)(time) + (Math.floor(time / 4800) % 2 ? sine(7000, .2)(time) : 0);
const deessed = run("deesser", { frequency: 5000, threshold: -30, amount: 12 }, sibilant, 1);
const segment = deessed.left.subarray(4800 * 5, 4800 * 6);
check("De-esser cuts loud esses", toDb(tone(segment, 7000, 0) / .2) < -6, `${toDb(tone(segment, 7000, 0) / .2).toFixed(1)} dB`);
check("De-esser leaves the voice alone", Math.abs(toDb(tone(segment, 300, 0) / .4)) < .1);

const octave = run("sub-octave", { amount: 1, frequency: 120 }, sine(100, .5), 1);
check("Sub-octave adds bass an octave down", tone(octave.left, 50, 12000) > .1, `${tone(octave.left, 50, 12000).toFixed(3)} at 50 Hz`);

const drum = time => Math.sin(2 * Math.PI * 200 * time / 48000) * Math.exp(-(time % 9600) / 4800) * .5;
const crest = samples => peakOf(samples, 19200) / rms(samples, 19200);
check("Punch makes hits sharper", crest(run("punch", { attack: 1, sustain: 0 }, drum, 1).left) > crest(run("punch", { attack: 0, sustain: 0 }, drum, 1).left) * 1.2);

const defaults = shared.defaultSettings();
check("Every control has a default", [...shared.controlIndex.keys()].every(key => key in defaults));
check("Share codes cover every setting", Object.keys(defaults).every(key => shared.codeKeys.includes(key)));
const presets = [...shared.allBuiltInPresets, ...Object.values(shared.smashPresets), ...Object.values(shared.voicePresets)].map(preset => preset.patch);
check("Presets stay inside control ranges", presets.every(patch => Object.entries(patch).every(([key, value]) => key in defaults && JSON.stringify(shared.mergeSettings({ ...defaults, ...patch })[key]) === JSON.stringify(value))));
const presetTargets = shared.allBuiltInPresets.map(preset => JSON.stringify(shared.presetSettings(preset)));
check("Every built-in preset is unique", new Set(presetTargets).size === presetTargets.length, `${presetTargets.length} presets`);
check("It's over stays unlimited and maxed", (() => {
	const over = shared.presetSettings(shared.builtInPresets.find(preset => preset.name === "It's over"));
	return over && !over.limiter && over.ultimate && over.volume === 5000 && over.distortion;
})());
check("Loudmaxx turns the chain on and off", shared.isMaxxOn(shared.mergeSettings(shared.maxxPatch(true, 60))) && !shared.isMaxxOn(shared.mergeSettings({ ...shared.maxxPatch(true, 60), ...shared.maxxPatch(false, 60) })));
check("Every section belongs to a group", shared.sections.every(section => shared.groups.some(group => group.id === section.group)));
check("Secret presets start locked and unlock with stats", shared.secretPresets.every(preset => !shared.isUnlocked(preset, {}) && shared.isUnlocked(preset, { [preset.unlock.stat]: preset.unlock.value })));
check("Site rule wildcards match subdomains only", shared.ruleMatches("*.youtube.com", "music.youtube.com") && shared.ruleMatches("*.youtube.com", "youtube.com") && !shared.ruleMatches("*.youtube.com", "notyoutube.com"));
const migratedPrefs = shared.mergePrefs({ newTabs: "user:abc", siteRules: [{ pattern: "*.YouTube.com", stackId: "user:abc" }] });
check("Old stack rules and defaults migrate to presets", migratedPrefs.newTabs === "preset:abc" && shared.presetIdForHost("www.youtube.com", migratedPrefs) === "preset:abc");
const migratedPresets = shared.migratePresets({ stacks: [{ id: "user:abc", name: "Gym", settings: { volume: 300, voice: 5 } }] });
check("Old stacks migrate with their settings", migratedPresets[0].id === "preset:abc" && migratedPresets[0].settings.presence === 5 && migratedPresets[0].settings.volume === 300);
const brutalEq = shared.mergeSettings({ eq: [30, -30, 24, 0, 0, 0, 0, 0, 0, 0], eqQ: 3 });
check("EQ goes to ±24 dB and band width applies", brutalEq.eq[0] === 24 && brutalEq.eq[1] === -24 && shared.filterSpecs(brutalEq)[4].Q === 3);
const panic = shared.mergeSettings({ ...shared.presetSettings(shared.builtInPresets.at(-1)), ...shared.panicPatch() });
check("Panic makes It's over safe", panic.volume === 100 && panic.limiter && !panic.distortion && !panic.ultimate);
const metered = run("clipper", { drive: 6, softness: 0, oversample: 1 }, sine(1000, .5), 1.2);
const loadMessage = lastMessage(metered.processor, "load");
check("Processors report CPU load for the guard", Boolean(loadMessage) && loadMessage.load >= 0 && loadMessage.load < 1, loadMessage ? `${(loadMessage.load * 100).toFixed(1)}% of real time` : "none");
const unlimited = shared.mergeSettings({ volume: 250000000, postGain: 90, trim: 300, gainLeft: -500, clipDrive: 80 });
check("Typed values go far past the slider ranges", unlimited.volume === 250000000 && unlimited.postGain === 90 && unlimited.trim === 120 && unlimited.gainLeft === -120 && unlimited.clipDrive === 80);
check("Panic clears the final push", shared.mergeSettings({ ...unlimited, ...shared.panicPatch() }).postGain === 0);
const nan = run("limiter", { enabled: 0, ceiling: 0, release: 40, lookahead: 4, truePeak: 0 }, time => time % 100 === 0 ? NaN : .5, .2);
check("Limiter swallows broken samples", nan.left.every(Number.isFinite));
check("Every hotkey command is unique", new Set(shared.commands.map(([command]) => command)).size === shared.commands.length && Object.keys(shared.defaultHotkeys()).every(command => shared.commands.some(([name]) => name === command)));
check("Every range has a unit", [...shared.controlIndex.values()].every(control => control.type !== "range" || typeof control.unit === "string"));

(async () => {

	const stack = shared.presetSettings(shared.builtInPresets.at(-1));
	const decoded = await shared.decodeShareCode(await shared.encodeShareCode(stack, "Test"));
	check("Share codes round-trip", shared.settingsMatch(stack, decoded.settings) && decoded.name === "Test" && (await shared.encodeShareCode(stack, "")).startsWith("BP5-"));

	const legacyCode = async (prefix, keys, patch) => {
		const pairs = Object.entries(patch).map(([key, value]) => [keys.indexOf(key), value]);
		const stream = new Blob([JSON.stringify(["Old", pairs])]).stream().pipeThrough(new CompressionStream("deflate-raw"));
		return prefix + shared.toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
	};
	const simple = await shared.decodeShareCode(await legacyCode("BP4-", shared.simpleCodeKeys, { volume: 800, ultimate: true, maxx: true, maxxAmount: 75, voice: "gigachad", pitch: -4 }));
	check("BP4 codes upgrade Loudmaxx and voices", simple.settings.volume === 800 && shared.isMaxxOn(simple.settings) && simple.settings.pitchMode === "hd" && simple.settings.pitch === -4 && simple.settings.reverb);
	const full = await shared.decodeShareCode(await legacyCode("BP3-", shared.codeKeys, { volume: 300, presence: 6, clip: true }));
	check("BP3 codes still decode", full.settings.volume === 300 && full.settings.presence === 6 && full.settings.clip);
	const stored = shared.mergeSettings({ volume: 250, maxx: true, maxxAmount: 40, voice: "npc", pitch: 0 });
	check("Saved v4 settings upgrade", shared.isMaxxOn(stored) && stored.npc && stored.maxxAmount === 40);
	let isRejected = false;
	try {
		await shared.decodeShareCode("BP3-broken");
	} catch {
		isRejected = true;
	}
	check("Broken share codes are rejected", isRejected);

	for (const result of results) console.log(`${result.isPassing ? "PASS" : "FAIL"}  ${result.name}${result.detail ? `  (${result.detail})` : ""}`);
	const failures = results.filter(result => !result.isPassing).length;
	console.log(`\n${results.length - failures} passed, ${failures} failed`);
	process.exitCode = failures ? 1 : 0;

})();
