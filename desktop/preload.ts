import { contextBridge, ipcRenderer } from 'electron';

interface VerdictPayload {
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

interface GuardianAPI {
    startPipeline: (dicomPath: string, useEvilConverter: boolean) => Promise<void>;
    onLog: (callback: (line: string) => void) => void;
    onVerdict: (callback: (data: VerdictPayload) => void) => void;
    removeAllListeners: () => void;
}

contextBridge.exposeInMainWorld('guardian', {
    startPipeline: (dicomPath: string, useEvilConverter: boolean) => ipcRenderer.invoke('start-pipeline', dicomPath, useEvilConverter),
    onLog: (callback: (line: string) => void) => ipcRenderer.on('log', (_event, line) => callback(line)),
    onVerdict: (callback: (data: VerdictPayload) => void) => ipcRenderer.on('verdict', (_event, data) => callback(data)),
    removeAllListeners: () => {
        ipcRenderer.removeAllListeners('log');
        ipcRenderer.removeAllListeners('verdict');
    }
} as GuardianAPI);
