import { app, BrowserWindow, ipcMain } from 'electron';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const tempDir = '/tmp/guardian/';

interface VerdictPayload {
    type: 'PASS' | 'SECURITY_FAILURE' | 'PIPELINE_ERROR';
    score?: number;
    phash_score?: number;
    ring_score?: number;
    hist_score?: number;
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
        }
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

ipcMain.handle('start-pipeline', async (event, dicomPath: string) => {
    try {
        const refSimg = path.join(tempDir, 'ref.simg');
        const convertedPng = path.join(tempDir, 'converted.png');

        // Setting executable paths relative to the desktop folder
        const baseDir = path.join(__dirname, '..', '..');
        const anchorBin = path.join(baseDir, 'cpp', 'anchor', 'build', 'anchor');
        const converterScript = path.join(baseDir, 'converter', 'converter.py');
        const sandbox1Script = path.join(baseDir, 'sandbox1', 'run.sh');
        const privKey = path.join(baseDir, 'keys', 'private.pem');
        const pubKey = path.join(baseDir, 'keys', 'public.pem');

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
                let lastLine = '';
                const proc = child_process.spawn('bash', [sandbox1Script, convertedPng, refSimg, pubKey], { stdio: ['ignore', 'pipe', 'pipe'] });

                proc.stdout.on('data', (data) => {
                    const lines = data.toString().split('\n').filter((l: string) => l.trim() !== '');
                    for (const line of lines) {
                        event.sender.send('log', `[SANDBOX1] ${line}`);
                        lastLine = line; // capture the last line (verdict JSON)
                    }
                });

                proc.stderr.on('data', (data) => {
                    const lines = data.toString().split('\n').filter((l: string) => l.trim() !== '');
                    for (const line of lines) {
                        event.sender.send('log', `[SANDBOX1] ERROR: ${line}`);
                    }
                });

                proc.on('close', (code) => {
                    if (code !== 0) {
                        event.sender.send('log', `[GUARDIAN] ERROR: Sandbox1 exited with code ${code}`);
                        return resolve({ type: 'PIPELINE_ERROR', reason: `Sandbox1 exited with code ${code}` });
                    }

                    try {
                        const parsed = JSON.parse(lastLine);
                        const verdictType = parsed.verdict === 'PASS' ? 'PASS' : 'SECURITY_FAILURE';
                        resolve({
                            type: verdictType,
                            score: parsed.score,
                            phash_score: parsed.phash_score,
                            ring_score: parsed.ring_score,
                            hist_score: parsed.hist_score
                        });
                    } catch (err: any) {
                        resolve({ type: 'PIPELINE_ERROR', reason: `Failed to parse verifier output JSON: ${err.message}` });
                    }
                });

                proc.on('error', (err) => {
                    event.sender.send('log', `[GUARDIAN] ERROR: Sandbox1 error: ${err.message}`);
                    resolve({ type: 'PIPELINE_ERROR', reason: `Sandbox1 error: ${err.message}` });
                });
            });
        };

        const stage2Result = await runSandbox1();
        if (stage2Result.type === 'SECURITY_FAILURE' || stage2Result.type === 'PIPELINE_ERROR') {
            event.sender.send('verdict', stage2Result);
            return; // Halt if fail
        }

        // --- Stage 3 ---
        const outputDir = path.join(tempDir, 'output');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const monaiProc = child_process.spawn('docker', [
            'run', '--rm', '--network', 'none',
            '-v', `${convertedPng}:/input/image.png:ro`,
            '-v', `${outputDir}:/output`,
            'dicom-guardian-monai'
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        let monaiStderr = '';

        monaiProc.stdout.on('data', (data) => {
            const lines = data.toString().split('\n').filter((l: string) => l.trim() !== '');
            for (const line of lines) {
                event.sender.send('log', `[MONAI] ${line}`);
            }
        });

        monaiProc.stderr.on('data', (data) => {
            monaiStderr += data.toString();
            const lines = data.toString().split('\n').filter((l: string) => l.trim() !== '');
            for (const line of lines) {
                event.sender.send('log', `[MONAI] ERROR: ${line}`);
            }
        });

        monaiProc.on('close', (code) => {
            if (code === 0) {
                event.sender.send('verdict', {
                    type: 'PASS',
                    score: stage2Result.score,
                    phash_score: stage2Result.phash_score,
                    ring_score: stage2Result.ring_score,
                    hist_score: stage2Result.hist_score
                });
            } else {
                event.sender.send('verdict', { type: 'PIPELINE_ERROR', reason: monaiStderr || `Docker exited with code ${code}` });
            }
        });

        monaiProc.on('error', (err) => {
            event.sender.send('log', `[GUARDIAN] ERROR: Docker error: ${err.message}`);
            event.sender.send('verdict', { type: 'PIPELINE_ERROR', reason: `Docker error: ${err.message}` });
        });

    } catch (err: any) {
        event.sender.send('log', `[GUARDIAN] ERROR: Pipeline execution failed: ${err.message}`);
        event.sender.send('verdict', { type: 'PIPELINE_ERROR', reason: err.message });
    }
});
