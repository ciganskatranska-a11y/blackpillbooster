const shapeIndex = { soft: 0, hard: 1, fuzz: 2, fold: 3, square: 4 };
const speedIndex = { slow: 0, medium: 1, fast: 2 };

function makeImpulse(context, seconds) {

	const length = Math.max(1, Math.round(seconds * context.sampleRate));
	const impulse = new AudioBuffer({ numberOfChannels: 2, length, sampleRate: context.sampleRate });
	for (let channel = 0; channel < 2; channel++) {
		const data = impulse.getChannelData(channel);
		for (let index = 0; index < length; index++) data[index] = (Math.random() * 2 - 1) * Math.exp(-6.9 * index / length);
	}
	return impulse;

}

function makeExciterCurve(drive) {

	const curve = new Float32Array(2048);
	for (let index = 0; index < curve.length; index++) {
		const sample = index / (curve.length - 1) * 2 - 1;
		curve[index] = Math.tanh(drive * sample) / drive;
	}
	return curve;

}

function buildSpectrumBands(sampleRate, fftSize) {

	const binWidth = sampleRate / fftSize;
	const last = fftSize / 2 - 1;
	return Array.from({ length: 40 }, (_, index) => {
		const start = 30 * (16000 / 30) ** (index / 40);
		const end = 30 * (16000 / 30) ** ((index + 1) / 40);
		const first = Math.min(last, Math.floor(start / binWidth));
		return [first, Math.max(first, Math.min(last, Math.ceil(end / binWidth) - 1))];
	});

}

class Engine {

