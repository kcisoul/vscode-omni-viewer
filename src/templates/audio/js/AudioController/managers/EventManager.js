import { AudioUtils } from '../utils/AudioUtils.js';

export class EventManager {
    constructor(state, audioContextManager, regionManager) {
        this.state = state;
        this.audioContextManager = audioContextManager;
        this.regionManager = regionManager;
    }

    getPlayableRegion() {
        const selectedRegion = this.regionManager.getSelectedRegion();
        if (
            selectedRegion &&
            Number.isFinite(selectedRegion.start) &&
            Number.isFinite(selectedRegion.end) &&
            selectedRegion.end > selectedRegion.start
        ) {
            return selectedRegion;
        }

        return null;
    }

    async playFromTime(startTime, endTime = null) {
        if (!this.state.wavesurfer) {
            return;
        }

        if (Number.isFinite(endTime) && endTime > startTime) {
            this.state.activePlaybackRegion = {
                start: startTime,
                end: endTime
            };
            await this.state.wavesurfer.play(startTime, endTime);
            return;
        }

        this.state.activePlaybackRegion = null;
        if (Number.isFinite(startTime)) {
            this.state.wavesurfer.setTime(startTime);
        }
        await this.state.wavesurfer.play();
    }

    seekToTime(timeInSeconds) {
        if (!this.state.wavesurfer) {
            return;
        }

        const duration = this.state.wavesurfer.getDuration() || 0;
        const targetTime = Math.max(0, Math.min(timeInSeconds || 0, duration));
        this.state.activePlaybackRegion = null;
        this.state.pendingPlaybackTime = targetTime;
        this.state.wavesurfer.setTime(targetTime);
        this.state.visualizationManager?.syncPlaybackPosition(targetTime);
    }

    seekFromInteraction(event) {
        if (!this.state.wavesurfer) {
            return;
        }

        const clickedElement = event.target;
        if (
            clickedElement?.closest?.('.wavesurfer-region') ||
            clickedElement?.closest?.('.region-input-overlay')
        ) {
            return;
        }

        const currentTarget = event.currentTarget;
        const duration = this.state.wavesurfer.getDuration() || 0;
        if (!currentTarget || duration <= 0) {
            return;
        }

        const bounds = currentTarget.getBoundingClientRect();
        if (!bounds.width) {
            return;
        }

        const relativeX = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
        this.seekToTime(relativeX * duration);
    }

    setupPlayPause() {
        this.state.elements.playPause.addEventListener('click', async () => {
            console.log('Play/Pause button clicked, current state:', this.state.isPlaying);
            try {
                if (this.state.isPlaying) {
                    this.state.wavesurfer.pause();
                    return;
                }

                if (!this.state.wavesurfer) {
                    return;
                }

                if (!this.state.audioContextInitialized) {
                    await this.audioContextManager.initialize();
                }

                await this.audioContextManager.resumeIfNeeded();

                const selectedRegion = this.getPlayableRegion();
                if (selectedRegion) {
                    await this.playFromTime(selectedRegion.start, selectedRegion.end);
                } else {
                    this.state.activePlaybackRegion = null;
                    await this.state.wavesurfer.play();
                }
            } catch (error) {
                console.error('Playback error:', error);
                AudioUtils.showStatus('Playback error: ' + error.message, this.state.elements.status);

                if (error.message.includes('AudioContext') || error.message.includes('suspended')) {
                    this.state.audioContextInitialized = false;
                    await this.audioContextManager.initialize();
                }
            }
        });
    }

    setupStop() {
        this.state.elements.stop.addEventListener('click', () => {
            this.state.activePlaybackRegion = null;
            this.state.pendingPlaybackTime = 0;
            this.state.wavesurfer.stop();
        });
    }

    setupVolume() {
        this.state.elements.volume.addEventListener('input', (e) => {
            const volume = parseFloat(e.target.value);
            this.state.wavesurfer.setVolume(volume);
        });
    }

    setupLoop() {
        this.state.elements.loopEnabled.addEventListener('change', (e) => {
            this.state.loopEnabled = e.target.checked;
        });
    }

    setupSpectrogramScale() {
        if (this.state.elements.spectrogramScale) {
            this.state.elements.spectrogramScale.addEventListener('change', async (e) => {
                const newScale = e.target.value;
                console.log('Spectrogram scale changed to:', newScale);

                if (this.state.visualizationManager) {
                    await this.state.visualizationManager.changeSpectrogramScale(newScale);
                }
            });
        }
    }

