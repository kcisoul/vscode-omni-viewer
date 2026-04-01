function createAnalysisWorker() {
    const workerSource = `
        let monoSamples = null;
        let sampleRate = 44100;
        let duration = 0;
        const waveformCache = new Map();
        const spectrogramCache = new Map();
        const cacheState = {
            waveform: { totalBytes: 0, maxBytes: 8 * 1024 * 1024 },
            spectrogram: { totalBytes: 0, maxBytes: 32 * 1024 * 1024 }
        };

        self.onmessage = async (event) => {
            const { type, payload } = event.data || {};

            try {
                if (type === 'init-audio') {
                    monoSamples = new Float32Array(payload.samplesBuffer);
                    sampleRate = payload.sampleRate || 44100;
                    duration = payload.duration || (monoSamples.length / sampleRate);
                    waveformCache.clear();
                    spectrogramCache.clear();
                    self.postMessage({ type: 'ready', payload: { duration, sampleRate, totalSamples: monoSamples.length } });
                    return;
                }

                if (type === 'sync-cache-window') {
                    syncCacheWindow(payload || {});
                    return;
                }

                if (!monoSamples) {
                    throw new Error('Audio analysis data is not initialized.');
                }

                if (type === 'waveform-tile') {
                    const result = getWaveformTile(payload);
                    self.postMessage({ type: 'waveform-tile', payload: result }, [result.peaks.buffer]);
                    return;
                }

                if (type === 'spectrogram-tile') {
                    const result = getSpectrogramTile(payload);
                    self.postMessage({ type: 'spectrogram-tile', payload: result }, [result.rgba.buffer]);
                }
            } catch (error) {
                self.postMessage({
                    type: 'worker-error',
                    payload: {
                        requestId: payload?.requestId,
                        message: error instanceof Error ? error.message : String(error)
                    }
                });
            }
        };

        function getWaveformTile(payload) {
            const cacheKey = payload.cacheKey;
            const cached = getCachedValue(waveformCache, cacheKey);
            if (cached) {
                return {
                    requestId: payload.requestId,
                    tileIndex: payload.tileIndex,
                    startTime: payload.startTime,
                    endTime: payload.endTime,
                    width: payload.width,
                    height: payload.height,
                    peaks: cached.slice()
                };
            }

            const width = Math.max(1, payload.width | 0);
            const startSample = Math.max(0, Math.floor(payload.startTime * sampleRate));
            const endSample = Math.min(monoSamples.length, Math.ceil(payload.endTime * sampleRate));
            const sampleCount = Math.max(1, endSample - startSample);
            const peaks = new Float32Array(width * 2);

            for (let x = 0; x < width; x += 1) {
                const binStart = startSample + Math.floor((x / width) * sampleCount);
                const binEnd = startSample + Math.floor(((x + 1) / width) * sampleCount);
                let min = 1;
                let max = -1;
                const limit = Math.max(binStart + 1, binEnd);

                for (let i = binStart; i < limit; i += 1) {
                    const value = monoSamples[i] || 0;
                    if (value < min) min = value;
                    if (value > max) max = value;
                }

                peaks[x * 2] = min === 1 ? 0 : min;
                peaks[(x * 2) + 1] = max === -1 ? 0 : max;
            }

            setCachedValue(waveformCache, cacheState.waveform, cacheKey, peaks);
            return {
                requestId: payload.requestId,
                tileIndex: payload.tileIndex,
                startTime: payload.startTime,
                endTime: payload.endTime,
                width: payload.width,
                height: payload.height,
                peaks: peaks.slice()
            };
        }

        function getSpectrogramTile(payload) {
            const cacheKey = payload.cacheKey;
            const cached = getCachedValue(spectrogramCache, cacheKey);
            if (cached) {
                return {
                    requestId: payload.requestId,
                    tileIndex: payload.tileIndex,
                    startTime: payload.startTime,
                    endTime: payload.endTime,
                    width: payload.width,
                    height: payload.height,
                    rgba: cached.slice()
                };
            }

            const width = Math.max(16, payload.width | 0);
            const height = Math.max(16, payload.height | 0);
            const startSample = Math.max(0, Math.floor(payload.startTime * sampleRate));
            const endSample = Math.min(monoSamples.length, Math.ceil(payload.endTime * sampleRate));
            const fftSize = payload.fftSize || 1024;
            const hopSize = payload.hopSize || Math.max(128, Math.floor(fftSize / 4));
            const halfFft = fftSize >> 1;
            const rgba = new Uint8ClampedArray(width * height * 4);
            const hannWindow = buildHannWindow(fftSize);

            for (let x = 0; x < width; x += 1) {
                const progress = width <= 1 ? 0 : x / (width - 1);
                const centerSample = startSample + Math.floor(progress * Math.max(1, endSample - startSample));
                const frameStart = clamp(centerSample - Math.floor(fftSize / 2), 0, Math.max(0, monoSamples.length - fftSize));
                const real = new Float32Array(fftSize);
                const imag = new Float32Array(fftSize);

                for (let i = 0; i < fftSize; i += 1) {
                    real[i] = (monoSamples[frameStart + i] || 0) * hannWindow[i];
                }

                fft(real, imag);

                for (let y = 0; y < height; y += 1) {
                    const row = height - 1 - y;
                    const bin = mapRowToBin(row, height, halfFft, payload.scale || 'mel');
                    const magnitude = magnitudeAt(real, imag, bin);
                    const intensity = mapMagnitudeToIntensity(magnitude);
                    const color = colorize(intensity);
                    const index = ((y * width) + x) * 4;
                    rgba[index] = color[0];
                    rgba[index + 1] = color[1];
                    rgba[index + 2] = color[2];
                    rgba[index + 3] = 255;
                }
            }

            setCachedValue(spectrogramCache, cacheState.spectrogram, cacheKey, rgba);
            return {
                requestId: payload.requestId,
                tileIndex: payload.tileIndex,
                startTime: payload.startTime,
                endTime: payload.endTime,
                width,
                height,
                rgba: rgba.slice()
            };
        }

        function getCachedValue(cache, key) {
            if (!cache.has(key)) {
                return null;
            }

            const entry = cache.get(key);
            cache.delete(key);
            cache.set(key, entry);
            return entry.value;
        }

        function setCachedValue(cache, state, key, value) {
            const size = value?.byteLength || 0;
            if (cache.has(key)) {
                state.totalBytes -= cache.get(key).size;
                cache.delete(key);
            }

            cache.set(key, { value, size });
            state.totalBytes += size;
            trimCacheToLimit(cache, state);
        }

        function trimCacheToLimit(cache, state) {
            while (state.totalBytes > state.maxBytes && cache.size > 0) {
                const oldestKey = cache.keys().next().value;
                if (oldestKey === undefined) {
                    break;
                }

                const entry = cache.get(oldestKey);
                cache.delete(oldestKey);
                state.totalBytes -= entry?.size || 0;
            }
        }

        function pruneCache(cache, state, keepKeys) {
            if (!keepKeys || keepKeys.size === 0) {
                cache.clear();
                state.totalBytes = 0;
                return;
            }

            for (const [key, entry] of cache.entries()) {
                if (!keepKeys.has(key)) {
                    cache.delete(key);
                    state.totalBytes -= entry?.size || 0;
                }
            }
        }

        function syncCacheWindow(payload) {
            const waveformKeys = new Set(payload.waveformKeys || []);
            const spectrogramKeys = new Set(payload.spectrogramKeys || []);
            pruneCache(waveformCache, cacheState.waveform, waveformKeys);
            pruneCache(spectrogramCache, cacheState.spectrogram, spectrogramKeys);
        }

        function buildHannWindow(size) {
            const window = new Float32Array(size);
            for (let i = 0; i < size; i += 1) {
                window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
            }
            return window;
        }

        function magnitudeAt(real, imag, bin) {
            const clampedBin = clamp(bin, 0, real.length - 1);
            return Math.sqrt((real[clampedBin] * real[clampedBin]) + (imag[clampedBin] * imag[clampedBin]));
        }

        function mapMagnitudeToIntensity(value) {
            const db = 20 * Math.log10(Math.max(value, 1e-6));
            return clamp((db + 90) / 90, 0, 1);
        }

        function colorize(intensity) {
            const i = clamp(intensity, 0, 1);
            const r = Math.floor(255 * Math.pow(i, 1.4));
            const g = Math.floor(255 * Math.pow(i, 0.9));
            const b = Math.floor(255 * (0.18 + (0.82 * i)));
            return [r, g, b];
        }

        function mapRowToBin(row, totalRows, maxBin, scale) {
            const progress = totalRows <= 1 ? 0 : row / (totalRows - 1);

            if (scale === 'linear') {
                return Math.floor(progress * maxBin);
            }

            if (scale === 'bark') {
                return Math.floor(maxBin * ((Math.exp(progress * Math.log(25)) - 1) / 24));
            }

            if (scale === 'erb') {
                return Math.floor(maxBin * ((Math.exp(progress * Math.log(40)) - 1) / 39));
            }

            const melMax = hzToMel(maxBinToHz(maxBin, maxBin));
            const mel = progress * melMax;
            return hzToBin(melToHz(mel), maxBin);
        }

        function maxBinToHz(bin, maxBin) {
            const nyquist = sampleRate / 2;
            return (bin / Math.max(1, maxBin)) * nyquist;
        }

        function hzToBin(hz, maxBin) {
            const nyquist = sampleRate / 2;
            return clamp(Math.floor((hz / nyquist) * maxBin), 0, maxBin);
        }

        function hzToMel(hz) {
            return 2595 * Math.log10(1 + (hz / 700));
        }

        function melToHz(mel) {
            return 700 * (Math.pow(10, mel / 2595) - 1);
        }

        function clamp(value, min, max) {
            return Math.min(max, Math.max(min, value));
        }

        function fft(real, imag) {
            const n = real.length;
            const levels = Math.log2(n);
            if (Math.floor(levels) !== levels) {
                throw new Error('FFT size must be a power of two');
            }

            for (let i = 0; i < n; i += 1) {
                const j = reverseBits(i, levels);
                if (j > i) {
                    let temp = real[i];
                    real[i] = real[j];
                    real[j] = temp;

                    temp = imag[i];
                    imag[i] = imag[j];
                    imag[j] = temp;
                }
            }

            for (let size = 2; size <= n; size <<= 1) {
                const halfsize = size >> 1;
                const tablestep = (Math.PI * 2) / size;
                for (let i = 0; i < n; i += size) {
                    for (let j = i, k = 0; j < i + halfsize; j += 1, k += 1) {
                        const angle = tablestep * k;
                        const cos = Math.cos(angle);
                        const sin = -Math.sin(angle);
                        const l = j + halfsize;
                        const treal = (real[l] * cos) - (imag[l] * sin);
                        const timag = (real[l] * sin) + (imag[l] * cos);

                        real[l] = real[j] - treal;
                        imag[l] = imag[j] - timag;
                        real[j] += treal;
                        imag[j] += timag;
                    }
                }
            }
        }

        function reverseBits(value, bits) {
            let reversed = 0;
            for (let i = 0; i < bits; i += 1) {
                reversed = (reversed << 1) | (value & 1);
                value >>>= 1;
            }
            return reversed;
        }
    `;

    const blob = new Blob([workerSource], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl);
    worker.workerUrl = workerUrl;
    return worker;
}

