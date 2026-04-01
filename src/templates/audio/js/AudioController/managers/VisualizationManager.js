import { CONSTANTS } from '../utils/Constants.js';

export class VisualizationManager {
    constructor(state, analysisWorkerManager) {
        this.state = state;
        this.analysisWorkerManager = analysisWorkerManager;
        this.waveformTiles = new Map();
        this.waveformTilePeaks = new Map();
        this.spectrogramTiles = new Map();
        this.viewportWidth = 0;
        this.virtualWidth = 0;
        this.scale = CONSTANTS.SPECTROGRAM.DEFAULT_SCALE;
        this.renderGeneration = 0;
        this.handleScroll = this.handleScroll.bind(this);
        this.handleResize = this.handleResize.bind(this);
    }

    initialize(duration) {
        this.duration = duration || this.state.wavesurfer.getDuration() || 0;
        this.scale = this.state.elements.spectrogramScale?.value || CONSTANTS.SPECTROGRAM.DEFAULT_SCALE;
        this.viewportWidth = Math.max(1, this.state.elements.analysisViewport?.clientWidth || 1);
        this.virtualWidth = Math.max(
            this.viewportWidth,
            Math.ceil(this.duration * CONSTANTS.VISUALIZATION.PIXELS_PER_SECOND)
        );

        this.state.elements.analysisContent.style.width = `${this.virtualWidth}px`;
        this.state.elements.waveformCanvasHost.style.width = `${this.virtualWidth}px`;
        this.state.elements.spectrogram.style.width = `${this.virtualWidth}px`;
        this.state.elements.analysisViewport.style.overflowX = this.virtualWidth > this.viewportWidth ? 'auto' : 'hidden';

        this.state.elements.analysisViewport.removeEventListener('scroll', this.handleScroll);
        this.state.elements.analysisViewport.addEventListener('scroll', this.handleScroll, { passive: true });

        window.removeEventListener('resize', this.handleResize);
        window.addEventListener('resize', this.handleResize);

        this.renderGeneration += 1;
        this.clearTiles();
        this.renderVisibleRange();
    }

    reset() {
        this.renderGeneration += 1;
        this.clearTiles();
        this.duration = 0;
        this.viewportWidth = 0;
        this.virtualWidth = 0;
        if (this.state.elements.analysisContent) {
            this.state.elements.analysisContent.style.width = '100%';
        }
        if (this.state.elements.waveformCanvasHost) {
            this.state.elements.waveformCanvasHost.style.width = '100%';
        }
        if (this.state.elements.spectrogram) {
            this.state.elements.spectrogram.style.width = '100%';
        }
        if (this.state.elements.playhead) {
            this.state.elements.playhead.style.left = '0px';
        }
    }

    async changeSpectrogramScale(newScale) {
        this.scale = newScale;
        this.renderGeneration += 1;
        this.clearSpectrogramTiles();
        await this.renderVisibleRange();
    }

    syncPlaybackPosition(currentTime) {
        if (!this.state.elements.playhead) {
            return;
        }

        const left = Math.min(this.virtualWidth, Math.max(0, currentTime * this.getPixelsPerSecond()));
        this.state.elements.playhead.style.left = `${left}px`;
        this.refreshWaveformProgress();
    }

    dispose() {
        this.state.elements.analysisViewport?.removeEventListener('scroll', this.handleScroll);
        window.removeEventListener('resize', this.handleResize);
        this.clearTiles();
    }

    handleScroll() {
        this.renderVisibleRange();
    }

    handleResize() {
        const previousVirtualWidth = this.virtualWidth;
        this.viewportWidth = Math.max(1, this.state.elements.analysisViewport?.clientWidth || 1);
        this.virtualWidth = Math.max(
            this.viewportWidth,
            Math.ceil(this.duration * CONSTANTS.VISUALIZATION.PIXELS_PER_SECOND)
        );
        this.state.elements.analysisContent.style.width = `${this.virtualWidth}px`;
        this.state.elements.waveformCanvasHost.style.width = `${this.virtualWidth}px`;
        this.state.elements.spectrogram.style.width = `${this.virtualWidth}px`;
        this.state.elements.analysisViewport.style.overflowX = this.virtualWidth > this.viewportWidth ? 'auto' : 'hidden';

        if (previousVirtualWidth !== this.virtualWidth) {
            this.renderGeneration += 1;
            this.clearTiles();
        }

        this.renderVisibleRange();
    }

