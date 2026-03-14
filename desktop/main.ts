import { app, BrowserWindow, ipcMain } from 'electron';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const tempDir = '/tmp/guardian/';

function uniquePaths(paths: Array<string | undefined>): string[] {
    return [...new Set(paths.filter((candidate): candidate is string => Boolean(candidate)))];
}

function resolveArtifactPath(label: string, envVarName: string, relativePath: string): string {
    const candidates = uniquePaths([
        process.env[envVarName],
        app.isPackaged ? path.join(process.resourcesPath, relativePath) : undefined,
        app.isPackaged ? path.join(path.dirname(process.resourcesPath), relativePath) : undefined,
        app.isPackaged ? path.join(path.dirname(app.getPath('exe')), relativePath) : undefined,
        path.resolve(__dirname, '..', '..', relativePath),
    ]);

    const resolved = candidates.find((candidate) => fs.existsSync(candidate));
    if (!resolved) {
        throw new Error(`${label} not found. Checked: ${candidates.join(', ')}`);
    }

    return resolved;
}

function getFriendlyPipelineErrorMessage(error: Error): string {
    if (error.message.startsWith('Private key not found.')) {
        return 'Signing key missing. Create `keys/private.pem` locally or set `GUARDIAN_PRIVATE_KEY` to a valid PEM file path. The private key is intentionally not committed.';
    }

    if (error.message.startsWith('Public key not found.')) {
        return 'Public verification key missing. Ensure `keys/public.pem` exists or set `GUARDIAN_PUBLIC_KEY` to a valid PEM file path.';
    }

    return error.message;
}

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

