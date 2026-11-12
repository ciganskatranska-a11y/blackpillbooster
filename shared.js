const eqBands = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

const signed = (value, digits) => `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(digits)}`;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function snap(value, step) {

	const decimals = (String(step).split(".")[1] ?? "").length;
	return Number((Math.round(value / step) * step).toFixed(decimals));

}

function defaultSettings() {

	return {
		volume: 100,
		muted: false,
		ultimate: false,
		maxxAmount: 60,
		trim: 0,
		eq: eqBands.map(() => 0),
		preset: "flat",
		eqQ: 1.4,
		bass: 0,
		treble: 0,
		presence: 0,
		lowCut: 20,
		highCut: 20000,
		pitch: 0,
		cents: 0,
		grain: 50,
		pitchMode: "fast",
		formant: 0,
		vocals: "normal",
		balance: 0,
		width: 100,
		center: 0,
		monoBass: false,
		monoBassFreq: 120,
		deesser: false,
		deessFreq: 6000,
		deessThreshold: -30,
		deessAmount: 8,
		npc: false,
		npcFreq: 40,
		npcMix: 100,
		echo: false,
		echoTime: 280,
		echoFeedback: 35,
		echoMix: 35,
		reverb: false,
		reverbSize: 2.5,
		reverbMix: 30,
		distortion: false,
		distType: "soft",
		distDrive: 18,
		distBias: 0,
		distBits: 16,
		distRate: 1,
		distTone: 20000,
		distMix: 100,
		distLevel: 0,
		agc: false,
		agcTarget: -14,
		agcMaxBoost: 18,
		agcSpeed: "medium",
		multiband: false,
		maximizer: 50,
		mbLowPush: 0,
		mbMidPush: 0,
		mbHighPush: 0,
		mbLowFreq: 150,
		mbHighFreq: 3500,
		mbAttack: 5,
		mbRelease: 120,
		clip: false,
		clipDrive: 4,
		clipSoftness: 30,
		clipOversample: true,
		phantom: false,
		phantomAmount: 50,
		phantomFreq: 100,
		exciter: false,
		exciterAmount: 30,
		exciterFreq: 3500,
		exciterDrive: 6,
		punch: false,
		punchAttack: 30,
		punchSustain: 0,
		sub: false,
		subAmount: 50,
		subFreq: 90,
		night: 0,
		limiter: true,
		ceiling: -.3,
		release: 60,
		lookahead: 4,
		truePeak: true,
		postGain: 0,
		swap: false,
		mono: false,
		invertLeft: false,
		invertRight: false,
		gainLeft: 0,
		gainRight: 0,
		delay: 0,
	};

}

const groups = [
	{ id: "loud", title: "Loudmaxx chain", note: "Every loudness stage. Loudmaxx sets them for you, then tune anything." },
	{ id: "eq", title: "EQ-maxx", note: "Drag the curve, use the sliders or type exact values." },
	{ id: "voice", title: "Voice-maxx", note: "Pick a voice, then tweak pitch, vocals and space." },
	{ id: "smash", title: "BONESMASHING", isHot: true, note: "Hammers, fractures and crushes the sound." },
];

const volumeControl = { type: "range", key: "volume", label: "Volume", min: 0, max: 1000000000, step: 1, unit: "%" };

const maxxControl = { type: "range", key: "maxxAmount", label: "Loudmaxx strength", min: 0, max: 100, step: 1, unit: "%", patch: value => maxxPatch(true, value) };

const levelSection = {
	id: "level",
	title: "Level",
	controls: [
		volumeControl,
		{ type: "switch", key: "ultimate", label: "ASCEND", tip: "Raises the volume cap" },
		{ type: "switch", key: "muted", label: "Ghost (mute)" },
		maxxControl,
	],
};

