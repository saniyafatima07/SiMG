export interface VerdictPayload {
    type: 'PASS' | 'SECURITY_FAILURE' | 'PIPELINE_ERROR';
    score?: number;
    phash_score?: number;
    ring_score?: number;
    hist_score?: number;
    diagnosis_name?: string;
    diagnosis_confidence?: number;
    generated_image_path?: string;
    reason?: string;
}

export interface GuardianAPI {
    startPipeline: (dicomPath: string, useEvilConverter: boolean) => Promise<void>;
    onLog: (callback: (line: string) => void) => void;
    onVerdict: (callback: (data: VerdictPayload) => void) => void;
    removeAllListeners: () => void;
}

/** Electron extends the browser File object with a `path` property. */
export interface ElectronFile extends File {
    path: string;
}