app.whenReady().then(() => {
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const mainWindow = new BrowserWindow({
        width: 1100,
        height: 700,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            devTools: false,
        }
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

ipcMain.handle('start-pipeline', async (event, dicomPath: string, useEvilConverter = false) => {
    try {
        if (!fs.existsSync(dicomPath)) {
            throw new Error(`Selected DICOM file not found: ${dicomPath}`);
        }

        const refSimg = path.join(tempDir, 'ref.simg');
        const convertedPng = path.join(tempDir, 'converted.png');
        const anchorBin = resolveArtifactPath('Anchor binary', 'GUARDIAN_ANCHOR_BIN', 'fingerprint/anchor/build/anchor');
        const converterScript = useEvilConverter
            ? resolveArtifactPath('Evil converter script', 'GUARDIAN_EVIL_CONVERTER_SCRIPT', 'converter/evil_converter.py')
            : resolveArtifactPath('Converter script', 'GUARDIAN_CONVERTER_SCRIPT', 'converter/converter.py');
        const sandboxScript = resolveArtifactPath('Sandbox script', 'GUARDIAN_SANDBOX_SCRIPT', 'sandbox/verification-enclosure/run.sh');
        const inferenceTriggerScript = resolveArtifactPath('Inference trigger script', 'GUARDIAN_INFERENCE_TRIGGER', 'pipelines/inference_trigger.sh');
        const privKey = resolveArtifactPath('Private key', 'GUARDIAN_PRIVATE_KEY', 'keys/private.pem');
        const pubKey = resolveArtifactPath('Public key', 'GUARDIAN_PUBLIC_KEY', 'keys/public.pem');

        event.sender.send('log', `[GUARDIAN] Input DICOM: ${dicomPath}`);
        event.sender.send('log', `[GUARDIAN] Converter mode: ${useEvilConverter ? 'evil_converter.py' : 'converter.py'}`);
        event.sender.send('log', `[GUARDIAN] Using anchor binary: ${anchorBin}`);
        event.sender.send('log', `[GUARDIAN] Using converter script: ${converterScript}`);
        event.sender.send('log', `[GUARDIAN] Using sandbox script: ${sandboxScript}`);
        event.sender.send('log', `[GUARDIAN] Using inference trigger: ${inferenceTriggerScript}`);
        event.sender.send('log', `[GUARDIAN] Using public key: ${pubKey}`);

        // Helper process runner used for Stage 1
        const runProcess = (cmd: string, args: string[], prefix: string): Promise<void> => {
            return new Promise((resolve, reject) => {
                const proc = child_process.spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });

                proc.stdout.on('data', (data) => {
                    const lines = data.toString().split('\n').filter((l: string) => l.trim() !== '');
                    for (const line of lines) {
                        event.sender.send('log', `[${prefix}] ${line}`);
                    }
                });

                proc.stderr.on('data', (data) => {
                    const lines = data.toString().split('\n').filter((l: string) => l.trim() !== '');
                    for (const line of lines) {
                        event.sender.send('log', `[${prefix}] ERROR: ${line}`);
                    }
                });

                proc.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        event.sender.send('log', `[GUARDIAN] ERROR: Process ${prefix} exited with code ${code}`);
                        reject(new Error(`${prefix} exited with code ${code}`));
                    }
                });

                proc.on('error', (err) => {
                    event.sender.send('log', `[GUARDIAN] ERROR: Failed to start ${prefix}: ${err.message}`);
                    reject(err);
                });
            });
        };

        // --- Stage 1 ---
        try {
            await Promise.all([
                runProcess(anchorBin, [dicomPath, refSimg, privKey], 'ANCHOR'),
                runProcess('python3', [converterScript, dicomPath, convertedPng], 'CONVERTER')
            ]);
        } catch (e: any) {
            event.sender.send('verdict', { type: 'PIPELINE_ERROR', reason: `Stage 1 failed: ${e.message}` });
            return;
        }

        // --- Stage 2 ---
        const runSandbox1 = (): Promise<VerdictPayload> => {
            return new Promise((resolve) => {
                const allLines: string[] = [];
                const proc = child_process.spawn('bash', [sandboxScript, convertedPng, refSimg, pubKey], { stdio: ['ignore', 'pipe', 'pipe'] });

                proc.stdout.on('data', (data) => {
                    const lines = data.toString().split('\n').filter((l: string) => l.trim() !== '');
                    for (const line of lines) {
                        event.sender.send('log', `[SANDBOX1] ${line}`);
                        allLines.push(line); // accumulate all lines for JSON scanning
                    }
                });

                proc.stderr.on('data', (data) => {
                    const lines = data.toString().split('\n').filter((l: string) => l.trim() !== '');
                    for (const line of lines) {
                        if (line.startsWith('[VERIFIER]')) {
                            event.sender.send('log', line);
                            continue;
                        }

                        if (line.startsWith('[SANDBOX1] WARNING:')) {
                            event.sender.send('log', line);
                            continue;
                        }

                        event.sender.send('log', `[SANDBOX1] ERROR: ${line}`);
                    }
                });

                proc.on('close', (code) => {
                    if (code !== 0) {
                        event.sender.send('log', `[GUARDIAN] ERROR: Sandbox1 exited with code ${code}`);
                    }

                    // Scan all output lines for valid JSON from the bottom up
                    let verdictJson: any = null;
                    for (let i = allLines.length - 1; i >= 0; i--) {
                        try { verdictJson = JSON.parse(allLines[i]); break; } catch { }
                    }

                    if (verdictJson) {
                        const verdictType = verdictJson.verdict === 'PASS' ? 'PASS' : 'SECURITY_FAILURE';
                        return resolve({
                            type: verdictType,
                            score: verdictJson.score,
                            phash_score: verdictJson.phash_score,
                            ring_score: verdictJson.ring_score,
                            hist_score: verdictJson.hist_score,
                            generated_image_path: convertedPng
                        });
                    } else {
                        return resolve({ type: 'PIPELINE_ERROR', reason: `Sandbox1 exited with code ${code} (No JSON)`, generated_image_path: convertedPng });
                    }
                });

                proc.on('error', (err) => {
                    event.sender.send('log', `[GUARDIAN] ERROR: Sandbox1 error: ${err.message}`);
                    resolve({ type: 'PIPELINE_ERROR', reason: `Sandbox1 error: ${err.message}`, generated_image_path: convertedPng });
                });
            });
        };

        const stage2Result = await runSandbox1();
        if (stage2Result.type === 'SECURITY_FAILURE' || stage2Result.type === 'PIPELINE_ERROR') {
            event.sender.send('verdict', stage2Result);
            return; // Halt if fail
        }

        // --- Stage 3 ---
        const monaiProc = child_process.spawn('bash', [inferenceTriggerScript, convertedPng], {
            cwd: path.dirname(inferenceTriggerScript),
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let monaiStdout = '';
        let monaiStderr = '';

        monaiProc.stdout.on('data', (data) => {
            monaiStdout += data.toString();
            const lines = data.toString().split('\n').filter((l: string) => l.trim() !== '');
            for (const line of lines) {
                event.sender.send('log', `[MONAI] ${line}`);
            }
        });

        monaiProc.stderr.on('data', (data) => {
            monaiStderr += data.toString();
            const lines = data.toString().split('\n').filter((l: string) => l.trim() !== '');
            for (const line of lines) {
                const normalizedLine = line.startsWith('[MONAI]') ? line.slice('[MONAI]'.length).trimStart() : line;
                const isErrorLine = normalizedLine.includes('PIPELINE ERROR')
                    || normalizedLine.includes('Traceback')
                    || normalizedLine.includes('Error')
                    || normalizedLine.includes('Exception');

                event.sender.send('log', isErrorLine ? `[MONAI] ERROR: ${normalizedLine}` : `[MONAI] ${normalizedLine}`);
            }
        });

        monaiProc.on('close', (code) => {
            if (code === 0) {
                let inferenceResult: any = null;
                try {
                    inferenceResult = JSON.parse(monaiStdout);
                } catch {
                    inferenceResult = null;
                }

                event.sender.send('verdict', {
                    type: 'PASS',
                    score: stage2Result.score,
                    phash_score: stage2Result.phash_score,
                    ring_score: stage2Result.ring_score,
                    hist_score: stage2Result.hist_score,
                    diagnosis_name: inferenceResult?.diagnosis?.name,
                    diagnosis_confidence: inferenceResult?.diagnosis?.confidence,
                    generated_image_path: convertedPng
                });
            } else {
                const failureReason = monaiStderr.trim() || monaiStdout.trim() || `Inference exited with code ${code}`;
                event.sender.send('verdict', { type: 'PIPELINE_ERROR', reason: failureReason, generated_image_path: convertedPng });
            }
        });

        monaiProc.on('error', (err) => {
            event.sender.send('log', `[GUARDIAN] ERROR: Inference error: ${err.message}`);
            event.sender.send('verdict', { type: 'PIPELINE_ERROR', reason: `Inference error: ${err.message}` });
        });

    } catch (err: any) {
        const error = err instanceof Error ? err : new Error(String(err));
        const friendlyMessage = getFriendlyPipelineErrorMessage(error);

        event.sender.send('log', `[GUARDIAN] ERROR: Pipeline execution failed: ${friendlyMessage}`);
        event.sender.send('verdict', { type: 'PIPELINE_ERROR', reason: friendlyMessage });
    }
});
