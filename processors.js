class Biquad {

	constructor() {

		this.b0 = 1;
		this.b1 = 0;
		this.b2 = 0;
		this.a1 = 0;
		this.a2 = 0;
		this.z1 = 0;
		this.z2 = 0;

	}

	set(b0, b1, b2, a1, a2) {

		this.b0 = b0;
		this.b1 = b1;
		this.b2 = b2;
		this.a1 = a1;
		this.a2 = a2;

	}

	process(sample) {

		const output = this.b0 * sample + this.z1;
		this.z1 = this.b1 * sample - this.a1 * output + this.z2;
		this.z2 = this.b2 * sample - this.a2 * output;
		return output;

	}

}

function setButterworth(filter, type, frequency, q = Math.SQRT1_2) {

	const omega = 2 * Math.PI * Math.min(frequency, sampleRate * .49) / sampleRate;
	const cosine = Math.cos(omega);
	const alpha = Math.sin(omega) / (2 * q);
	const a0 = 1 + alpha;
	const isLow = type === "low";
	const edge = isLow ? (1 - cosine) / 2 : (1 + cosine) / 2;
	filter.set(edge / a0, (isLow ? 2 : -2) * edge / a0, edge / a0, -2 * cosine / a0, (1 - alpha) / a0);

}

function setKWeighting(shelf, highpass) {

	let k = Math.tan(Math.PI * 1681.974450955533 / sampleRate);
	const vh = 10 ** (3.999843853973347 / 20);
	const vb = vh ** .4996667741545416;
	let q = .7071752369554196;
	let a0 = 1 + k / q + k * k;
	shelf.set((vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0);

	k = Math.tan(Math.PI * 38.13547087602444 / sampleRate);
	q = .5003270373238773;
	a0 = 1 + k / q + k * k;
	highpass.set(1, -2, 1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0);

}

function designLowpass(length, cutoff) {

	const taps = new Float64Array(length);
	const middle = (length - 1) / 2;
	let sum = 0;
	for (let index = 0; index < length; index++) {
		const offset = index - middle;
		const sinc = offset === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * offset) / (Math.PI * offset);
		const phase = 2 * Math.PI * index / (length - 1);
		taps[index] = sinc * (.42 - .5 * Math.cos(phase) + .08 * Math.cos(2 * phase));
		sum += taps[index];
	}
	for (let index = 0; index < length; index++) taps[index] /= sum;
	return taps;

}

const oversampleTaps = designLowpass(96, .125);

class Upsampler {

	constructor() {

		const size = oversampleTaps.length / 4;
		this.size = size;
		this.taps = new Float64Array(oversampleTaps.length);
		for (let phase = 0; phase < 4; phase++) {
			for (let index = 0; index < size; index++) this.taps[phase * size + index] = oversampleTaps[index * 4 + phase] * 4;
		}
		this.buffer = new Float64Array(size * 2);
		this.position = 0;

	}

	process(sample, output) {

		const size = this.size;
		const buffer = this.buffer;
		const taps = this.taps;
		const position = this.position;
		const newest = position + size;
		buffer[position] = sample;
		buffer[newest] = sample;

		let first = 0;
		let second = 0;
		let third = 0;
		let fourth = 0;
		for (let index = 0; index < size; index++) {
			const value = buffer[newest - index];
			first += taps[index] * value;
			second += taps[size + index] * value;
			third += taps[2 * size + index] * value;
			fourth += taps[3 * size + index] * value;
		}
		output[0] = first;
		output[1] = second;
		output[2] = third;
		output[3] = fourth;
		this.position = position + 1 === size ? 0 : position + 1;

	}

}

class Downsampler {

	constructor() {

		this.size = oversampleTaps.length;
		this.buffer = new Float64Array(this.size * 2);
		this.position = 0;

	}

	process(first, second, third, fourth) {

		const size = this.size;
		const buffer = this.buffer;
		let position = this.position;
		buffer[position] = first;
		buffer[position + size] = first;
		position = position + 1 === size ? 0 : position + 1;
		buffer[position] = second;
		buffer[position + size] = second;
		position = position + 1 === size ? 0 : position + 1;
		buffer[position] = third;
		buffer[position + size] = third;
		position = position + 1 === size ? 0 : position + 1;
		buffer[position] = fourth;
		buffer[position + size] = fourth;
		const newest = position + size;
		this.position = position + 1 === size ? 0 : position + 1;

		let sum = 0;
		for (let index = 0; index < size; index++) sum += oversampleTaps[index] * buffer[newest - index];
		return sum;

	}

}

class LoudnessMeter {

	constructor() {

		this.filters = [0, 1].map(() => {
			const shelf = new Biquad();
			const highpass = new Biquad();
			setKWeighting(shelf, highpass);
			return [shelf, highpass];
		});
		this.blocks = new Float64Array(Math.max(2, Math.round(3 * sampleRate / 128)));
		this.momentaryBlocks = Math.max(1, Math.round(.4 * sampleRate / 128));
		this.position = 0;
		this.shortSum = 0;
		this.momentarySum = 0;
		this.current = 0;
		this.frames = 0;
		this.blockFrames = 128;

	}

	add(left, right) {

		const weightedLeft = this.filters[0][1].process(this.filters[0][0].process(left));
		const weightedRight = this.filters[1][1].process(this.filters[1][0].process(right));
		this.current += weightedLeft * weightedLeft + weightedRight * weightedRight;
		this.frames++;

	}

	endBlock() {

		const blocks = this.blocks;
		const length = blocks.length;
		const position = this.position;
		this.shortSum += this.current - blocks[position];
		this.momentarySum += this.current - blocks[(position - this.momentaryBlocks + length) % length];
		blocks[position] = this.current;
		this.position = (position + 1) % length;

		if (this.position === 0) {
			this.shortSum = blocks.reduce((total, value) => total + value, 0);
			this.momentarySum = blocks.subarray(length - this.momentaryBlocks).reduce((total, value) => total + value, 0);
		}
		this.blockFrames = this.frames || 128;
		this.current = 0;
		this.frames = 0;

	}

	toLufs(sum, count) {

		const meanSquare = Math.max(0, sum) / (count * this.blockFrames);
		return meanSquare > 1e-10 ? Math.max(-100, -.691 + 10 * Math.log10(meanSquare)) : -100;

	}