const sections = [
	{
		id: "agc",
		group: "loud",
		title: "Auto-mog",
		toggle: "agc",
		meter: "agc",
		description: "Rides the gain so every video hits the same loudness.",
		controls: [
			{ type: "range", key: "agcTarget", label: "Target", min: -30, max: -6, step: .5, unit: "LUFS" },
			{ type: "range", key: "agcMaxBoost", label: "Max boost", min: 0, max: 30, typeMax: 120, step: .5, unit: "dB" },
			{ type: "choice", key: "agcSpeed", label: "Speed", options: [["slow", "Slow"], ["medium", "Medium"], ["fast", "Fast"]] },
		],
	},
	{
		id: "multiband",
		group: "loud",
		title: "Gigamog",
		toggle: "multiband",
		meter: "bands",
		description: "3-band maximizer. Squeezes lows, mids and highs separately.",
		controls: [
			{ type: "range", key: "maximizer", label: "Strength", min: 0, max: 100, step: 1, unit: "%" },
			{ type: "range", key: "mbLowPush", label: "Low push", min: -12, max: 12, step: .5, center: 0, unit: "dB" },
			{ type: "range", key: "mbMidPush", label: "Mid push", min: -12, max: 12, step: .5, center: 0, unit: "dB" },
			{ type: "range", key: "mbHighPush", label: "High push", min: -12, max: 12, step: .5, center: 0, unit: "dB" },
			{ type: "range", key: "mbLowFreq", label: "Low/mid split", min: 40, max: 800, step: 1, scale: "log", unit: "Hz" },
			{ type: "range", key: "mbHighFreq", label: "Mid/high split", min: 1000, max: 10000, step: 1, scale: "log", unit: "Hz" },
			{ type: "range", key: "mbAttack", label: "Attack", min: .1, max: 100, step: .1, scale: "log", unit: "ms" },
			{ type: "range", key: "mbRelease", label: "Release", min: 10, max: 1000, step: 1, scale: "log", unit: "ms" },
		],
	},
	{
		id: "clip",
		group: "loud",
		title: "Clip-maxx",
		toggle: "clip",
		meter: "clip",
		description: "Shaves peaks before the limiter. The mastering trick for extra loudness.",
		controls: [
			{ type: "range", key: "clipDrive", label: "Clip drive", min: 0, max: 24, typeMax: 120, step: .5, unit: "dB" },
			{ type: "range", key: "clipSoftness", label: "Softness", min: 0, max: 100, step: 1, unit: "%", word: value => value === 0 ? "Hard" : "" },
			{ type: "switch", key: "clipOversample", label: "4× oversampling", tip: "Cleaner clipping, more CPU" },
		],
	},
	{
		id: "punch",
		group: "loud",
		title: "Punch-maxx",
		toggle: "punch",
		description: "Transient shaper. Hits snap harder or tails get tighter.",
		controls: [
			{ type: "range", key: "punchAttack", label: "Attack", min: -100, max: 100, step: 1, center: 0, unit: "%" },
			{ type: "range", key: "punchSustain", label: "Sustain", min: -100, max: 100, step: 1, center: 0, unit: "%" },
		],
	},
	{
		id: "phantom",
		group: "loud",
		title: "Phantom bass",
		toggle: "phantom",
		description: "Harmonics that fake bass on speakers that can't play it.",
		controls: [
			{ type: "range", key: "phantomAmount", label: "Amount", min: 0, max: 100, step: 1, unit: "%" },
			{ type: "range", key: "phantomFreq", label: "Bass below", min: 40, max: 250, step: 1, scale: "log", unit: "Hz" },
		],
	},
	{
		id: "sub",
		group: "loud",
		title: "Jaw drop",
		toggle: "sub",
		description: "Sub-octave synth. Adds bass one octave below what's playing.",
		controls: [
			{ type: "range", key: "subAmount", label: "Amount", min: 0, max: 100, step: 1, unit: "%" },
			{ type: "range", key: "subFreq", label: "Tracks below", min: 50, max: 200, step: 1, scale: "log", unit: "Hz" },
		],
	},
	{
		id: "exciter",
		group: "loud",
		title: "Hunter eyes",
		toggle: "exciter",
		description: "Exciter. Adds bite and clarity to the highs.",
		controls: [
			{ type: "range", key: "exciterAmount", label: "Amount", min: 0, max: 100, step: 1, unit: "%" },
			{ type: "range", key: "exciterFreq", label: "Above", min: 1000, max: 10000, step: 1, scale: "log", unit: "Hz" },
			{ type: "range", key: "exciterDrive", label: "Drive", min: 1, max: 20, step: .5, unit: "×" },
		],
	},
	{
		id: "copium",
		group: "loud",
		title: "Copium",
		description: "Evens out loud and quiet parts, and trims the input.",
		controls: [
			{ type: "range", key: "night", label: "Copium dose", min: 0, max: 100, step: 1, unit: "%", word: value => value === 0 ? "Off" : "" },
			{ type: "range", key: "trim", label: "Input trim", min: -24, max: 24, typeMin: -120, typeMax: 120, step: .5, center: 0, unit: "dB" },
			{ type: "switch", key: "monoBass", label: "Bass mono", tip: "Louder bass on speakers" },
			{ type: "range", key: "monoBassFreq", label: "Mono below", min: 40, max: 300, step: 1, scale: "log", unit: "Hz" },
		],
	},
	{
		id: "limiter",
		group: "loud",
		title: "Cope limiter",
		toggle: "limiter",
		description: "Off means it's over: audio clips at full scale.",
		controls: [
			{ type: "range", key: "ceiling", label: "Height ceiling", min: -12, max: 0, step: .1, unit: "dB" },
			{ type: "range", key: "release", label: "Recovery", min: 5, max: 500, step: 1, scale: "log", unit: "ms" },
			{ type: "range", key: "lookahead", label: "Lookahead", min: 1, max: 10, step: .5, unit: "ms" },
			{ type: "switch", key: "truePeak", label: "True peak", tip: "Catches peaks between samples" },
		],
	},
	{
		id: "push",
		group: "loud",
		title: "Final push",
		isHot: true,
		description: "Raw gain after the limiter. Nothing catches it. Type any number.",
		controls: [
			{ type: "range", key: "postGain", label: "Final push", min: -24, max: 48, typeMin: -120, typeMax: 120, step: .5, center: 0, unit: "dB", word: value => value === 0 ? "Off" : value > 0 ? "Past the limiter" : "" },
		],
	},
	{
		id: "tone",
		group: "eq",
		title: "Bone structure",
		description: "Quick tone shaping on top of the equalizer.",
		controls: [
			{ type: "range", key: "bass", label: "Jawline bass", min: 0, max: 20, typeMax: 60, step: .5, unit: "dB", word: value => value === 0 ? "Off" : "" },
			{ type: "range", key: "treble", label: "Canthal tilt treble", min: 0, max: 15, typeMax: 60, step: .5, unit: "dB", word: value => value === 0 ? "Off" : "" },
			{ type: "range", key: "presence", label: "Presence-maxx", tip: "2.8 kHz, where ears are most sensitive", min: 0, max: 15, typeMax: 60, step: .5, unit: "dB", word: value => value === 0 ? "Off" : "" },
			{ type: "range", key: "eqQ", label: "EQ band width", tip: "Q of the 10 EQ bands. Higher is narrower and more surgical", min: .3, max: 6, step: .05, unit: "Q" },
		],
	},
	{
		id: "cuts",
		group: "eq",
		title: "Cut filters",
		description: "Low cut drops bass small speakers can't play, freeing headroom.",
		controls: [
			{ type: "range", key: "lowCut", label: "Low cut", min: 20, max: 500, step: 1, scale: "log", unit: "Hz", word: value => value <= 20 ? "Off" : "" },
			{ type: "range", key: "highCut", label: "High cut", min: 1000, max: 20000, step: 1, scale: "log", unit: "Hz", word: value => value >= 20000 ? "Off" : "" },
		],
	},
	{
		id: "pitch",
		group: "voice",
		title: "Pitch",
		controls: [
			{ type: "range", key: "pitch", label: "Pitch", min: -24, max: 24, step: 1, center: 0, unit: "st", word: value => value === 0 ? "Natural" : "" },
			{ type: "range", key: "cents", label: "Fine pitch", min: -100, max: 100, step: 1, center: 0, unit: "¢" },
			{ type: "choice", key: "pitchMode", label: "Engine", options: [["fast", "Fast · no delay"], ["hd", "HD · keeps formants"]] },
			{ type: "range", key: "formant", label: "Formant", tip: "HD only. 0 keeps the natural voice", min: -12, max: 12, step: .5, center: 0, unit: "st", word: value => value === 0 ? "Natural" : "" },
			{ type: "range", key: "grain", label: "Grain size", tip: "Fast only. Smaller is tighter", min: 10, max: 100, step: 1, unit: "ms" },
		],
	},
	{
		id: "vocals",
		group: "voice",
		title: "Vocals",
		controls: [
			{ type: "choice", key: "vocals", options: [["normal", "Normie"], ["remove", "Delete vocals"], ["focus", "Dialogue-maxx"]] },
		],
	},
	{
		id: "symmetry",
		group: "voice",
		title: "Symmetry",
		controls: [
			{ type: "range", key: "balance", label: "Symmetry", min: -100, max: 100, step: 1, center: 0, unit: "%", word: value => value === 0 ? "Perfect" : value < 0 ? "Left" : "Right" },
			{ type: "range", key: "width", label: "Frame width", min: 0, max: 200, typeMax: 1000, step: 1, center: 100, unit: "%", word: value => value === 0 ? "Mono" : "" },
			{ type: "range", key: "center", label: "Center level", tip: "Vocals and dialogue", min: -12, max: 12, typeMin: -120, typeMax: 60, step: .5, center: 0, unit: "dB" },
		],
	},
	{
		id: "channels",
		group: "voice",
		title: "Channel lab",
		description: "Per-speaker control: swap, flip, mono, trim each side and delay for lip sync.",
		controls: [
			{ type: "switch", key: "swap", label: "Swap left and right" },
			{ type: "switch", key: "mono", label: "Force mono" },
			{ type: "switch", key: "invertLeft", label: "Flip left phase" },
			{ type: "switch", key: "invertRight", label: "Flip right phase" },
			{ type: "range", key: "gainLeft", label: "Left level", min: -24, max: 24, typeMin: -120, typeMax: 60, step: .5, center: 0, unit: "dB" },
			{ type: "range", key: "gainRight", label: "Right level", min: -24, max: 24, typeMin: -120, typeMax: 60, step: .5, center: 0, unit: "dB" },
			{ type: "range", key: "delay", label: "Delay", tip: "Holds the sound back to line up with video", min: 0, max: 2000, typeMax: 5000, step: 1, unit: "ms", word: value => value === 0 ? "Off" : "" },
		],
	},
	{
		id: "deesser",
		group: "voice",
		title: "Tongue posture",
		toggle: "deesser",
		meter: "deess",
		description: "De-esser. Tames harsh S sounds that hurt at high volume.",
		controls: [
			{ type: "range", key: "deessFreq", label: "Above", min: 2000, max: 12000, step: 1, scale: "log", unit: "Hz" },
			{ type: "range", key: "deessThreshold", label: "Threshold", min: -60, max: 0, step: .5, unit: "dB" },
			{ type: "range", key: "deessAmount", label: "Max cut", min: 0, max: 24, step: .5, unit: "dB" },
		],
	},
	{
		id: "npc",
		group: "voice",
		title: "NPC mode",
		toggle: "npc",
		description: "Robot voice from a ring modulator.",
		controls: [
			{ type: "range", key: "npcFreq", label: "Buzz", min: 10, max: 500, step: 1, scale: "log", unit: "Hz" },
			{ type: "range", key: "npcMix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
		],
	},
	{
		id: "echo",
		group: "voice",
		title: "Rent-free",
		toggle: "echo",
		description: "Echo that keeps repeating in your head.",
		controls: [
			{ type: "range", key: "echoTime", label: "Delay", min: 20, max: 1500, step: 5, scale: "log", unit: "ms" },
			{ type: "range", key: "echoFeedback", label: "Repeats", min: 0, max: 95, step: 1, unit: "%" },
			{ type: "range", key: "echoMix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
		],
	},
	{
		id: "reverb",
		group: "voice",
		title: "Echo chamber",
		toggle: "reverb",
		description: "Reverb from closet to cathedral.",
		controls: [
			{ type: "range", key: "reverbSize", label: "Size", min: .2, max: 8, step: .1, unit: "s" },
			{ type: "range", key: "reverbMix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
		],
	},
	{
		id: "smash",
		group: "smash",
		title: "Hammer",
		toggle: "distortion",
		isHot: true,
		presets: "smash",
		controls: [
			{ type: "choice", key: "distType", options: [["soft", "Mew"], ["hard", "Hammer"], ["fuzz", "Rot"], ["fold", "Fracture"], ["square", "Jawline"]] },
			{ type: "range", key: "distDrive", label: "Hammer force", min: 0, max: 60, typeMax: 200, step: .5, unit: "dB" },
			{ type: "range", key: "distBias", label: "Asymmetry", min: -100, max: 100, step: 1, center: 0, unit: "%", word: value => value === 0 ? "Symmetric" : "" },
			{ type: "range", key: "distBits", label: "Bone density", min: 1, max: 16, step: 1, unit: "bit", word: value => value >= 16 ? "Full" : "" },
			{ type: "range", key: "distRate", label: "Crush", min: 1, max: 40, step: 1, unit: "×", word: value => value === 1 ? "Off" : "" },
			{ type: "range", key: "distTone", label: "Tone", min: 200, max: 20000, step: 1, scale: "log", unit: "Hz", word: value => value >= 19500 ? "Open" : "" },
			{ type: "range", key: "distMix", label: "Mix", min: 0, max: 100, step: 1, unit: "%" },
			{ type: "range", key: "distLevel", label: "Output", min: -36, max: 12, typeMin: -120, typeMax: 60, step: .5, center: 0, unit: "dB" },
		],
	},
];

const eqPresets = {
	flat: { name: "Normie (flat)", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
	bass: { name: "Jawline bass", gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
	bassExtreme: { name: "Gigamog bass", gains: [12, 11, 8, 4, 0, -1, -1, 0, 0, 0] },
	treble: { name: "Canthal tilt", gains: [0, 0, 0, 0, 0, 1, 3, 5, 6, 7] },
	presence: { name: "Presence-maxx", gains: [0, 0, 0, 0, 1, 2, 5, 6, 3, 0] },
	vocal: { name: "Voice-maxx", gains: [-3, -3, -1, 1, 3, 4, 4, 2, 0, -1] },
	podcast: { name: "Podcast-maxx", gains: [-8, -6, -2, 0, 2, 4, 5, 3, 0, -2] },
	loudness: { name: "Loudmaxx contour", gains: [7, 5, 2, 0, -1, 0, 0, 1, 4, 6] },
	smile: { name: "Mogger smile", gains: [10, 8, 4, 0, -3, -2, 0, 3, 7, 9] },
	rock: { name: "Rock", gains: [5, 4, 2, -1, -2, -1, 2, 4, 5, 5] },
	pop: { name: "Pop", gains: [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2] },
	electronic: { name: "Electronic", gains: [6, 5, 1, 0, -2, 1, 0, 2, 5, 6] },
	hipHop: { name: "Hip-hop", gains: [7, 6, 2, 3, -1, -1, 1, 0, 2, 3] },
	jazz: { name: "Jazz", gains: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3] },
	classical: { name: "Classical", gains: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4] },
	smallSpeakers: { name: "Phone speaker cope", gains: [-8, -4, 4, 5, 2, 0, 1, 2, 1, 0] },
	deep: { name: "Doomer", gains: [5, 4, 2, 1, 0, -1, -2, -3, -4, -5] },
};

const smashPresets = {
	warm: { name: "Light tap", patch: { distType: "soft", distDrive: 12, distBias: 0, distBits: 16, distRate: 1, distTone: 12000, distMix: 60, distLevel: 0 } },
	crunch: { name: "Crunch", patch: { distType: "hard", distDrive: 24, distBias: 0, distBits: 16, distRate: 1, distTone: 9000, distMix: 100, distLevel: -3 } },
	fracture: { name: "Fractured", patch: { distType: "fold", distDrive: 36, distBias: 20, distBits: 16, distRate: 1, distTone: 12000, distMix: 100, distLevel: -2 } },
	shattered: { name: "Shattered", patch: { distType: "fuzz", distDrive: 40, distBias: 0, distBits: 10, distRate: 2, distTone: 5000, distMix: 100, distLevel: 0 } },
	bitcrush: { name: "8-bit cope", patch: { distType: "square", distDrive: 10, distBias: 0, distBits: 4, distRate: 8, distTone: 8000, distMix: 100, distLevel: -3 } },
	blown: { name: "Blown speaker", patch: { distType: "fuzz", distDrive: 50, distBias: 45, distBits: 16, distRate: 1, distTone: 2500, distMix: 100, distLevel: 0 } },
	destroy: { name: "Full smash", patch: { distType: "square", distDrive: 60, distBias: 0, distBits: 3, distRate: 6, distTone: 20000, distMix: 100, distLevel: 0 } },
};

const voiceReset = { pitch: 0, cents: 0, pitchMode: "fast", formant: 0, npc: false, echo: false, reverb: false, lowCut: 20, highCut: 20000 };

const voicePresets = {
	normie: { name: "Normie", patch: { ...voiceReset } },
	gigachad: { name: "Gigachad", patch: { ...voiceReset, pitchMode: "hd", pitch: -4, formant: -1, reverb: true, reverbSize: 1.2, reverbMix: 15 } },
	demon: { name: "Demon", patch: { ...voiceReset, pitchMode: "hd", pitch: -9, formant: -6, reverb: true, reverbSize: 3.5, reverbMix: 30 } },
	doomer: { name: "Doomer", patch: { ...voiceReset, pitchMode: "hd", pitch: -2, formant: -2, highCut: 5000, reverb: true, reverbSize: 6, reverbMix: 40 } },
	helium: { name: "Helium cope", patch: { ...voiceReset, pitch: 9 } },
	jester: { name: "Jester", patch: { ...voiceReset, pitch: 7, npc: true, npcFreq: 90, npcMix: 50, echo: true, echoTime: 120, echoFeedback: 40, echoMix: 30 } },
	npc: { name: "NPC", patch: { ...voiceReset, npc: true, npcFreq: 45, npcMix: 100 } },
	radio: { name: "Radio", patch: { ...voiceReset, lowCut: 450, highCut: 3200 } },
	chamber: { name: "Echo chamber", patch: { ...voiceReset, reverb: true, reverbSize: 5, reverbMix: 45 } },
	arena: { name: "Arena", patch: { ...voiceReset, echo: true, echoTime: 320, echoFeedback: 30, echoMix: 30, reverb: true, reverbSize: 2.5, reverbMix: 25 } },
};

function maxxPatch(isOn, amount) {

	if (!isOn) return { agc: false, multiband: false, clip: false, punch: false, phantom: false, exciter: false, monoBass: false };

	const strength = clamp(amount, 0, 100) / 100;
	return {
		maxxAmount: Math.round(clamp(amount, 0, 100)),
		agc: true,
		agcTarget: snap(-16 + 6 * strength, .5),
		agcMaxBoost: snap(12 + 12 * strength, .5),
		multiband: true,
		maximizer: Math.round(30 + 60 * strength),
		clip: true,
		clipDrive: snap(2 + 8 * strength, .5),
		punch: true,
		punchAttack: Math.round(15 + 35 * strength),
		phantom: true,
		phantomAmount: Math.round(30 + 40 * strength),
		exciter: true,
		exciterAmount: Math.round(15 + 25 * strength),
		monoBass: true,
	};

}

function panicPatch() {
	return { volume: 100, muted: false, ultimate: false, distortion: false, limiter: true, ceiling: -1, truePeak: true, postGain: 0, trim: 0 };
}

function isMaxxOn(settings) {
	return settings.agc && settings.multiband && settings.clip;
}

const builtInPresets = [
	{ id: "builtin:normie", name: "Normie", description: "Clean. Nothing touched.", patch: {} },
	{ id: "builtin:mewing", name: "Mewing", description: "Subtle lift with steady loudness.", patch: { volume: 150, agc: true, agcTarget: -16, bass: 3 } },
	{ id: "builtin:looksmaxxed", name: "Looksmaxxed", description: "Loud, clean and punchy.", patch: { volume: 250, ...maxxPatch(true, 40) } },
	{ id: "builtin:gigachad", name: "Gigachad", description: "Max clean loudness. The full mastering chain.", patch: { ultimate: true, volume: 800, ...maxxPatch(true, 75), eq: [...eqPresets.loudness.gains], preset: "loudness", ceiling: -.1 } },
	{ id: "builtin:mogger", name: "Mogger", description: "Every loudness trick tuned hard.", patch: { ultimate: true, volume: 1200, ...maxxPatch(true, 85), sub: true, subAmount: 40, ceiling: -.1 } },
	{ id: "builtin:apex", name: "Apex", description: "The final form. Loudest clean stack there is.", patch: { ultimate: true, volume: 3000, ...maxxPatch(true, 100), mbLowPush: 3, clipDrive: 12, clipSoftness: 20, sub: true, subAmount: 70, eq: [...eqPresets.loudness.gains], preset: "loudness", ceiling: -.1 } },
	{ id: "builtin:brickwall", name: "Brickwall", description: "Squashed flat. Zero dynamics, all volume.", patch: { ultimate: true, volume: 2000, ...maxxPatch(true, 100), agcTarget: -6, maximizer: 100, mbAttack: 1, mbRelease: 40, clipDrive: 18, clipSoftness: 0, night: 60, ceiling: -.1 } },
	{ id: "builtin:jawline", name: "Jawline", description: "Bass that mogs.", patch: { volume: 300, ...maxxPatch(true, 50), bass: 10, phantomAmount: 70, sub: true, subAmount: 50, eq: [...eqPresets.bassExtreme.gains], preset: "bassExtreme" } },
	{ id: "builtin:phone", name: "Phone speaker cope", description: "For laptop and phone speakers.", patch: { volume: 400, ...maxxPatch(true, 70), lowCut: 150, phantomAmount: 80, phantomFreq: 120, exciterAmount: 35, presence: 4 } },
	{ id: "builtin:podcast", name: "Podcast-maxx", description: "Voices loud and clear.", patch: { volume: 200, vocals: "focus", presence: 6, agc: true, agcTarget: -12, multiband: true, maximizer: 40, night: 30, lowCut: 80, deesser: true } },
	{ id: "builtin:copium", name: "Copium night", description: "Quiet but clear late at night.", patch: { volume: 120, night: 70, agc: true, agcTarget: -20, lowCut: 60 } },
	{ id: "builtin:cooked", name: "Cooked", description: "Warm overdrive pushed into the red.", patch: { ultimate: true, volume: 1000, ...maxxPatch(true, 80), distortion: true, ...smashPresets.warm.patch, distDrive: 30, distMix: 80, ceiling: -.1 } },
	{ id: "builtin:bonesmashed", name: "Bonesmashed", description: "Crunchy distortion, still listenable.", patch: { volume: 300, distortion: true, ...smashPresets.crunch.patch, multiband: true, maximizer: 40 } },
	{ id: "builtin:jestermaxx", name: "Jestermaxx", description: "Helium robot clown. Pure brainrot.", patch: { volume: 400, ...voicePresets.jester.patch, distortion: true, ...smashPresets.bitcrush.patch } },
	{ id: "builtin:blown", name: "Blown speaker", description: "Sounds like the cone already tore.", patch: { ultimate: true, volume: 1500, distortion: true, ...smashPresets.blown.patch, bass: 12, sub: true, subAmount: 80, clip: true, clipDrive: 12, clipSoftness: 0 } },
	{ id: "builtin:skull", name: "Skull shatter", description: "Folded, crushed and unlimited.", patch: { ultimate: true, volume: 2500, limiter: false, distortion: true, ...smashPresets.fracture.patch, distDrive: 50, distBias: 30, distBits: 6, distRate: 3, distTone: 20000, distLevel: 0, sub: true, subAmount: 100, punch: true, punchAttack: 100, clip: true, clipDrive: 18, clipSoftness: 0 } },
	{ id: "builtin:over", name: "It's over", description: "Everything maxed. No limiter. Speakers beware.", patch: { ultimate: true, volume: 5000, limiter: false, distortion: true, ...smashPresets.destroy.patch, clip: true, clipDrive: 24, clipSoftness: 0, multiband: true, maximizer: 100, bass: 20, sub: true, subAmount: 100, punch: true, punchAttack: 100, eq: [...eqPresets.bassExtreme.gains], preset: "bassExtreme" } },
];

const secretPresets = [
	{ id: "builtin:moggod", name: "Mog god", description: "Clean, brutal and wide. Every stage tuned to the edge.", unlock: { stat: "boostedMs", value: 600000, text: "Mog any tab for 10 minutes" }, patch: { ultimate: true, volume: 4000, ...maxxPatch(true, 100), agcTarget: -7, maximizer: 100, clipDrive: 14, clipSoftness: 10, sub: true, subAmount: 60, width: 130, eq: [...eqPresets.smile.gains], preset: "smile", ceiling: -.1 } },
	{ id: "builtin:truecel", name: "Truecel ascension", description: "The loudest thing that still has a limiter.", unlock: { stat: "ascendedMs", value: 1800000, text: "Stay ascended for 30 minutes" }, patch: { ultimate: true, volume: 5000, ...maxxPatch(true, 100), agcTarget: -6, agcMaxBoost: 30, maximizer: 100, mbLowPush: 4, mbHighPush: 3, clipDrive: 20, clipSoftness: 0, punchAttack: 80, sub: true, subAmount: 80, phantomAmount: 90, exciterAmount: 60, ceiling: 0, truePeak: false, eq: [...eqPresets.smile.gains], preset: "smile" } },
	{ id: "builtin:bonecollector", name: "Bone collector", description: "Demon voice, folded and crushed, no limiter.", unlock: { stat: "smashedMs", value: 600000, text: "BONESMASH for 10 minutes" }, patch: { ultimate: true, volume: 3000, limiter: false, ...voicePresets.demon.patch, distortion: true, ...smashPresets.fracture.patch, distDrive: 55, distBits: 5, distRate: 4, sub: true, subAmount: 100, clip: true, clipDrive: 18, clipSoftness: 0 } },
];

const allBuiltInPresets = [...builtInPresets, ...secretPresets];

const commands = [
	["toggle-power", "Start or stop boosting the PC"],
	["volume-up", "Mog harder (volume up)"],
	["volume-down", "Mog softer (volume down)"],
	["volume-max", "Jump to the slider cap"],
	["toggle-mute", "Ghost or unghost (mute)"],
	["panic", "Panic: back to 100%, limiter on"],
	["toggle-maxx", "Toggle Loudmaxx"],
	["toggle-ascend", "Toggle ASCEND"],
	["toggle-limiter", "Toggle the cope limiter"],
	["toggle-distortion", "Toggle BONESMASHING"],
	["toggle-automog", "Toggle Auto-mog"],
	["toggle-gigamog", "Toggle Gigamog"],
	["toggle-original", "Hear the original or the boosted sound"],
	["toggle-record", "Start or stop recording"],
	["next-preset", "Switch to the next preset"],
	["next-voice", "Switch to the next voice"],
	["undo", "Undo the last change"],
	["redo", "Redo the last change"],
	["reset", "Back to normie (reset everything)"],
	["show-window", "Show or hide the window"],
];

function defaultHotkeys() {

	return {
		"toggle-power": "Alt+Shift+B",
		"volume-up": "Alt+Shift+Up",
		"volume-down": "Alt+Shift+Down",
		"toggle-mute": "Alt+Shift+M",
		"toggle-maxx": "Alt+Shift+L",
		"panic": "Alt+Shift+P",
	};

}

const tiers = [
	{ name: "Sub-5", volume: 50 },
	{ name: "Normie", volume: 100 },
	{ name: "MTN", volume: 200 },
	{ name: "HTN", volume: 400 },
	{ name: "Chadlite", volume: 600 },
	{ name: "Chad", volume: 1500 },
	{ name: "Gigachad", volume: 3000 },
	{ name: "Ascended", volume: 5000 },
];

const codeKeys = [
	"volume", "muted", "ultimate", "trim", "eq", "preset", "bass", "treble", "presence", "lowCut", "highCut",
	"pitch", "cents", "grain", "vocals", "balance", "width", "npc", "npcFreq", "npcMix",
	"echo", "echoTime", "echoFeedback", "echoMix", "reverb", "reverbSize", "reverbMix",
	"distortion", "distType", "distDrive", "distBias", "distBits", "distRate", "distTone", "distMix", "distLevel",
	"agc", "agcTarget", "agcMaxBoost", "agcSpeed",
	"multiband", "maximizer", "mbLowPush", "mbMidPush", "mbHighPush", "mbLowFreq", "mbHighFreq", "mbAttack", "mbRelease",
	"clip", "clipDrive", "clipSoftness", "clipOversample", "phantom", "phantomAmount", "phantomFreq",
	"exciter", "exciterAmount", "exciterFreq", "exciterDrive", "night", "limiter", "ceiling", "release", "lookahead", "truePeak",
	"pitchMode", "formant", "center", "monoBass", "monoBassFreq", "deesser", "deessFreq", "deessThreshold", "deessAmount",
	"punch", "punchAttack", "punchSustain", "sub", "subAmount", "subFreq", "maxxAmount", "eqQ",
	"postGain", "swap", "mono", "invertLeft", "invertRight", "gainLeft", "gainRight", "delay",
];

const simpleCodeKeys = [
	"volume", "muted", "ultimate", "maxx", "maxxAmount", "limiter", "eq", "preset", "bass", "treble",
	"voice", "pitch", "vocals", "distortion", "distType", "distDrive", "distBits", "distMix",
];

function defaultPrefs() {

	return {
		newTabs: "last",
		volumeStep: 10,
		normalCap: 600,
		ascendCap: 5000,
		showSpectrum: true,
		showTiers: true,
		accent: "#e6dcc3",
		hot: "#d21f2b",
		engineMode: "auto",
		cpuGuard: true,
		sync: true,
		autoStart: false,
		siteRules: [],
		source: "auto",
		sourceLabel: "",
		output: "auto",
		outputLabel: "",
		lastOutputLabel: "",
		mirror: "",
		mirrorLabel: "",
		mirrorVolume: 100,
		autoRoute: true,
		routeDevice: "",
		muteOriginal: true,
		latency: "interactive",
		closeToTray: true,
		startWithWindows: false,
		startMinimized: false,
		boostOnLaunch: false,
		alwaysOnTop: false,
		recordFolder: "",
		hotkeys: defaultHotkeys(),
	};

}

const prefLimits = {
	volumeStep: [1, 100000],
	normalCap: [100, 1000000000],
	ascendCap: [600, 1000000000],
	mirrorVolume: [0, 1000],
};

const controlIndex = new Map([...levelSection.controls, ...sections.flatMap(section => section.controls)].map(control => [control.key, control]));

function upgradeLegacy(saved) {

	const patch = { ...saved };
	if (typeof saved.voice === "number" && saved.presence === undefined) patch.presence = saved.voice;
	if (typeof saved.voice === "string" && saved.pitchMode === undefined) Object.assign(patch, voicePresets[saved.voice]?.patch ?? {}, { pitch: saved.pitch ?? 0 });
	if (saved.maxx === true && saved.agc === undefined) Object.assign(patch, maxxPatch(true, Number.isFinite(saved.maxxAmount) ? saved.maxxAmount : 60));
	return patch;

}

function mergeSettings(saved) {

	const settings = defaultSettings();
	if (!saved || typeof saved !== "object") return settings;

	const source = upgradeLegacy(saved);
	for (const key of Object.keys(settings)) {
		const value = source[key];
		if (typeof value !== typeof settings[key] || key === "eq") continue;
		if (typeof value === "number" && !Number.isFinite(value)) continue;
		const control = controlIndex.get(key);
		if (control?.type === "range") settings[key] = clamp(value, control.typeMin ?? control.min, control.typeMax ?? control.max);
		else if (control?.type === "choice") settings[key] = control.options.some(([option]) => option === value) ? value : settings[key];
		else settings[key] = value;
	}

	if (Array.isArray(source.eq) && source.eq.length === eqBands.length && source.eq.every(Number.isFinite)) {
		settings.eq = source.eq.map(gain => clamp(gain, -24, 24));
	}
	if (!eqPresets[settings.preset]) settings.preset = "custom";
	return settings;

}

function mergePrefs(saved) {

	const prefs = defaultPrefs();
	if (!saved || typeof saved !== "object") return prefs;

	for (const key of Object.keys(prefs)) {
		if (typeof saved[key] === typeof prefs[key]) prefs[key] = saved[key];
	}
	for (const [key, [min, max]] of Object.entries(prefLimits)) prefs[key] = clamp(Math.round(prefs[key]), min, max);
	for (const key of ["accent", "hot"]) {
		if (!/^#[0-9a-f]{6}$/i.test(prefs[key])) prefs[key] = defaultPrefs()[key];
	}
	if (!["auto", "direct", "capture"].includes(prefs.engineMode)) prefs.engineMode = "auto";
	if (!["interactive", "balanced", "playback"].includes(prefs.latency)) prefs.latency = "interactive";
	const hotkeys = {};
	if (saved.hotkeys && typeof saved.hotkeys === "object" && !Array.isArray(saved.hotkeys)) {
		for (const [command] of commands) {
			if (typeof saved.hotkeys[command] === "string" && saved.hotkeys[command]) hotkeys[command] = saved.hotkeys[command].slice(0, 60);
		}
		prefs.hotkeys = hotkeys;
	} else {
		prefs.hotkeys = defaultHotkeys();
	}
	prefs.newTabs = String(prefs.newTabs).replace(/^user:/, "preset:");
	prefs.siteRules = Array.isArray(saved.siteRules)
		? saved.siteRules
			.filter(rule => rule && typeof rule.pattern === "string" && typeof (rule.presetId ?? rule.stackId) === "string")
			.slice(0, 50)
			.map(rule => ({ pattern: rule.pattern.trim().toLowerCase().slice(0, 100), presetId: String(rule.presetId ?? rule.stackId).replace(/^user:/, "preset:") }))
		: [];
	return prefs;

}

function migratePresets(stored) {

	const source = Array.isArray(stored?.presets) ? stored.presets : Array.isArray(stored?.stacks) ? stored.stacks : [];
	return source
		.filter(preset => preset && typeof preset.name === "string" && preset.settings)
		.map(preset => ({ id: String(preset.id ?? "").replace(/^user:/, "preset:") || `preset:${Math.random().toString(36).slice(2, 10)}`, name: preset.name.slice(0, 40), settings: mergeSettings(preset.settings) }));

}

function hostOf(url) {

	try {
		const parsed = new URL(url);
		return /^https?:$/.test(parsed.protocol) ? parsed.hostname : "";
	} catch {
		return "";
	}

}

function ruleMatches(pattern, host) {

	const clean = String(pattern).trim().toLowerCase();
	if (!clean || !host) return false;
	if (clean.startsWith("*.")) {
		const root = clean.slice(2);
		return host === root || host.endsWith(`.${root}`);
	}
	const expression = clean.split("*").map(part => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
	return new RegExp(`^${expression}$`).test(host);

}

function presetIdForHost(host, prefs) {
	return prefs.siteRules.find(rule => ruleMatches(rule.pattern, host))?.presetId ?? null;
}

function findPreset(id, userPresets) {
	return allBuiltInPresets.find(preset => preset.id === id) ?? (userPresets ?? []).find(preset => preset.id === id) ?? null;
}

function isUnlocked(preset, stats) {
	return !preset.unlock || (stats?.[preset.unlock.stat] ?? 0) >= preset.unlock.value;
}

function maxVolume(settings, prefs) {
	return Math.max(settings.volume, settings.ultimate ? prefs.ascendCap : prefs.normalCap);
}

function isVirtualDevice(label) {
	return /cable|voicemeeter|virtual|vb-audio|blackhole/i.test(String(label ?? ""));
}

function isHot(settings) {
	return settings.ultimate || settings.distortion || !settings.limiter || settings.postGain > 0;
}

function tierFor(settings) {

	const volume = settings.volume;
	if (settings.muted || volume === 0) return "Ghosted";
	if (volume < 100) return "Sub-5";
	if (volume === 100) return "Normie";
	if (volume <= 200) return "MTN";
	if (volume <= 400) return "HTN";
	if (volume <= 600) return "Chadlite";
	if (volume <= 1500) return "Chad";
	if (volume < 5000) return "Gigachad";
	if (volume < 100000) return "Ascended";
	return "No limit";

}

function settingsMatch(first, second) {
	return Object.keys(first).every(key => key === "muted" || JSON.stringify(first[key]) === JSON.stringify(second[key]));
}

function presetSettings(preset) {
	return preset.patch ? mergeSettings({ ...defaultSettings(), ...preset.patch }) : mergeSettings(preset.settings);
}

function patchMatches(settings, patch) {

	return Object.entries(patch).every(([key, value]) => {
		if (Array.isArray(value)) return value.every((item, index) => settings[key]?.[index] === item);
		return settings[key] === value;
	});

}

function filterSpecs(settings) {

	const specs = eqBands.map((frequency, index) => ({
		type: index === 0 ? "lowshelf" : index === eqBands.length - 1 ? "highshelf" : "peaking",
		frequency,
		Q: settings.eqQ,
		gain: settings.eq[index],
	}));
	specs.push({ type: "lowshelf", frequency: 90, Q: 1, gain: settings.bass });
	specs.push({ type: "highshelf", frequency: 6500, Q: 1, gain: settings.treble });
	specs.push({ type: "peaking", frequency: 2800, Q: .9, gain: settings.presence });
	return specs;

}

function toBase64Url(bytes) {

	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

}

function fromBase64Url(text) {

	const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
	const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
	return Uint8Array.from(binary, character => character.charCodeAt(0));

}

async function encodeShareCode(settings, name) {

	const defaults = defaultSettings();
	const pairs = [];
	for (const [index, key] of codeKeys.entries()) {
		if (key === "muted") continue;
		if (JSON.stringify(settings[key]) !== JSON.stringify(defaults[key])) pairs.push([index, settings[key]]);
	}
	const json = JSON.stringify([String(name ?? "").slice(0, 40), pairs]);
	const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw"));
	return "BP5-" + toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));

}

async function decodeShareCode(code) {

	const clean = String(code ?? "").replace(/\s+/g, "");
	const version = clean.slice(0, 4);
	const keys = version === "BP4-" ? simpleCodeKeys : version === "BP5-" || version === "BP3-" ? codeKeys : null;
	if (!keys || clean.length > 6000) throw new Error("That isn't a Blackpill share code.");

	let parsed;
	try {
		const stream = new Blob([fromBase64Url(clean.slice(4))]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
		const text = await new Response(stream).text();
		if (text.length > 40000) throw new Error("too large");
		parsed = JSON.parse(text);
	} catch {
		throw new Error("That share code is damaged or incomplete.");
	}
	if (!Array.isArray(parsed) || !Array.isArray(parsed[1])) throw new Error("That share code is damaged or incomplete.");

	const patch = {};
	for (const pair of parsed[1]) {
		if (!Array.isArray(pair)) continue;
		const key = keys[pair[0]];
		if (key) patch[key] = pair[1];
	}
	return { name: typeof parsed[0] === "string" ? parsed[0].slice(0, 40) : "", settings: mergeSettings(patch) };

}
