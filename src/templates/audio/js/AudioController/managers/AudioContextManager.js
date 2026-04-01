import { AudioUtils } from '../utils/AudioUtils.js';

export class AudioContextManager {
    constructor(state) {
        this.state = state;
        this.audioContext = null;
    }

    async initialize() {
        if (this.state.audioContextInitialized) return this.audioContext;
        
        try {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            this.state.audioContextInitialized = true;
            return this.audioContext;
            
        } catch (error) {
            console.error('Failed to initialize AudioContext:', error);
            AudioUtils.showStatus('AudioContext initialization failed: ' + error.message, this.state.elements?.status);
            return null;
        }
    }

    async resumeIfNeeded() {
        const context = await this.initialize();
        if (!context) {
            return null;
        }

        if (context.state === 'suspended') {
            await context.resume();
        }

        return context;
    }

    getWaveSurferAudioContext() {
        try {
            return this.audioContext;
        } catch (error) {
            console.error('Error getting WaveSurfer AudioContext:', error);
            return null;
        }
    }

    checkState() {
        const audioContext = this.getWaveSurferAudioContext();
        if (audioContext) {
            return audioContext.state;
        } else {
            return null;
        }
    }

    async dispose() {
        if (this.audioContext && this.audioContext.state !== 'closed') {
            await this.audioContext.close();
        }

        this.audioContext = null;
        this.state.audioContextInitialized = false;
    }
}