	get momentary() {
		return this.toLufs(this.momentarySum, this.momentaryBlocks);
	}

	get shortTerm() {
		return this.toLufs(this.shortSum, this.blocks.length);
	}

}

class Reporter {

	constructor(seconds) {

		this.interval = Math.round(sampleRate * seconds);
		this.counter = 0;

	}

	tick(frames) {

		this.counter += frames;
		if (this.counter < this.interval) return false;

		this.counter = 0;
		return true;

	}

}

class MeteredProcessor extends AudioWorkletProcessor {

	constructor() {

		super();
		this.busy = 0;
		this.busyFrames = 0;

	}

	process(inputs, outputs, parameters) {

		const started = Date.now();
		this.render(inputs, outputs, parameters);
		this.busy += Date.now() - started;
		this.busyFrames += outputs[0]?.[0]?.length ?? 128;
		if (this.busyFrames >= sampleRate) {
			this.port.postMessage({ load: this.busy / (this.busyFrames / sampleRate * 1000) });
			this.busy = 0;
			this.busyFrames = 0;
		}
		return true;

	}

}

class Limiter extends MeteredProcessor {

	static get parameterDescriptors() {

		return [
			{ name: "enabled", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
			{ name: "ceiling", defaultValue: -.3, minValue: -24, maxValue: 0, automationRate: "k-rate" },
			{ name: "release", defaultValue: 60, minValue: 1, maxValue: 2000, automationRate: "k-rate" },
			{ name: "lookahead", defaultValue: 4, minValue: 1, maxValue: 10, automationRate: "k-rate" },
			{ name: "truePeak", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
		];

	}

	constructor() {

		super();
		this.upsamplers = [new Upsampler(), new Upsampler()];
		this.phaseValues = new Float64Array(4);
		this.meter = new LoudnessMeter();
		this.inputMeter = new LoudnessMeter();
		this.reporter = new Reporter(.04);
		this.reportPeak = 0;
		this.reportGain = 1;
		this.configure(4, true);

	}

	configure(lookaheadMs, isTruePeak) {

		const lookahead = Math.max(1, Math.round(sampleRate * lookaheadMs / 1000));
		const delay = lookahead + (isTruePeak ? 12 : 0);
		this.lookaheadMs = lookaheadMs;
		this.isTruePeak = isTruePeak;
		this.lookahead = lookahead;
		this.span = lookahead + 1;
		this.delays = [new Float32Array(delay), new Float32Array(delay)];
		this.delayLength = delay;
		this.delayPosition = 0;
		this.box = new Float64Array(lookahead).fill(1);
		this.boxSum = lookahead;
		this.boxPosition = 0;
		this.dequeValues = new Float64Array(this.span);
		this.dequeTimes = new Float64Array(this.span);
		this.dequeHead = 0;
		this.dequeCount = 0;
		this.time = 0;
		this.envelope = 1;

	}

	detect(left, right) {

		if (!this.isTruePeak) return Math.max(Math.abs(left), Math.abs(right));

		const values = this.phaseValues;
		this.upsamplers[0].process(left, values);
		const leftPeak = Math.max(Math.abs(values[0]), Math.abs(values[1]), Math.abs(values[2]), Math.abs(values[3]));
		this.upsamplers[1].process(right, values);
		return Math.max(leftPeak, Math.abs(values[0]), Math.abs(values[1]), Math.abs(values[2]), Math.abs(values[3]));

	}

	render(inputs, outputs, parameters) {

		const lookaheadMs = parameters.lookahead[0];
		const isTruePeak = parameters.truePeak[0] >= .5;
		if (lookaheadMs !== this.lookaheadMs || isTruePeak !== this.isTruePeak) this.configure(lookaheadMs, isTruePeak);

		const input = inputs[0];
		const output = outputs[0];
		const frames = output[0].length;
		const ceiling = 10 ** (parameters.ceiling[0] / 20);
		const releaseCoefficient = 1 - Math.exp(-1 / (sampleRate * parameters.release[0] / 1000));
		const isLimiting = parameters.enabled[0] >= .5;
		const left = input?.[0];
		const right = input?.[1] ?? left;
		const raw = inputs[1];
		const rawLeft = raw?.[0];
		const rawRight = raw?.[1] ?? rawLeft;
		const span = this.span;
		const values = this.dequeValues;
		const times = this.dequeTimes;

		for (let index = 0; index < frames; index++) {
			const inputLeft = left && left[index] === left[index] ? left[index] : 0;
			const inputRight = right && right[index] === right[index] ? right[index] : 0;
			const peak = this.detect(inputLeft, inputRight);
			const required = peak > ceiling ? ceiling / peak : 1;
			const time = this.time++;

			while (this.dequeCount > 0 && times[this.dequeHead] <= time - span) {
				this.dequeHead = (this.dequeHead + 1) % span;
				this.dequeCount--;
			}
			while (this.dequeCount > 0) {
				const back = (this.dequeHead + this.dequeCount - 1) % span;
				if (values[back] < required) break;
				this.dequeCount--;
			}
			const slot = (this.dequeHead + this.dequeCount) % span;
			values[slot] = required;
			times[slot] = time;
			this.dequeCount++;

			const held = values[this.dequeHead];
			if (held < this.envelope) this.envelope = held;
			else this.envelope += (held - this.envelope) * releaseCoefficient;

			this.boxSum += this.envelope - this.box[this.boxPosition];
			this.box[this.boxPosition] = this.envelope;
			this.boxPosition = (this.boxPosition + 1) % this.lookahead;
			const gain = Math.min(1, this.boxSum / this.lookahead);

			const position = this.delayPosition;
			const delayedLeft = this.delays[0][position];
			const delayedRight = this.delays[1][position];
			this.delays[0][position] = inputLeft;
			this.delays[1][position] = inputRight;
			this.delayPosition = (position + 1) % this.delayLength;

			let outputLeft;
			let outputRight;
			if (isLimiting) {
				outputLeft = Math.max(-ceiling, Math.min(ceiling, delayedLeft * gain));
				outputRight = Math.max(-ceiling, Math.min(ceiling, delayedRight * gain));
				if (gain < this.reportGain) this.reportGain = gain;
			} else {
				outputLeft = Math.max(-1, Math.min(1, delayedLeft));
				outputRight = Math.max(-1, Math.min(1, delayedRight));
			}

			output[0][index] = outputLeft;
			if (output[1]) output[1][index] = outputRight;
			this.meter.add(outputLeft, outputRight);
			if (rawLeft) this.inputMeter.add(rawLeft[index], rawRight[index]);
			const outputPeak = Math.max(Math.abs(outputLeft), Math.abs(outputRight));
			if (outputPeak > this.reportPeak) this.reportPeak = outputPeak;
		}

		this.meter.endBlock();
		this.inputMeter.endBlock();
		if (this.boxSum > this.lookahead * 2 || this.time % 262144 < frames) {
			this.boxSum = this.box.reduce((sum, value) => sum + value, 0);
		}
		if (this.reporter.tick(frames)) {
			this.port.postMessage({ peak: this.reportPeak, gain: this.reportGain, lufs: this.meter.momentary, outShort: this.meter.shortTerm, inShort: this.inputMeter.shortTerm });
			this.reportPeak = 0;
			this.reportGain = 1;
		}

	}

}

class PitchShifter extends MeteredProcessor {

	static get parameterDescriptors() {

		return [
			{ name: "ratio", defaultValue: 1, minValue: .25, maxValue: 4, automationRate: "k-rate" },
			{ name: "grain", defaultValue: 50, minValue: 5, maxValue: 150, automationRate: "k-rate" },
		];

	}

	constructor() {

		super();
		this.size = 16384;
		this.mask = this.size - 1;
		this.buffers = [new Float32Array(this.size), new Float32Array(this.size)];
		this.write = 0;
		this.phase = 0;

	}

	read(buffer, position) {

		const base = Math.floor(position);
		const fraction = position - base;
		const first = buffer[base & this.mask];
		const second = buffer[(base + 1) & this.mask];
		return first + (second - first) * fraction;

	}

	render(inputs, outputs, parameters) {

		const input = inputs[0];
		if (!input || input.length === 0) return;

		const output = outputs[0];
		const frames = output[0].length;
		const grain = Math.min(this.size - 4, Math.round(sampleRate * parameters.grain[0] / 1000));
		const step = (1 - parameters.ratio[0]) / grain;
		const channels = output.length;

		for (let index = 0; index < frames; index++) {
			const firstPhase = this.phase;
			const secondPhase = (firstPhase + .5) % 1;
			const firstWeight = .5 - .5 * Math.cos(2 * Math.PI * firstPhase);
			const secondWeight = 1 - firstWeight;
			const firstPosition = this.write - firstPhase * grain;
			const secondPosition = this.write - secondPhase * grain;

			for (let channel = 0; channel < channels; channel++) {
				const source = input[channel] ?? input[0];
				const buffer = this.buffers[Math.min(channel, 1)];
				buffer[this.write] = source[index];
				output[channel][index] = this.read(buffer, firstPosition) * firstWeight + this.read(buffer, secondPosition) * secondWeight;
			}

			this.write = (this.write + 1) & this.mask;
			this.phase += step;
			if (this.phase < 0) this.phase += 1;
			else if (this.phase >= 1) this.phase -= 1;
		}

	}

}

class Distortion extends MeteredProcessor {

	static get parameterDescriptors() {

		return [
			{ name: "drive", defaultValue: 18, minValue: 0, maxValue: 200, automationRate: "k-rate" },
			{ name: "shape", defaultValue: 0, minValue: 0, maxValue: 4, automationRate: "k-rate" },
			{ name: "bias", defaultValue: 0, minValue: -.5, maxValue: .5, automationRate: "k-rate" },
			{ name: "bits", defaultValue: 16, minValue: 1, maxValue: 16, automationRate: "k-rate" },
			{ name: "rate", defaultValue: 1, minValue: 1, maxValue: 64, automationRate: "k-rate" },
			{ name: "tone", defaultValue: 20000, minValue: 200, maxValue: 20000, automationRate: "k-rate" },
			{ name: "mix", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
			{ name: "level", defaultValue: 0, minValue: -120, maxValue: 120, automationRate: "k-rate" },
		];

	}

	constructor() {

		super();
		this.held = [0, 0];
		this.counters = [0, 0];
		this.lowFirst = [0, 0];
		this.lowSecond = [0, 0];
		this.dcInput = [0, 0];
		this.dcOutput = [0, 0];

	}

	shape(sample, shape) {

		switch (shape) {
			case 1:
				return Math.max(-1, Math.min(1, sample));
			case 2:
				return sample >= 0 ? Math.tanh(sample * 1.5) : Math.tanh(sample * .45) * 1.1;
			case 3:
				return Math.sin(sample);
			case 4:
				return Math.abs(sample) < .0005 ? sample * 2000 : Math.sign(sample);
			default:
				return Math.tanh(sample);
		}

	}

	render(inputs, outputs, parameters) {

		const input = inputs[0];
		if (!input || input.length === 0) return;

		const output = outputs[0];
		const frames = output[0].length;
		const drive = 10 ** (parameters.drive[0] / 20);
		const shape = Math.round(parameters.shape[0]);
		const bias = parameters.bias[0];
		const bits = Math.round(parameters.bits[0]);
		const steps = 2 ** (bits - 1);
		const isCrushing = bits < 16;
		const hold = Math.max(1, Math.round(parameters.rate[0]));
		const tone = parameters.tone[0];
		const isFiltering = tone < 19500;
		const toneCoefficient = 1 - Math.exp(-2 * Math.PI * tone / sampleRate);
		const wet = parameters.mix[0];
		const dry = 1 - wet;
		const level = 10 ** (parameters.level[0] / 20);

		for (let channel = 0; channel < output.length; channel++) {
			const source = input[channel] ?? input[0];
			const target = output[channel];
			const state = Math.min(channel, 1);

			for (let index = 0; index < frames; index++) {
				const sample = source[index];

				if (this.counters[state] <= 0) {
					let shaped = this.shape(sample * drive + bias, shape);
					if (isCrushing) shaped = Math.round(shaped * steps) / steps;
					this.held[state] = shaped;
					this.counters[state] = hold;
				}
				this.counters[state]--;

				let processed = this.held[state];
				if (isFiltering) {
					this.lowFirst[state] += (processed - this.lowFirst[state]) * toneCoefficient;
					this.lowSecond[state] += (this.lowFirst[state] - this.lowSecond[state]) * toneCoefficient;
					processed = this.lowSecond[state];
				}

				const blocked = processed - this.dcInput[state] + .995 * this.dcOutput[state];
				this.dcInput[state] = processed;
				this.dcOutput[state] = blocked;

				target[index] = (sample * dry + blocked * wet) * level;
			}
		}

	}

}

class AutoGain extends MeteredProcessor {

	static get parameterDescriptors() {

		return [
			{ name: "target", defaultValue: -14, minValue: -40, maxValue: 0, automationRate: "k-rate" },
			{ name: "maxBoost", defaultValue: 18, minValue: 0, maxValue: 120, automationRate: "k-rate" },
			{ name: "speed", defaultValue: 1, minValue: 0, maxValue: 2, automationRate: "k-rate" },
		];

	}

	constructor() {

		super();
		this.filters = [0, 1].map(() => {
			const shelf = new Biquad();
			const highpass = new Biquad();
			setKWeighting(shelf, highpass);
			return [shelf, highpass];
		});
		this.average = 0;
		this.isPrimed = false;
		this.gainDb = 0;
		this.reporter = new Reporter(.1);

	}

	render(inputs, outputs, parameters) {

		const input = inputs[0];
		if (!input || input.length === 0) return;

		const output = outputs[0];
		const frames = output[0].length;
		const left = input[0];
		const right = input[1] ?? left;
		const speed = Math.round(parameters.speed[0]);
		const coefficient = 1 - Math.exp(-1 / ([3, 1.2, .4][speed] * sampleRate));
		const upRate = [3, 6, 12][speed] * frames / sampleRate;
		const downRate = upRate * 4;
		const [leftShelf, leftHighpass] = this.filters[0];
		const [rightShelf, rightHighpass] = this.filters[1];

		let blockEnergy = 0;
		for (let index = 0; index < frames; index++) {
			const weightedLeft = leftHighpass.process(leftShelf.process(left[index]));
			const weightedRight = rightHighpass.process(rightShelf.process(right[index]));
			const energy = weightedLeft * weightedLeft + weightedRight * weightedRight;
			this.average += (energy - this.average) * coefficient;
			blockEnergy += energy;
		}
		if (!this.isPrimed && blockEnergy / frames > 1e-9) {
			this.average = blockEnergy / frames;
			this.isPrimed = true;
		}

		const loudness = this.average > 1e-12 ? -.691 + 10 * Math.log10(this.average) : -100;
		let nextGain = this.gainDb;
		if (loudness > -60) {
			const desired = Math.max(-24, Math.min(parameters.maxBoost[0], parameters.target[0] - loudness));
			nextGain += Math.max(-downRate, Math.min(upRate, desired - this.gainDb));
		}
		nextGain = Math.min(nextGain, parameters.maxBoost[0]);

		const startGain = 10 ** (this.gainDb / 20);
		const endGain = 10 ** (nextGain / 20);
		for (let channel = 0; channel < output.length; channel++) {
			const source = input[channel] ?? left;
			const target = output[channel];
			for (let index = 0; index < frames; index++) {
				target[index] = source[index] * (startGain + (endGain - startGain) * (index + 1) / frames);
			}
		}
		this.gainDb = nextGain;

		if (this.reporter.tick(frames)) this.port.postMessage({ gain: this.gainDb });

	}

}

class Multiband extends MeteredProcessor {

	static get parameterDescriptors() {

		return [
			{ name: "strength", defaultValue: 50, minValue: 0, maxValue: 100, automationRate: "k-rate" },
			{ name: "lowPush", defaultValue: 0, minValue: -24, maxValue: 24, automationRate: "k-rate" },
			{ name: "midPush", defaultValue: 0, minValue: -24, maxValue: 24, automationRate: "k-rate" },
			{ name: "highPush", defaultValue: 0, minValue: -24, maxValue: 24, automationRate: "k-rate" },
			{ name: "lowFreq", defaultValue: 150, minValue: 20, maxValue: 2000, automationRate: "k-rate" },
			{ name: "highFreq", defaultValue: 3500, minValue: 200, maxValue: 16000, automationRate: "k-rate" },
			{ name: "attack", defaultValue: 5, minValue: .05, maxValue: 500, automationRate: "k-rate" },
			{ name: "release", defaultValue: 120, minValue: 5, maxValue: 3000, automationRate: "k-rate" },
		];

	}

	constructor() {

		super();
		const pair = () => [new Biquad(), new Biquad()];
		this.channels = [0, 1].map(() => ({
			lowSplit: pair(),
			highSplit: pair(),
			mid: pair(),
			high: pair(),
			allpassLow: pair(),
			allpassHigh: pair(),
		}));
		this.lowFreq = 0;
		this.highFreq = 0;
		this.envelopes = new Float64Array(3);
		this.bands = [new Float64Array(3), new Float64Array(3)];
		this.reportReduction = new Float64Array(3);
		this.reporter = new Reporter(.04);

	}

	configure(lowFreq, highFreq) {

		this.lowFreq = lowFreq;
		this.highFreq = highFreq;
		const split = Math.max(highFreq, lowFreq * 1.5);
		for (const channel of this.channels) {
			for (const filter of channel.lowSplit) setButterworth(filter, "low", lowFreq);
			for (const filter of channel.highSplit) setButterworth(filter, "high", lowFreq);
			for (const filter of channel.mid) setButterworth(filter, "low", split);
			for (const filter of channel.high) setButterworth(filter, "high", split);
			for (const filter of channel.allpassLow) setButterworth(filter, "low", split);
			for (const filter of channel.allpassHigh) setButterworth(filter, "high", split);
		}

	}

	split(channel, sample, bands) {

		const low = channel.lowSplit[1].process(channel.lowSplit[0].process(sample));
		const upper = channel.highSplit[1].process(channel.highSplit[0].process(sample));
		bands[0] = channel.allpassLow[1].process(channel.allpassLow[0].process(low)) + channel.allpassHigh[1].process(channel.allpassHigh[0].process(low));
		bands[1] = channel.mid[1].process(channel.mid[0].process(upper));
		bands[2] = channel.high[1].process(channel.high[0].process(upper));

	}

	render(inputs, outputs, parameters) {

		const input = inputs[0];
		if (!input || input.length === 0) return;

		const lowFreq = parameters.lowFreq[0];
		const highFreq = parameters.highFreq[0];
		if (lowFreq !== this.lowFreq || highFreq !== this.highFreq) this.configure(lowFreq, highFreq);

		const output = outputs[0];
		const frames = output[0].length;
		const left = input[0];
		const right = input[1] ?? left;
		const strength = parameters.strength[0];
		const threshold = -.36 * strength;
		const slope = 1 / (1 + .11 * strength) - 1;
		const knee = 6;
		const makeup = -slope * -threshold * .5;
		const attack = Math.exp(-1 / (sampleRate * parameters.attack[0] / 1000));
		const release = Math.exp(-1 / (sampleRate * parameters.release[0] / 1000));
		const pushes = [parameters.lowPush[0], parameters.midPush[0], parameters.highPush[0]].map(value => 10 ** (value / 20));
		const [leftBands, rightBands] = this.bands;
		const envelopes = this.envelopes;

		for (let index = 0; index < frames; index++) {
			this.split(this.channels[0], left[index], leftBands);
			this.split(this.channels[1], right[index], rightBands);
			let outputLeft = 0;
			let outputRight = 0;

			for (let band = 0; band < 3; band++) {
				const bandLeft = leftBands[band] * pushes[band];
				const bandRight = rightBands[band] * pushes[band];
				const level = 20 * Math.log10(Math.max(Math.abs(bandLeft), Math.abs(bandRight)) + 1e-9);
				const over = level - threshold;
				let reduction = 0;
				if (2 * over >= knee) reduction = slope * over;
				else if (2 * over > -knee) reduction = slope * (over + knee / 2) ** 2 / (2 * knee);

				const coefficient = reduction < envelopes[band] ? attack : release;
				envelopes[band] = reduction + (envelopes[band] - reduction) * coefficient;
				if (envelopes[band] < this.reportReduction[band]) this.reportReduction[band] = envelopes[band];

				const gain = 10 ** ((envelopes[band] + makeup) / 20);
				outputLeft += bandLeft * gain;
				outputRight += bandRight * gain;
			}

			output[0][index] = outputLeft;
			if (output[1]) output[1][index] = outputRight;
		}

		if (this.reporter.tick(frames)) {
			this.port.postMessage({ reduction: [...this.reportReduction] });
			this.reportReduction.fill(0);
		}

	}

}

class Clipper extends MeteredProcessor {

	static get parameterDescriptors() {

		return [
			{ name: "drive", defaultValue: 4, minValue: 0, maxValue: 120, automationRate: "k-rate" },
			{ name: "softness", defaultValue: .3, minValue: 0, maxValue: 1, automationRate: "k-rate" },
			{ name: "oversample", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
		];

	}

	constructor() {

		super();
		this.upsamplers = [new Upsampler(), new Upsampler()];
		this.downsamplers = [new Downsampler(), new Downsampler()];
		this.phaseValues = new Float64Array(4);
		this.reportPeak = 0;
		this.reporter = new Reporter(.1);

	}

	shape(sample, knee) {

		const magnitude = Math.abs(sample);
		if (magnitude <= knee) return sample;
		if (knee >= 1) return Math.sign(sample);
		return Math.sign(sample) * (knee + (1 - knee) * Math.tanh((magnitude - knee) / (1 - knee)));

	}

	render(inputs, outputs, parameters) {

		const input = inputs[0];
		if (!input || input.length === 0) return;

		const output = outputs[0];
		const frames = output[0].length;
		const gain = 10 ** (parameters.drive[0] / 20);
		const knee = 1 - parameters.softness[0];
		const isOversampling = parameters.oversample[0] >= .5;
		const values = this.phaseValues;

		for (let channel = 0; channel < output.length; channel++) {
			const source = input[channel] ?? input[0];
			const target = output[channel];
			const state = Math.min(channel, 1);
			const upsampler = this.upsamplers[state];
			const downsampler = this.downsamplers[state];

			for (let index = 0; index < frames; index++) {
				const driven = source[index] * gain;
				const magnitude = Math.abs(driven);
				if (magnitude > this.reportPeak) this.reportPeak = magnitude;

				if (!isOversampling) {
					target[index] = this.shape(driven, knee);
					continue;
				}

				upsampler.process(driven, values);
				target[index] = downsampler.process(this.shape(values[0], knee), this.shape(values[1], knee), this.shape(values[2], knee), this.shape(values[3], knee));
			}
		}

		if (this.reporter.tick(frames)) {
			this.port.postMessage({ shaved: this.reportPeak > 1 ? 20 * Math.log10(this.reportPeak) : 0 });
			this.reportPeak = 0;
		}

	}

}

class PhantomBass extends MeteredProcessor {

	static get parameterDescriptors() {

		return [
			{ name: "amount", defaultValue: .5, minValue: 0, maxValue: 2, automationRate: "k-rate" },
			{ name: "frequency", defaultValue: 100, minValue: 20, maxValue: 500, automationRate: "k-rate" },
		];

	}

	constructor() {

		super();
		this.lowpass = [new Biquad(), new Biquad()];
		this.highpass = [new Biquad(), new Biquad()];
		this.ceiling = new Biquad();
		this.envelope = 0;
		this.frequency = 0;
		this.attack = 1 - Math.exp(-1 / (sampleRate * .002));
		this.release = Math.exp(-1 / (sampleRate * .1));

	}

	configure(frequency) {

		this.frequency = frequency;
		for (const filter of this.lowpass) setButterworth(filter, "low", frequency);
		for (const filter of this.highpass) setButterworth(filter, "high", frequency);
		setButterworth(this.ceiling, "low", frequency * 4);

	}

	render(inputs, outputs, parameters) {

		const input = inputs[0];
		if (!input || input.length === 0) return;

		const frequency = parameters.frequency[0];
		if (frequency !== this.frequency) this.configure(frequency);

		const output = outputs[0];
		const frames = output[0].length;
		const left = input[0];
		const right = input[1] ?? left;
		const amount = parameters.amount[0];

		for (let index = 0; index < frames; index++) {
			const mono = (left[index] + right[index]) * .5;
			const low = this.lowpass[1].process(this.lowpass[0].process(mono));
			const magnitude = Math.abs(low);
			if (magnitude > this.envelope) this.envelope += (magnitude - this.envelope) * this.attack;
			else this.envelope *= this.release;

			const envelope = this.envelope;
			const normalized = envelope > 1e-6 ? Math.max(-1, Math.min(1, low / envelope)) : 0;
			const squared = normalized * normalized;
			const harmonics = envelope * (.6 * (2 * squared - 1) + .45 * (4 * squared * normalized - 3 * normalized) + .25 * (8 * squared * squared - 8 * squared + 1));
			const added = this.ceiling.process(this.highpass[1].process(this.highpass[0].process(harmonics))) * amount;

			output[0][index] = left[index] + added;
			if (output[1]) output[1][index] = right[index] + added;
		}

	}

}

class Fft {

	constructor(size) {

		this.size = size;
		this.cosines = Float64Array.from({ length: size / 2 }, (_, index) => Math.cos(2 * Math.PI * index / size));
		this.sines = Float64Array.from({ length: size / 2 }, (_, index) => Math.sin(2 * Math.PI * index / size));
		this.reversed = new Uint32Array(size);
		const bits = Math.log2(size);
		for (let index = 0; index < size; index++) {
			let reversed = 0;
			for (let bit = 0; bit < bits; bit++) reversed |= ((index >> bit) & 1) << (bits - 1 - bit);
			this.reversed[index] = reversed;
		}

	}

	transform(real, imag, isInverse) {

		const size = this.size;
		const cosines = this.cosines;
		const sines = this.sines;
		const direction = isInverse ? 1 : -1;

		for (let index = 0; index < size; index++) {
			const target = this.reversed[index];
			if (target <= index) continue;
			const swapReal = real[index];
			const swapImag = imag[index];
			real[index] = real[target];
			imag[index] = imag[target];
			real[target] = swapReal;
			imag[target] = swapImag;
		}

		for (let length = 2; length <= size; length *= 2) {
			const half = length / 2;
			const step = size / length;
			for (let start = 0; start < size; start += length) {
				for (let offset = 0; offset < half; offset++) {
					const twiddleReal = cosines[offset * step];
					const twiddleImag = direction * sines[offset * step];
					const first = start + offset;
					const second = first + half;
					const productReal = real[second] * twiddleReal - imag[second] * twiddleImag;
					const productImag = real[second] * twiddleImag + imag[second] * twiddleReal;
					real[second] = real[first] - productReal;
					imag[second] = imag[first] - productImag;
					real[first] += productReal;
					imag[first] += productImag;
				}
			}
		}

	}

}

class PitchHd extends MeteredProcessor {

	static get parameterDescriptors() {

		return [
			{ name: "ratio", defaultValue: 1, minValue: .25, maxValue: 4, automationRate: "k-rate" },
			{ name: "formant", defaultValue: 1, minValue: .25, maxValue: 4, automationRate: "k-rate" },
		];

	}

	constructor() {

		super();
		const size = 2048;
		const half = size / 2;
		this.size = size;
		this.oversample = 4;
		this.hop = size / this.oversample;
		this.latency = size - this.hop;
		this.rover = this.latency;
		this.fft = new Fft(size);
		this.window = Float64Array.from({ length: size }, (_, index) => .5 - .5 * Math.cos(2 * Math.PI * index / size));
		this.real = new Float64Array(size);
		this.imag = new Float64Array(size);
		this.cepstrumReal = new Float64Array(size);
		this.cepstrumImag = new Float64Array(size);
		this.lifter = Math.max(8, Math.round(sampleRate / 900));
		this.magnitudes = new Float64Array(half + 1);
		this.phases = new Float64Array(half + 1);
		this.frequencies = new Float64Array(half + 1);
		this.envelope = new Float64Array(half + 1);
		this.peaks = new Uint32Array(half);
		this.channels = [0, 1].map(() => ({
			input: new Float64Array(size),
			output: new Float64Array(size),
			accumulator: new Float64Array(size * 2),
			lastPhase: new Float64Array(half + 1),
			previousPhase: new Float64Array(half + 2).fill(NaN),
			nextPhase: new Float64Array(half + 2),
		}));

	}

	computeEnvelope() {

		const size = this.size;
		const half = size / 2;
		const real = this.cepstrumReal;
		const imag = this.cepstrumImag;
		for (let bin = 0; bin <= half; bin++) {
			const value = Math.log(this.magnitudes[bin] + 1e-9);
			real[bin] = value;
			if (bin > 0 && bin < half) real[size - bin] = value;
		}
		imag.fill(0);
		this.fft.transform(real, imag, true);
		for (let quefrency = this.lifter + 1; quefrency < size - this.lifter; quefrency++) {
			real[quefrency] = 0;
			imag[quefrency] = 0;
		}
		this.fft.transform(real, imag, false);
		for (let bin = 0; bin <= half; bin++) this.envelope[bin] = Math.exp(real[bin] / size);

	}

	envelopeAt(position) {

		const half = this.size / 2;
		if (position >= half) return this.envelope[half];
		const base = Math.floor(position);
		const fraction = position - base;
		return this.envelope[base] + (this.envelope[base + 1] - this.envelope[base]) * fraction;

	}

	frame(channel, ratio, formant) {

		const size = this.size;
		const half = size / 2;
		const oversample = this.oversample;
		const hop = this.hop;
		const expected = 2 * Math.PI * hop / size;
		const real = this.real;
		const imag = this.imag;
		const window = this.window;
		const magnitudes = this.magnitudes;
		const phases = this.phases;
		const frequencies = this.frequencies;
		const peaks = this.peaks;
		const previousPhase = channel.previousPhase;
		const nextPhase = channel.nextPhase;
		const isShaping = Math.abs(Math.log(formant / ratio)) > 1e-6;

		for (let index = 0; index < size; index++) {
			real[index] = channel.input[index] * window[index];
			imag[index] = 0;
		}
		this.fft.transform(real, imag, false);

		let loudest = 0;
		for (let bin = 0; bin <= half; bin++) {
			const phase = Math.atan2(imag[bin], real[bin]);
			let delta = phase - channel.lastPhase[bin] - bin * expected;
			channel.lastPhase[bin] = phase;
			delta -= 2 * Math.PI * Math.round(delta / (2 * Math.PI));
			magnitudes[bin] = 2 * Math.sqrt(real[bin] * real[bin] + imag[bin] * imag[bin]);
			phases[bin] = phase;
			frequencies[bin] = bin + oversample * delta / (2 * Math.PI);
			if (magnitudes[bin] > loudest) loudest = magnitudes[bin];
		}
		if (isShaping) this.computeEnvelope();

		const floor = loudest * 1e-5;
		let peakCount = 0;
		for (let bin = 1; bin < half; bin++) {
			if (magnitudes[bin] > floor && magnitudes[bin] > magnitudes[bin - 1] && magnitudes[bin] >= magnitudes[bin + 1]) peaks[peakCount++] = bin;
		}

		real.fill(0);
		imag.fill(0);
		nextPhase.fill(NaN);
		let lower = 0;
		for (let index = 0; index < peakCount; index++) {
			const peak = peaks[index];
			let upper = half;
			if (index + 1 < peakCount) {
				upper = peak;
				for (let bin = peak + 1; bin < peaks[index + 1]; bin++) {
					if (magnitudes[bin] < magnitudes[upper]) upper = bin;
				}
			}

			const target = Math.round(peak * ratio);
			if (target <= half) {
				let base = previousPhase[target];
				if (Number.isNaN(base)) base = target > 0 && !Number.isNaN(previousPhase[target - 1]) ? previousPhase[target - 1] : previousPhase[target + 1];
				const peakPhase = Number.isNaN(base) ? phases[peak] : base + frequencies[peak] * ratio * expected;
				nextPhase[target] = peakPhase;

				const gain = isShaping ? Math.min(20, this.envelopeAt(target / formant) / this.envelope[peak]) : 1;
				const shift = target - peak;
				for (let bin = lower; bin <= upper; bin++) {
					const destination = bin + shift;
					if (destination < 0 || destination > half) continue;
					const phase = peakPhase + phases[bin] - phases[peak];
					const magnitude = magnitudes[bin] * gain;
					real[destination] += magnitude * Math.cos(phase);
					imag[destination] += magnitude * Math.sin(phase);
				}
			}
			lower = upper + 1;
		}
		for (let bin = 0; bin <= half; bin++) {
			const phase = nextPhase[bin];
			previousPhase[bin] = Number.isNaN(phase) ? NaN : phase - 2 * Math.PI * Math.round(phase / (2 * Math.PI));
		}

		this.fft.transform(real, imag, true);

		const accumulator = channel.accumulator;
		const scale = 2 / (half * oversample * .375 * oversample);
		for (let index = 0; index < size; index++) accumulator[index] += window[index] * real[index] * scale;
		for (let index = 0; index < hop; index++) channel.output[index] = accumulator[index];
		accumulator.copyWithin(0, hop);
		accumulator.fill(0, accumulator.length - hop);
		channel.input.copyWithin(0, hop);

	}

	render(inputs, outputs, parameters) {

		const input = inputs[0];
		if (!input || input.length === 0) return;

		const output = outputs[0];
		const frames = output[0].length;
		const ratio = parameters.ratio[0];
		const formant = parameters.formant[0];
		const channelCount = Math.min(2, output.length);

		for (let index = 0; index < frames; index++) {
			const rover = this.rover;
			for (let channel = 0; channel < channelCount; channel++) {
				const state = this.channels[channel];
				const source = input[channel] ?? input[0];
				state.input[rover] = source[index];
				output[channel][index] = state.output[rover - this.latency];
			}
			this.rover++;
			if (this.rover >= this.size) {
				this.rover = this.latency;
				for (let channel = 0; channel < channelCount; channel++) this.frame(this.channels[channel], ratio, formant);
			}
		}

	}

}

class Deesser extends MeteredProcessor {

	static get parameterDescriptors() {

		return [
			{ name: "frequency", defaultValue: 6000, minValue: 1000, maxValue: 16000, automationRate: "k-rate" },
			{ name: "threshold", defaultValue: -30, minValue: -80, maxValue: 0, automationRate: "k-rate" },
			{ name: "amount", defaultValue: 8, minValue: 0, maxValue: 40, automationRate: "k-rate" },
		];

	}

	constructor() {

		super();
		this.detectors = [new Biquad(), new Biquad()];
		this.shelves = [new Biquad(), new Biquad()];
		this.frequency = 0;
		this.envelope = 0;
		this.reduction = 0;
		this.shelfReduction = -1;
		this.attack = 1 - Math.exp(-1 / (sampleRate * .001));
		this.release = 1 - Math.exp(-1 / (sampleRate * .06));
		this.reportReduction = 0;
		this.reporter = new Reporter(.1);

	}

	configureShelf(reduction) {

		this.shelfReduction = reduction;
		const gain = 10 ** (-reduction / 40);
		const omega = 2 * Math.PI * Math.min(this.frequency, sampleRate * .45) / sampleRate;
		const cosine = Math.cos(omega);
		const alpha = Math.sin(omega) / Math.SQRT2;
		const root = 2 * Math.sqrt(gain) * alpha;
		const a0 = (gain + 1) - (gain - 1) * cosine + root;
		for (const shelf of this.shelves) {
			shelf.set(
				gain * ((gain + 1) + (gain - 1) * cosine + root) / a0,
				-2 * gain * ((gain - 1) + (gain + 1) * cosine) / a0,
				gain * ((gain + 1) + (gain - 1) * cosine - root) / a0,
				2 * ((gain - 1) - (gain + 1) * cosine) / a0,
				((gain + 1) - (gain - 1) * cosine - root) / a0,
			);
		}

	}

	render(inputs, outputs, parameters) {

		const input = inputs[0];
		if (!input || input.length === 0) return;

		const frequency = parameters.frequency[0];
		if (frequency !== this.frequency) {
			this.frequency = frequency;
			for (const detector of this.detectors) setButterworth(detector, "high", frequency);
			this.configureShelf(this.reduction);
		}
		if (Math.abs(this.reduction - this.shelfReduction) > .05) this.configureShelf(this.reduction);

		const output = outputs[0];
		const frames = output[0].length;
		const left = input[0];
		const right = input[1] ?? left;
		const threshold = parameters.threshold[0];
		const amount = parameters.amount[0];
		const [leftDetector, rightDetector] = this.detectors;
		const [leftShelf, rightShelf] = this.shelves;
		let target = 0;

		for (let index = 0; index < frames; index++) {
			const level = Math.max(Math.abs(leftDetector.process(left[index])), Math.abs(rightDetector.process(right[index])));
			this.envelope += (level - this.envelope) * (level > this.envelope ? this.attack : this.release);
			const over = 20 * Math.log10(this.envelope + 1e-9) - threshold;
			if (over > 0) target = Math.max(target, Math.min(amount, over * .75));

			output[0][index] = leftShelf.process(left[index]);
			if (output[1]) output[1][index] = rightShelf.process(right[index]);
		}

		this.reduction += (target - this.reduction) * (target > this.reduction ? .6 : .05);
		if (this.reduction > this.reportReduction) this.reportReduction = this.reduction;
		if (this.reporter.tick(frames)) {
			this.port.postMessage({ reduction: -this.reportReduction });
			this.reportReduction = 0;
		}

	}

}

class Punch extends MeteredProcessor {

	static get parameterDescriptors() {

		return [
			{ name: "attack", defaultValue: 0, minValue: -1, maxValue: 1, automationRate: "k-rate" },
			{ name: "sustain", defaultValue: 0, minValue: -1, maxValue: 1, automationRate: "k-rate" },
		];

	}

	constructor() {

		super();
		const coefficient = seconds => Math.exp(-1 / (sampleRate * seconds));
		this.fastAttack = coefficient(.001);
		this.fastRelease = coefficient(.03);
		this.slowAttack = coefficient(.025);
		this.slowRelease = coefficient(.03);
		this.longAttack = coefficient(.001);
		this.longRelease = coefficient(.3);
		this.smoothing = 1 - coefficient(.0005);
		this.fast = 0;
		this.slow = 0;
		this.long = 0;
		this.gain = 1;

	}

	render(inputs, outputs, parameters) {

		const input = inputs[0];
		if (!input || input.length === 0) return;

		const output = outputs[0];
		const frames = output[0].length;
		const left = input[0];
		const right = input[1] ?? left;
		const attack = parameters.attack[0] * 12;
		const sustain = parameters.sustain[0] * 12;

		for (let index = 0; index < frames; index++) {
			const level = Math.max(Math.abs(left[index]), Math.abs(right[index]));
			this.fast = level + (this.fast - level) * (level > this.fast ? this.fastAttack : this.fastRelease);
			this.slow = level + (this.slow - level) * (level > this.slow ? this.slowAttack : this.slowRelease);
			this.long = level + (this.long - level) * (level > this.long ? this.longAttack : this.longRelease);

			const transient = this.fast > this.slow ? (this.fast - this.slow) / (this.fast + 1e-9) : 0;
			const tail = this.long > this.fast ? (this.long - this.fast) / (this.long + 1e-9) : 0;
			this.gain += (10 ** ((attack * transient + sustain * tail) / 20) - this.gain) * this.smoothing;

			output[0][index] = left[index] * this.gain;
			if (output[1]) output[1][index] = right[index] * this.gain;
		}

	}

}

class SubOctave extends MeteredProcessor {

	static get parameterDescriptors() {

		return [
			{ name: "amount", defaultValue: .5, minValue: 0, maxValue: 2, automationRate: "k-rate" },
			{ name: "frequency", defaultValue: 90, minValue: 30, maxValue: 300, automationRate: "k-rate" },
		];

	}

	constructor() {

		super();
		this.lowpass = [new Biquad(), new Biquad()];
		this.smoothing = [new Biquad(), new Biquad()];
		this.frequency = 0;
		this.envelope = 0;
		this.state = 1;
		this.isArmed = true;
		this.attack = 1 - Math.exp(-1 / (sampleRate * .002));
		this.release = Math.exp(-1 / (sampleRate * .08));

	}

	render(inputs, outputs, parameters) {

		const input = inputs[0];
		if (!input || input.length === 0) return;

		const frequency = parameters.frequency[0];
		if (frequency !== this.frequency) {
			this.frequency = frequency;
			for (const filter of this.lowpass) setButterworth(filter, "low", frequency);
			for (const filter of this.smoothing) setButterworth(filter, "low", frequency * .55);
		}

		const output = outputs[0];
		const frames = output[0].length;
		const left = input[0];
		const right = input[1] ?? left;
		const amount = parameters.amount[0];

		for (let index = 0; index < frames; index++) {
			const low = this.lowpass[1].process(this.lowpass[0].process((left[index] + right[index]) * .5));
			const magnitude = Math.abs(low);
			if (magnitude > this.envelope) this.envelope += (magnitude - this.envelope) * this.attack;
			else this.envelope *= this.release;

			const hysteresis = this.envelope * .1;
			if (this.isArmed && low > hysteresis) {
				this.state = -this.state;
				this.isArmed = false;
			} else if (low < -hysteresis) {
				this.isArmed = true;
			}

			const added = this.smoothing[1].process(this.smoothing[0].process(this.state * this.envelope)) * amount;
			output[0][index] = left[index] + added;
			if (output[1]) output[1][index] = right[index] + added;
		}

	}

}

registerProcessor("limiter", Limiter);
registerProcessor("pitch-shifter", PitchShifter);
registerProcessor("distortion", Distortion);
registerProcessor("auto-gain", AutoGain);
registerProcessor("multiband", Multiband);
registerProcessor("clipper", Clipper);
registerProcessor("phantom-bass", PhantomBass);
registerProcessor("pitch-hd", PitchHd);
registerProcessor("deesser", Deesser);
registerProcessor("punch", Punch);
registerProcessor("sub-octave", SubOctave);
