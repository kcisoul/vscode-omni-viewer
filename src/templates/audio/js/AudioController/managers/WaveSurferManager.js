import WaveSurfer from 'wavesurfer.js';
import HoverPlugin from '../../../../../../node_modules/wavesurfer.js/dist/plugins/hover.js';
import { CONSTANTS } from '../utils/Constants.js';
import { AudioUtils } from '../utils/AudioUtils.js';

export class WaveSurferManager {
    constructor(state) {
        this.state = state;
    }

    create() {
        const wavesurfer = WaveSurfer.create({
            container: '#waveform',
            waveColor: 'rgba(0, 0, 0, 0)',
            progressColor: 'rgba(0, 0, 0, 0)',
            cursorColor: 'transparent',
            barWidth: CONSTANTS.WAVESURFER.BAR_WIDTH,
            barRadius: CONSTANTS.WAVESURFER.BAR_RADIUS,
            cursorWidth: 0,
            barGap: CONSTANTS.WAVESURFER.BAR_GAP,
            responsive: true,
            sampleRate: CONSTANTS.WAVESURFER.SAMPLE_RATE,
            normalize: true,
            minPxPerSec: CONSTANTS.WAVESURFER.MIN_PX_PER_SEC,
            autoplay: false,
            mediaControls: false,
            hideScrollbar: false,
            interact: true,
            plugins: [
                HoverPlugin.create({
                    lineWidth: 0,
                    labelBackground: '#000000',
                    labelColor: '#fff',
                    formatTimeCallback: AudioUtils.formatTime
                })
            ]
        });

        const mediaElement = wavesurfer.getMediaElement?.();
        if (mediaElement) {
            mediaElement.preload = 'auto';
        }

        return wavesurfer;
    }

    createPlaceholderPeaks(durationSec = 0, channelCount = 1) {
        const seconds = Math.max(1, Math.ceil(durationSec || 1));
        const peakCount = Math.max(256, seconds * 8);
        return Array.from({ length: Math.max(1, channelCount) }, () => new Array(peakCount).fill(0));
    }

    getTimelineIntervals(durationSec) {
        if (!durationSec || durationSec <= 0) {
            return { timeInterval: 1, primaryLabelInterval: 5, secondaryLabelInterval: 1 };
        }

        const timelineEl = document.getElementById('timeline');
        const containerWidth = timelineEl?.offsetWidth || 1000;
        const pixelsPerSecond = containerWidth / durationSec;

        let chosenStep = CONSTANTS.TIMELINE.NICE_STEPS[CONSTANTS.TIMELINE.NICE_STEPS.length - 1];
        for (const step of CONSTANTS.TIMELINE.NICE_STEPS) {
            if (step * pixelsPerSecond >= CONSTANTS.TIMELINE.MIN_TICK_PIXELS) {
                chosenStep = step;
                break;
            }
        }

        return {
            timeInterval: chosenStep,
            primaryLabelInterval: chosenStep * 5,
            secondaryLabelInterval: chosenStep
        };
    }
}