export class AnalysisWorkerManager {
    constructor(state) {
        this.state = state;
        this.worker = createAnalysisWorker();
        this.pendingRequests = new Map();
        this.requestCounter = 0;
        this.isReady = false;
        this.readyResolvers = [];
        this.decodedData = null;
        this.analysisMetadata = null;

        this.worker.onmessage = (event) => {
            const { type, payload } = event.data || {};

            if (type === 'ready') {
                this.isReady = true;
                this.readyResolvers.forEach((resolve) => resolve(payload));
                this.readyResolvers = [];
                return;
            }

            if (type === 'worker-error') {
                const pending = this.pendingRequests.get(payload.requestId);
                if (pending) {
                    pending.reject(new Error(payload.message));
                    this.pendingRequests.delete(payload.requestId);
                }
                return;
            }

            const pending = this.pendingRequests.get(payload.requestId);
            if (!pending) {
                return;
            }

            pending.resolve(payload);
            this.pendingRequests.delete(payload.requestId);
        };
    }

    async decodeInBackground(audioData, audioContextManager, metadata = {}) {
        const decodedData = await this.ensureDecodedData(audioData, audioContextManager);
        await this.initialize(decodedData);

        return {
            duration: decodedData.duration || metadata.duration || 0,
            sampleRate: decodedData.sampleRate || metadata.sampleRate || 0
        };
    }