	constructor(context, settings, options = {}) {

		this.context = context;
		this.settings = settings;
		this.isGuardEnabled = options.isGuardEnabled ?? true;
		this.onGuard = options.onGuard ?? null;
		this.isGuarded = false;
		this.isIdle = false;
		this.compare = "boosted";
		this.levels = { peak: 0, gain: 1, lufs: -100, outShort: -100, inShort: -100 };
		this.silentData = new Float32Array(256);
		this.agcGain = 0;
		this.reduction = [0, 0, 0];
		this.shaved = 0;
		this.deess = 0;
		this.loads = new Map();
		this.overloadSince = 0;
		this.topology = "";
		this.reverbSize = 0;
		this.exciterDrive = 0;
		this.nodes = [];
		this.worklets = [];
		this.recorder = null;
		this.recordingSince = 0;
		this.spectrumBands = buildSpectrumBands(context.sampleRate, 2048);

		const node = created => {
			this.nodes.push(created);
			return created;
		};
		const worklet = (name, inputs = 1) => {
			const created = node(new AudioWorkletNode(context, name, { numberOfInputs: inputs, outputChannelCount: [2] }));
			this.worklets.push(created);
			return created;
		};
		const gain = value => node(new GainNode(context, { gain: value }));
		const filter = options => node(new BiquadFilterNode(context, options));

		this.input = node(new GainNode(context, { channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers" }));
		this.inputAnalyser = node(new AnalyserNode(context, { fftSize: 2048, smoothingTimeConstant: .7 }));
		this.trim = gain(1);

		this.channelSplit = node(new ChannelSplitterNode(context, { numberOfOutputs: 2 }));
		this.channelMerge = node(new ChannelMergerNode(context, { numberOfInputs: 2 }));
		this.channelGains = [gain(1), gain(0), gain(0), gain(1)];
		this.channelDelay = node(new DelayNode(context, { maxDelayTime: 5, delayTime: 0 }));
		this.channelSplit.connect(this.channelGains[0], 0);
		this.channelSplit.connect(this.channelGains[1], 1);
		this.channelSplit.connect(this.channelGains[2], 0);
		this.channelSplit.connect(this.channelGains[3], 1);
		this.channelGains[0].connect(this.channelMerge, 0, 0);
		this.channelGains[1].connect(this.channelMerge, 0, 0);
		this.channelGains[2].connect(this.channelMerge, 0, 1);
		this.channelGains[3].connect(this.channelMerge, 0, 1);
		this.channelMerge.connect(this.channelDelay);

		this.cutFilters = [
			filter({ type: "highpass", frequency: 10, Q: .5412 }),
			filter({ type: "highpass", frequency: 10, Q: 1.3066 }),
			filter({ type: "lowpass", frequency: 22000, Q: .5412 }),
			filter({ type: "lowpass", frequency: 22000, Q: 1.3066 }),
		];
		this.chainNodes(this.cutFilters);

		this.pitch = worklet("pitch-shifter");
		this.pitchHd = worklet("pitch-hd");
		this.buildMatrix(gain, filter, node);

		this.filters = filterSpecs(settings).map(spec => filter(spec));
		this.chainNodes(this.filters);

		this.deesser = worklet("deesser");
		this.sub = worklet("sub-octave");
		this.phantom = worklet("phantom-bass");

		this.exciterIn = gain(1);
		this.exciterOut = gain(1);
		this.exciterLow = filter({ type: "highpass", frequency: 3500, Q: Math.SQRT1_2 });
		this.exciterShaper = node(new WaveShaperNode(context, { oversample: "4x" }));
		this.exciterHigh = filter({ type: "highpass", frequency: 3500, Q: Math.SQRT1_2 });
		this.exciterWet = gain(0);
		this.exciterIn.connect(this.exciterOut);
		this.exciterIn.connect(this.exciterLow).connect(this.exciterShaper).connect(this.exciterHigh).connect(this.exciterWet).connect(this.exciterOut);

		this.distortion = worklet("distortion");

		this.npcIn = gain(1);
		this.npcOut = gain(1);
		this.npcDry = gain(0);
		this.npcRing = gain(0);
		this.npcWet = gain(1);
		this.npcOscillator = node(new OscillatorNode(context, { frequency: 40 }));
		this.npcIn.connect(this.npcDry).connect(this.npcOut);
		this.npcIn.connect(this.npcRing).connect(this.npcWet).connect(this.npcOut);
		this.npcOscillator.connect(this.npcRing.gain);
		this.npcOscillator.start();

		this.echoIn = gain(1);
		this.echoOut = gain(1);
		this.echoDelay = node(new DelayNode(context, { maxDelayTime: 2, delayTime: .28 }));
		this.echoDamp = filter({ type: "lowpass", frequency: 4500, Q: Math.SQRT1_2 });
		this.echoFeedback = gain(.35);
		this.echoWet = gain(.35);
		this.echoIn.connect(this.echoOut);
		this.echoIn.connect(this.echoDelay).connect(this.echoWet).connect(this.echoOut);
		this.echoDelay.connect(this.echoDamp).connect(this.echoFeedback).connect(this.echoDelay);

		this.reverbIn = gain(1);
		this.reverbOut = gain(1);
		this.convolver = node(new ConvolverNode(context));
		this.reverbWet = gain(.3);
		this.reverbIn.connect(this.reverbOut);
		this.reverbIn.connect(this.convolver).connect(this.reverbWet).connect(this.reverbOut);

		this.punch = worklet("punch");
		this.night = node(new DynamicsCompressorNode(context, { knee: 10, attack: .01, release: .25 }));
		this.agc = worklet("auto-gain");
		this.volume = gain(1);
		this.multiband = worklet("multiband");
		this.clipper = worklet("clipper");
		this.mute = gain(1);
		this.limiter = worklet("limiter", 2);
		this.post = gain(1);
		this.matchGain = gain(1);
		this.mirror = null;
		this.rawGain = gain(0);
		this.output = gain(1);
		this.analyser = node(new AnalyserNode(context, { fftSize: 2048, smoothingTimeConstant: .7 }));
		this.spectrumData = new Float32Array(this.analyser.frequencyBinCount);

		this.limiter.connect(this.post).connect(this.matchGain).connect(this.output);
		this.rawGain.connect(this.output);
		this.output.connect(context.destination);
		this.output.connect(this.analyser);
		this.connectTaps();

		const listen = (target, handler) => {
			target.port.onmessage = event => {
				if (event.data.load !== undefined) {
					this.loads.set(target, event.data.load);
					this.checkLoad();
					return;
				}
				handler(event.data);
			};
		};
		for (const target of this.worklets) listen(target, () => {});
		listen(this.limiter, data => {
			this.levels = data;
			if (this.compare === "matched") this.updateMatch();
		});
		listen(this.agc, data => {
			this.agcGain = data.gain;
		});
		listen(this.multiband, data => {
			this.reduction = data.reduction;
		});
		listen(this.clipper, data => {
			this.shaved = data.shaved;
		});
		listen(this.deesser, data => {
			this.deess = data.reduction;
		});

		this.stages = [
			{ input: this.trim, output: this.trim, isActive: current => current.trim !== 0 },
			{ input: this.channelSplit, output: this.channelDelay, isActive: current => current.swap || current.mono || current.invertLeft || current.invertRight || current.gainLeft !== 0 || current.gainRight !== 0 || current.delay > 0 },
			{ input: this.cutFilters[0], output: this.cutFilters.at(-1), isActive: current => current.lowCut > 20 || current.highCut < 20000 },
			{ input: this.pitch, output: this.pitch, isActive: current => current.pitchMode !== "hd" && (current.pitch !== 0 || current.cents !== 0) },
			{ input: this.pitchHd, output: this.pitchHd, isActive: current => current.pitchMode === "hd" && (current.pitch !== 0 || current.cents !== 0 || current.formant !== 0) },
			{ input: this.splitter, output: this.merger, isActive: current => current.vocals !== "normal" || current.balance !== 0 || current.width !== 100 || current.center !== 0 || current.monoBass },
			{ input: this.filters[0], output: this.filters.at(-1), isActive: current => current.eq.some(value => value !== 0) || current.bass !== 0 || current.treble !== 0 || current.presence !== 0 },
			{ input: this.deesser, output: this.deesser, isActive: current => current.deesser },
			{ input: this.sub, output: this.sub, isActive: current => current.sub },
			{ input: this.phantom, output: this.phantom, isActive: current => current.phantom },
			{ input: this.exciterIn, output: this.exciterOut, isActive: current => current.exciter },
			{ input: this.distortion, output: this.distortion, isActive: current => current.distortion },
			{ input: this.npcIn, output: this.npcOut, isActive: current => current.npc },
			{ input: this.echoIn, output: this.echoOut, isActive: current => current.echo },
			{ input: this.reverbIn, output: this.reverbOut, isActive: current => current.reverb },
			{ input: this.punch, output: this.punch, isActive: current => current.punch },
			{ input: this.night, output: this.night, isActive: current => current.night > 0 },
			{ input: this.agc, output: this.agc, isActive: current => current.agc },
			{ input: this.volume, output: this.volume, isActive: () => true },
			{ input: this.multiband, output: this.multiband, isActive: current => current.multiband },
			{ input: this.clipper, output: this.clipper, isActive: current => current.clip },
			{ input: this.mute, output: this.mute, isActive: () => true },
		];

		this.apply(settings);

	}

	chainNodes(list) {

		for (let index = 1; index < list.length; index++) list[index - 1].connect(list[index]);

	}

	buildMatrix(gain, filter, node) {

		const context = this.context;
		this.splitter = node(new ChannelSplitterNode(context, { numberOfOutputs: 2 }));
		this.merger = node(new ChannelMergerNode(context, { numberOfInputs: 2 }));
		this.focusHigh = filter({ type: "highpass", frequency: 0 });
		this.focusLow = filter({ type: "lowpass", frequency: context.sampleRate / 2 });
		this.monoFilters = [filter({ type: "highpass", frequency: 10, Q: Math.SQRT1_2 }), filter({ type: "highpass", frequency: 10, Q: Math.SQRT1_2 })];
		this.midLeft = gain(1);
		this.midRight = gain(1);
		this.sideLeft = gain(1);
		this.sideRight = gain(-1);

		const mid = gain(1);
		const side = gain(1);
		const leftToMid = gain(.5);
		const rightToMid = gain(.5);
		const leftToSide = gain(.5);
		const rightToSide = gain(-.5);

		this.splitter.connect(leftToMid, 0);
		this.splitter.connect(leftToSide, 0);
		this.splitter.connect(rightToMid, 1);
		this.splitter.connect(rightToSide, 1);
		leftToMid.connect(mid);
		rightToMid.connect(mid);
		leftToSide.connect(side);
		rightToSide.connect(side);
		mid.connect(this.focusHigh).connect(this.focusLow);
		this.focusLow.connect(this.midLeft);
		this.focusLow.connect(this.midRight);
		side.connect(this.monoFilters[0]).connect(this.monoFilters[1]);
		this.monoFilters[1].connect(this.sideLeft);
		this.monoFilters[1].connect(this.sideRight);
		this.midLeft.connect(this.merger, 0, 0);
		this.sideLeft.connect(this.merger, 0, 0);
		this.midRight.connect(this.merger, 0, 1);
		this.sideRight.connect(this.merger, 0, 1);

	}

	connectTaps() {

		this.input.connect(this.limiter, 0, 1);
		this.input.connect(this.rawGain);
		this.input.connect(this.inputAnalyser);

	}

	effective(settings) {
		return this.isGuarded ? { ...settings, clipOversample: false, truePeak: false, pitchMode: "fast" } : settings;
	}

	apply(settings) {

		this.settings = settings;
		const current = this.effective(settings);
		const context = this.context;
		const now = context.currentTime;
		const glide = (param, value) => {
			param.cancelAndHoldAtTime(now);
			param.setTargetAtTime(value, now, .015);
		};
		const set = (param, value) => {
			param.cancelScheduledValues(now);
			param.setValueAtTime(value, now);
		};
		const worklet = (target, values) => {
			for (const [name, value] of Object.entries(values)) set(target.parameters.get(name), value);
		};

		glide(this.trim.gain, 10 ** (current.trim / 20));

		const leftLevel = 10 ** (current.gainLeft / 20) * (current.invertLeft ? -1 : 1);
		const rightLevel = 10 ** (current.gainRight / 20) * (current.invertRight ? -1 : 1);
		const matrix = current.mono ? [.5, .5, .5, .5] : current.swap ? [0, 1, 1, 0] : [1, 0, 0, 1];
		glide(this.channelGains[0].gain, matrix[0] * leftLevel);
		glide(this.channelGains[1].gain, matrix[1] * leftLevel);
		glide(this.channelGains[2].gain, matrix[2] * rightLevel);
		glide(this.channelGains[3].gain, matrix[3] * rightLevel);
		glide(this.channelDelay.delayTime, current.delay / 1000);

		set(this.cutFilters[0].frequency, current.lowCut > 20 ? current.lowCut : 10);
		set(this.cutFilters[1].frequency, current.lowCut > 20 ? current.lowCut : 10);
		set(this.cutFilters[2].frequency, current.highCut < 20000 ? current.highCut : context.sampleRate / 2);
		set(this.cutFilters[3].frequency, current.highCut < 20000 ? current.highCut : context.sampleRate / 2);

		const ratio = 2 ** ((current.pitch + current.cents / 100) / 12);
		worklet(this.pitch, { ratio, grain: current.grain });
		worklet(this.pitchHd, { ratio, formant: 2 ** (current.formant / 12) });

		const balance = current.balance / 100;
		const leftGain = balance > 0 ? 1 - balance : 1;
		const rightGain = balance < 0 ? 1 + balance : 1;
		const isFocus = current.vocals === "focus";
		let midGain = 10 ** (current.center / 20);
		let sideLeftGain = current.width / 100;
		let sideRightGain = -current.width / 100;
		if (current.vocals === "remove") {
			midGain = 0;
			sideLeftGain = 1.5;
			sideRightGain = 1.5;
		} else if (isFocus) {
			sideLeftGain = 0;
			sideRightGain = 0;
		}
		glide(this.midLeft.gain, midGain * leftGain);
		glide(this.midRight.gain, midGain * rightGain);
		glide(this.sideLeft.gain, sideLeftGain * leftGain);
		glide(this.sideRight.gain, sideRightGain * rightGain);
		set(this.focusHigh.frequency, isFocus ? 150 : 0);
		set(this.focusLow.frequency, isFocus ? 6500 : context.sampleRate / 2);
		for (const monoFilter of this.monoFilters) set(monoFilter.frequency, current.monoBass ? current.monoBassFreq : 10);

		const specs = filterSpecs(current);
		for (const [index, eqFilter] of this.filters.entries()) {
			glide(eqFilter.gain, specs[index].gain);
			set(eqFilter.Q, specs[index].Q);
		}

		worklet(this.deesser, { frequency: current.deessFreq, threshold: current.deessThreshold, amount: current.deessAmount });
		worklet(this.sub, { amount: current.subAmount / 100 * 1.2, frequency: current.subFreq });
		worklet(this.phantom, { amount: current.phantomAmount / 100 * 1.2, frequency: current.phantomFreq });

		set(this.exciterLow.frequency, current.exciterFreq);
		set(this.exciterHigh.frequency, current.exciterFreq);
		glide(this.exciterWet.gain, current.exciterAmount / 100);
		if (current.exciter && current.exciterDrive !== this.exciterDrive) {
			this.exciterDrive = current.exciterDrive;
			this.exciterShaper.curve = makeExciterCurve(current.exciterDrive);
		}

		worklet(this.distortion, {
			drive: current.distDrive,
			shape: shapeIndex[current.distType] ?? 0,
			bias: current.distBias / 200,
			bits: current.distBits,
			rate: current.distRate,
			tone: current.distTone,
			mix: current.distMix / 100,
			level: current.distLevel,
		});

		set(this.npcOscillator.frequency, current.npcFreq);
		glide(this.npcDry.gain, 1 - current.npcMix / 100);
		glide(this.npcWet.gain, current.npcMix / 100 * 1.4);

		glide(this.echoDelay.delayTime, current.echoTime / 1000);
		glide(this.echoFeedback.gain, current.echoFeedback / 100);
		glide(this.echoWet.gain, current.echoMix / 100);

		glide(this.reverbWet.gain, current.reverbMix / 100 * 1.5);
		if (current.reverb && current.reverbSize !== this.reverbSize) {
			this.reverbSize = current.reverbSize;
			this.convolver.buffer = makeImpulse(context, current.reverbSize);
		}

		worklet(this.punch, { attack: current.punchAttack / 100, sustain: current.punchSustain / 100 });

		set(this.night.threshold, -10 - current.night * .4);
		set(this.night.ratio, 1.5 + current.night * .105);

		worklet(this.agc, { target: current.agcTarget, maxBoost: current.agcMaxBoost, speed: speedIndex[current.agcSpeed] ?? 1 });

		glide(this.volume.gain, current.volume / 100 * 10 ** (current.night * .0075));

		worklet(this.multiband, {
			strength: current.maximizer,
			lowPush: current.mbLowPush,
			midPush: current.mbMidPush,
			highPush: current.mbHighPush,
			lowFreq: current.mbLowFreq,
			highFreq: current.mbHighFreq,
			attack: current.mbAttack,
			release: current.mbRelease,
		});

		worklet(this.clipper, { drive: current.clipDrive, softness: current.clipSoftness / 100, oversample: current.clipOversample ? 1 : 0 });

		glide(this.mute.gain, current.muted ? 0 : 1);
		glide(this.post.gain, 10 ** (current.postGain / 20));

		worklet(this.limiter, {
			enabled: current.limiter ? 1 : 0,
			ceiling: current.ceiling,
			release: current.release,
			lookahead: current.lookahead,
			truePeak: current.truePeak ? 1 : 0,
		});

		if (this.isIdle) {
			this.isIdle = false;
			this.setCompare("boosted");
		}
		this.rewire(current);

	}

	rewire(current) {

		const active = this.stages.filter(stage => stage.isActive(current));
		const topology = active.map(stage => this.stages.indexOf(stage)).join(",");
		if (topology === this.topology) return;

		this.topology = topology;
		this.disconnectChain();

		let previous = this.input;
		for (const stage of active) {
			previous.connect(stage.input);
			previous = stage.output;
		}
		previous.connect(this.limiter, 0, 0);

	}

	disconnectChain() {

		this.input.disconnect();
		for (const stage of this.stages) stage.output.disconnect();
		this.connectTaps();

	}

	idle() {

		this.isIdle = true;
		this.topology = "";
		this.disconnectChain();
		this.setCompare("original");

	}

	isInputSilent() {

		this.inputAnalyser.getFloatTimeDomainData(this.silentData);
		return this.silentData.every(value => value === 0);

	}

	setCompare(mode) {

		const now = this.context.currentTime;
		this.compare = mode;
		for (const param of [this.matchGain.gain, this.rawGain.gain]) param.cancelAndHoldAtTime(now);
		this.matchGain.gain.setTargetAtTime(mode === "original" ? 0 : 1, now, .02);
		this.rawGain.gain.setTargetAtTime(mode === "original" ? 1 : 0, now, .02);
		if (mode === "matched") this.updateMatch();

	}

	updateMatch() {

		const { inShort, outShort } = this.levels;
		if (inShort <= -70 || outShort <= -70) return;
		const offset = Math.max(-40, Math.min(12, inShort - outShort));
		const now = this.context.currentTime;
		this.matchGain.gain.cancelAndHoldAtTime(now);
		this.matchGain.gain.setTargetAtTime(10 ** (offset / 20), now, .3);

	}

	checkLoad() {

		let total = 0;
		for (const value of this.loads.values()) total += value;
		this.load = total;
		if (!this.isGuardEnabled || this.isGuarded) return;

		if (total < .7) {
			this.overloadSince = 0;
			return;
		}
		this.overloadSince ||= Date.now();
		if (Date.now() - this.overloadSince < 3000) return;

		this.isGuarded = true;
		this.topology = "";
		this.apply(this.settings);
		this.onGuard?.();

	}

	setGuardEnabled(isEnabled) {

		this.isGuardEnabled = isEnabled;
		if (isEnabled || !this.isGuarded) return;
		this.isGuarded = false;
		this.topology = "";
		this.apply(this.settings);

	}

	spectrum(view) {

		const analyser = view === "before" ? this.inputAnalyser : this.analyser;
		analyser.getFloatFrequencyData(this.spectrumData);
		return this.spectrumBands.map(([first, last]) => {
			let peak = -Infinity;
			for (let bin = first; bin <= last; bin++) peak = Math.max(peak, this.spectrumData[bin]);
			return Math.round(clamp((peak + 85) / 85, 0, 1) * 100) / 100;
		});

	}

	report(isSpectrum, view) {

		const settings = this.settings;
		return {
			...this.levels,
			agc: settings.agc ? this.agcGain : 0,
			reduction: settings.multiband ? this.reduction : [0, 0, 0],
			shaved: settings.clip ? this.shaved : 0,
			deess: settings.deesser ? this.deess : 0,
			load: this.load ?? 0,
			isGuarded: this.isGuarded,
			compare: this.compare,
			recordingSince: this.recordingSince,
			spectrum: isSpectrum ? this.spectrum(view) : null,
		};

	}

	startRecording() {

		if (this.recorder) return false;
		const destination = this.context.createMediaStreamDestination();
		const type = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find(candidate => MediaRecorder.isTypeSupported(candidate)) ?? "";
		const recorder = new MediaRecorder(destination.stream, { mimeType: type, audioBitsPerSecond: 256000 });
		const chunks = [];
		this.output.connect(destination);
		recorder.ondataavailable = event => {
			if (event.data.size) chunks.push(event.data);
		};
		this.recorder = { recorder, destination, chunks, type };
		this.recordingSince = Date.now();
		recorder.start(1000);
		return true;

	}

	stopRecording() {

		const active = this.recorder;
		if (!active) return Promise.resolve(null);

		this.recorder = null;
		this.recordingSince = 0;
		return new Promise(resolve => {
			active.recorder.onstop = () => {
				this.output.disconnect(active.destination);
				resolve(new Blob(active.chunks, { type: active.type || "audio/webm" }));
			};
			active.recorder.stop();
		});

	}

	async setMirror(sinkId, volume) {

		if (!sinkId) {
			if (!this.mirror) return;
			this.mirror.audio.pause();
			this.mirror.audio.srcObject = null;
			this.output.disconnect(this.mirror.gain);
			this.mirror.gain.disconnect();
			this.mirror = null;
			return;
		}

		if (!this.mirror) {
			const mirrorGain = new GainNode(this.context, { gain: volume / 100 });
			const destination = this.context.createMediaStreamDestination();
			const audio = new Audio();
			this.output.connect(mirrorGain).connect(destination);
			audio.srcObject = destination.stream;
			this.mirror = { gain: mirrorGain, destination, audio, sinkId: "" };
		}
		this.mirror.gain.gain.setTargetAtTime(volume / 100, this.context.currentTime, .015);
		if (this.mirror.sinkId !== sinkId) {
			await this.mirror.audio.setSinkId(sinkId);
			this.mirror.sinkId = sinkId;
		}
		await this.mirror.audio.play();

	}

	destroy() {

		this.setMirror("", 0);
		if (this.recorder) this.recorder.recorder.stop();
		this.recorder = null;
		this.npcOscillator.stop();
		for (const target of this.worklets) target.port.onmessage = null;
		for (const created of this.nodes) created.disconnect();

	}

}