    async renderVisibleRange() {
        if (!this.analysisWorkerManager?.isReady) {
            return;
        }

        const scrollLeft = this.state.elements.analysisViewport.scrollLeft || 0;
        const viewportWidth = Math.max(1, this.state.elements.analysisViewport.clientWidth || this.viewportWidth);
        const tileWidth = CONSTANTS.VISUALIZATION.TILE_WIDTH;
        const startTile = Math.max(0, Math.floor(scrollLeft / tileWidth) - 1);
        const endTile = Math.max(startTile, Math.ceil((scrollLeft + viewportWidth) / tileWidth) + 1);

        const jobs = [];
        const generation = this.renderGeneration;
        for (let tileIndex = startTile; tileIndex <= endTile; tileIndex += 1) {
            jobs.push(this.ensureWaveformTile(tileIndex, generation));
            jobs.push(this.ensureSpectrogramTile(tileIndex, generation));
        }

        await Promise.allSettled(jobs);
        this.pruneTiles(startTile, endTile);
    }

    async ensureWaveformTile(tileIndex, generation = this.renderGeneration) {
        if (this.waveformTiles.has(tileIndex)) {
            return;
        }

        const tileWidth = CONSTANTS.VISUALIZATION.TILE_WIDTH;
        const left = tileIndex * tileWidth;
        const width = Math.min(tileWidth, Math.max(1, this.virtualWidth - left));
        const pixelsPerSecond = this.getPixelsPerSecond();
        const startTime = left / pixelsPerSecond;
        const endTime = Math.min(this.duration, (left + width) / pixelsPerSecond);

        const canvas = document.createElement('canvas');
        const cacheKey = `wave:${tileIndex}:${width}`;
        canvas.width = width * window.devicePixelRatio;
        canvas.height = CONSTANTS.VISUALIZATION.WAVEFORM_HEIGHT * window.devicePixelRatio;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${CONSTANTS.VISUALIZATION.WAVEFORM_HEIGHT}px`;
        canvas.style.left = `${left}px`;
        canvas.className = 'analysis-tile waveform-tile';
        canvas.dataset.cacheKey = cacheKey;
        this.state.elements.waveformCanvasHost.appendChild(canvas);
        this.waveformTiles.set(tileIndex, canvas);

        try {
            const response = await this.analysisWorkerManager.requestWaveformTile({
                cacheKey,
                tileIndex,
                startTime,
                endTime,
                width,
                height: CONSTANTS.VISUALIZATION.WAVEFORM_HEIGHT
            });

            if (generation !== this.renderGeneration || this.waveformTiles.get(tileIndex) !== canvas) {
                canvas.remove();
                return;
            }

            this.waveformTilePeaks.set(tileIndex, response.peaks);
            this.drawWaveformTile(canvas, response.peaks);
        } catch (error) {
            if (this.waveformTiles.get(tileIndex) === canvas) {
                this.waveformTiles.delete(tileIndex);
                this.waveformTilePeaks.delete(tileIndex);
            }
            canvas.remove();
            throw error;
        }
    }

    async ensureSpectrogramTile(tileIndex, generation = this.renderGeneration) {
        if (this.spectrogramTiles.has(tileIndex)) {
            return;
        }

        const tileWidth = CONSTANTS.VISUALIZATION.TILE_WIDTH;
        const left = tileIndex * tileWidth;
        const width = Math.min(tileWidth, Math.max(1, this.virtualWidth - left));
        const pixelsPerSecond = this.getPixelsPerSecond();
        const startTime = left / pixelsPerSecond;
        const endTime = Math.min(this.duration, (left + width) / pixelsPerSecond);

        const canvas = document.createElement('canvas');
        const cacheKey = `spec:${tileIndex}:${width}:${this.scale}`;
        canvas.width = width;
        canvas.height = CONSTANTS.SPECTROGRAM.HEIGHT;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${CONSTANTS.SPECTROGRAM.HEIGHT}px`;
        canvas.style.left = `${left}px`;
        canvas.className = 'analysis-tile spectrogram-tile';
        canvas.dataset.cacheKey = cacheKey;
        this.state.elements.spectrogram.appendChild(canvas);
        this.spectrogramTiles.set(tileIndex, canvas);

        try {
            const response = await this.analysisWorkerManager.requestSpectrogramTile({
                cacheKey,
                tileIndex,
                startTime,
                endTime,
                width,
                height: CONSTANTS.SPECTROGRAM.HEIGHT,
                scale: this.scale,
                fftSize: CONSTANTS.SPECTROGRAM.FFT_SIZE,
                hopSize: CONSTANTS.SPECTROGRAM.HOP_SIZE
            });

            if (generation !== this.renderGeneration || this.spectrogramTiles.get(tileIndex) !== canvas) {
                canvas.remove();
                return;
            }

            this.drawSpectrogramTile(canvas, response);
        } catch (error) {
            if (this.spectrogramTiles.get(tileIndex) === canvas) {
                this.spectrogramTiles.delete(tileIndex);
            }
            canvas.remove();
            throw error;
        }
    }