    async ensureDecodedData(audioData, audioContextManager) {
        if (this.decodedData) {
            return this.decodedData;
        }

        const context = await audioContextManager.initialize();
        if (!context) {
            throw new Error('AudioContext could not be initialized for background analysis.');
        }

        const arrayBuffer = audioData instanceof ArrayBuffer ? audioData : audioData?.buffer;
        if (!(arrayBuffer instanceof ArrayBuffer)) {
            throw new Error('Audio analysis requires an ArrayBuffer source.');
        }

        this.decodedData = await context.decodeAudioData(arrayBuffer);
        return this.decodedData;
    }

    async initialize(decodedData) {
        if (!decodedData) {
            throw new Error('Decoded audio data is unavailable for analysis.');
        }

        this.analysisMetadata = {
            sampleRate: decodedData.sampleRate,
            numberOfChannels: decodedData.numberOfChannels,
            length: decodedData.length,
            duration: decodedData.duration,
            estimatedFileSize: decodedData.length * decodedData.numberOfChannels * 2,
            bitDepth: 32
        };

        const monoSamples = this.createMonoBuffer(decodedData);
        this.isReady = false;

        this.worker.postMessage({
            type: 'init-audio',
            payload: {
                sampleRate: decodedData.sampleRate,
                duration: decodedData.duration,
                samplesBuffer: monoSamples.buffer
            }
        }, [monoSamples.buffer]);

        await new Promise((resolve) => {
            this.readyResolvers.push(resolve);
        });

        // The worker now owns the mono analysis buffer, so keep only metadata and
        // re-decode on demand for region extraction instead of holding full PCM forever.
        this.decodedData = null;
    }

