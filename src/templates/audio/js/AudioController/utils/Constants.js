// Constants for audio viewer
export const CONSTANTS = {
    WAVESURFER: {
        WAVE_COLOR: 'rgba(110, 148, 255, 0.32)',
        PROGRESS_COLOR: 'rgba(255, 132, 132, 0.42)',
        CURSOR_COLOR: '#fff',
        BAR_WIDTH: 2,
        BAR_RADIUS: 3,
        CURSOR_WIDTH: 1,
        BAR_GAP: 3,
        SAMPLE_RATE: 44100,
        MIN_PX_PER_SEC: 24,
    },
    TIMELINE: {
        MIN_TICK_PIXELS: 100,
        NICE_STEPS: [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
    },
    SPECTROGRAM: {
        FFT_SIZE: 1024,
        HOP_SIZE: 256,
        HEIGHT: 250,
        SCALE_OPTIONS: [
            { value: 'linear', label: 'Linear' },
            { value: 'mel', label: 'Mel' },
            { value: 'bark', label: 'Bark' },
            { value: 'erb', label: 'ERB' }
        ],
        DEFAULT_SCALE: 'mel'
    },
    VISUALIZATION: {
        PIXELS_PER_SECOND: 24,
        TILE_WIDTH: 512,
        WAVEFORM_HEIGHT: 160,
        WAVEFORM_COLOR: 'rgba(110, 148, 255, 0.70)',
        WAVEFORM_PROGRESS_COLOR: 'rgba(255, 132, 132, 0.85)'
    },
    REGION: {
        MIN_DURATION: 0.1
    }
};