    drawWaveformTile(canvas, peaks) {
        const context = canvas.getContext('2d');
        const ratio = window.devicePixelRatio || 1;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);

        const width = parseInt(canvas.style.width, 10);
        const height = CONSTANTS.VISUALIZATION.WAVEFORM_HEIGHT;
        const middle = height / 2;
        const fillStyle = CONSTANTS.VISUALIZATION.WAVEFORM_COLOR;
        const progressStyle = CONSTANTS.VISUALIZATION.WAVEFORM_PROGRESS_COLOR;
        const tileLeft = parseInt(canvas.style.left, 10) || 0;
        const playheadLeft = (this.state.wavesurfer?.getCurrentTime() || 0) * this.getPixelsPerSecond();

        for (let x = 0; x < width; x += 1) {
            const min = peaks[x * 2] ?? 0;
            const max = peaks[(x * 2) + 1] ?? 0;
            const top = middle + (min * middle);
            const bottom = middle + (max * middle);
            context.fillStyle = (tileLeft + x) <= playheadLeft ? progressStyle : fillStyle;
            context.fillRect(x, top, 1, Math.max(1, bottom - top));
        }
    }

    drawSpectrogramTile(canvas, response) {
        const context = canvas.getContext('2d');
        const imageData = new ImageData(response.rgba, response.width, response.height);
        context.putImageData(imageData, 0, 0);
    }

    pruneTiles(startTile, endTile) {
        const minTile = Math.max(0, startTile - 3);
        const maxTile = endTile + 3;

        for (const [tileIndex, canvas] of this.waveformTiles.entries()) {
            if (tileIndex < minTile || tileIndex > maxTile) {
                canvas.remove();
                this.waveformTiles.delete(tileIndex);
                this.waveformTilePeaks.delete(tileIndex);
            }
        }

        for (const [tileIndex, canvas] of this.spectrogramTiles.entries()) {
            if (tileIndex < minTile || tileIndex > maxTile) {
                canvas.remove();
                this.spectrogramTiles.delete(tileIndex);
            }
        }

        this.state.analysisWorkerManager?.syncCacheWindow({
            waveformKeys: Array.from(this.waveformTiles.values(), (canvas) => canvas.dataset.cacheKey).filter(Boolean),
            spectrogramKeys: Array.from(this.spectrogramTiles.values(), (canvas) => canvas.dataset.cacheKey).filter(Boolean)
        });
    }

    clearTiles() {
        this.clearWaveformTiles();
        this.clearSpectrogramTiles();
    }

    clearWaveformTiles() {
        for (const canvas of this.waveformTiles.values()) {
            canvas.remove();
        }
        this.waveformTiles.clear();
        this.waveformTilePeaks.clear();
    }

    refreshWaveformProgress() {
        for (const [tileIndex, canvas] of this.waveformTiles.entries()) {
            const peaks = this.waveformTilePeaks.get(tileIndex);
            if (peaks) {
                this.drawWaveformTile(canvas, peaks);
            }
        }
    }

    clearSpectrogramTiles() {
        for (const canvas of this.spectrogramTiles.values()) {
            canvas.remove();
        }
        this.spectrogramTiles.clear();
    }

    getPixelsPerSecond() {
        if (!this.duration || this.duration <= 0) {
            return CONSTANTS.VISUALIZATION.PIXELS_PER_SECOND;
        }

        return this.virtualWidth / this.duration;
    }
}