    setupKeyboardEvents() {
        document.addEventListener('keydown', async (e) => {
            if (e.code === 'Space' && !e.target.matches('input, textarea')) {
                console.log('Space key detected, triggering play/pause');
                e.preventDefault();

                if (!this.state.audioContextInitialized) {
                    try {
                        await this.audioContextManager.initialize();
                    } catch (error) {
                        console.error('AudioContext initialization failed on spacebar:', error);
                        AudioUtils.showStatus('AudioContext initialization failed: ' + error.message, this.state.elements.status);
                        return;
                    }
                }

                try {
                    await this.audioContextManager.resumeIfNeeded();
                } catch (error) {
                    console.error('Failed to resume AudioContext on spacebar:', error);
                    AudioUtils.showStatus('Failed to resume AudioContext: ' + error.message, this.state.elements.status);
                    return;
                }

                this.state.elements.playPause.click();
            }
        });
    }

    setupSeekInteractions() {
        const seekTargets = [
            this.state.elements.waveform,
            this.state.elements.waveformCanvasHost,
            this.state.elements.spectrogram,
            document.getElementById('timeline')
        ].filter(Boolean);

        seekTargets.forEach((element) => {
            element.addEventListener('click', (event) => {
                this.seekFromInteraction(event);
            });
        });
    }

    setupWaveSurferEvents() {
        this.state.wavesurfer.on('play', () => {
            console.log('WaveSurfer play event triggered');
            this.state.isPlaying = true;
            this.state.elements.playPause.textContent = '⏸️';
            this.state.elements.playPause.classList.add('playing');
        });

        this.state.wavesurfer.on('pause', () => {
            console.log('WaveSurfer pause event triggered');
            this.state.isPlaying = false;
            this.state.pendingPlaybackTime = this.state.wavesurfer.getCurrentTime?.() || 0;
            this.state.elements.playPause.textContent = '▶️';
            this.state.elements.playPause.classList.remove('playing');
        });

        this.state.wavesurfer.on('stop', () => {
            console.log('WaveSurfer stop event triggered');
            this.state.isPlaying = false;
            this.state.activePlaybackRegion = null;
            this.state.pendingPlaybackTime = 0;
            this.state.elements.playPause.textContent = '▶️';
            this.state.elements.playPause.classList.remove('playing');
        });

        this.state.wavesurfer.on('finish', () => {
            if (this.state.loopEnabled) {
                const selectedRegion = this.getPlayableRegion();
                if (selectedRegion) {
                    setTimeout(() => {
                        this.playFromTime(selectedRegion.start, selectedRegion.end);
                    }, 100);
                } else {
                    setTimeout(() => {
                        this.state.activePlaybackRegion = null;
                        this.state.wavesurfer.play();
                    }, 100);
                }
            } else {
                this.state.isPlaying = false;
                this.state.activePlaybackRegion = null;
                this.state.pendingPlaybackTime = 0;
                this.state.elements.playPause.textContent = '▶️';
                this.state.elements.playPause.classList.remove('playing');
            }
        });

        this.state.wavesurfer.on('error', (error) => {
            AudioUtils.showStatus('Error: ' + error.message, this.state.elements.status);
            vscode.postMessage({ command: 'error', text: error.message });
        });

        this.state.wavesurfer.on('ready', () => {
            setTimeout(() => {
                this.audioContextManager.checkState();
            }, 100);
        });

        this.state.wavesurfer.on('interaction', (time) => {
            this.state.pendingPlaybackTime = time;
            this.state.visualizationManager?.syncPlaybackPosition(time);
        });

        this.state.wavesurfer.on('seeking', (time) => {
            this.state.pendingPlaybackTime = time;
            this.state.visualizationManager?.syncPlaybackPosition(time);
        });

        this.state.wavesurfer.on('timeupdate', (currentTime) => {
            if (this.state.isPlaying) {
                this.state.pendingPlaybackTime = currentTime;
            }

            const playbackRegion = this.state.activePlaybackRegion;
            if (playbackRegion && currentTime >= playbackRegion.end - 0.02) {
                if (this.state.loopEnabled) {
                    this.state.wavesurfer.setTime(playbackRegion.start);
                } else {
                    this.state.wavesurfer.pause();
                    this.state.activePlaybackRegion = null;
                }
                return;
            }

            this.state.visualizationManager?.syncPlaybackPosition(currentTime);
        });

        this.state.wavesurfer.on('decode', () => {
            setTimeout(() => {
                this.state.fileInfoManager.updateFileInfo();
            }, 100);
        });
    }
}