    requestWaveformTile(payload) {
        return this.sendRequest('waveform-tile', payload);
    }

    requestSpectrogramTile(payload) {
        return this.sendRequest('spectrogram-tile', payload);
    }

    syncCacheWindow(payload) {
        if (!this.worker) {
            return;
        }

        this.worker.postMessage({
            type: 'sync-cache-window',
            payload
        });
    }

    dispose() {
        for (const pending of this.pendingRequests.values()) {
            pending.reject(new Error('Audio analysis worker was disposed.'));
        }
        this.pendingRequests.clear();
        this.decodedData = null;
        this.analysisMetadata = null;
        this.isReady = false;

        if (this.worker?.workerUrl) {
            URL.revokeObjectURL(this.worker.workerUrl);
        }

        this.worker?.terminate();
    }

    sendRequest(type, payload) {
        if (!this.worker) {
            return Promise.reject(new Error('Audio analysis worker is not available.'));
        }

        const requestId = `${type}-${this.requestCounter += 1}`;

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(requestId, { resolve, reject });
            this.worker.postMessage({
                type,
                payload: {
                    ...payload,
                    requestId
                }
            });
        });
    }

    createMonoBuffer(decodedData) {
        const { numberOfChannels, length } = decodedData;
        const mono = new Float32Array(length);

        for (let channelIndex = 0; channelIndex < numberOfChannels; channelIndex += 1) {
            const channelData = decodedData.getChannelData(channelIndex);
            for (let i = 0; i < length; i += 1) {
                mono[i] += channelData[i] / numberOfChannels;
            }
        }

        return mono;
    }

    getDecodedData() {
        return this.decodedData;
    }

    getAnalysisMetadata() {
        return this.analysisMetadata;
    }
}
