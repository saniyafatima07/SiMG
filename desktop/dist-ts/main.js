"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const child_process = __importStar(require("child_process"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const tempDir = '/tmp/guardian/';
electron_1.app.whenReady().then(() => {
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    const mainWindow = new electron_1.BrowserWindow({
        width: 1100,
        height: 700,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
        }
    });
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.ipcMain.handle('start-pipeline', async (event, dicomPath) => {
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
        const runProcess = (cmd, args, prefix) => {
            return new Promise((resolve, reject) => {
                const proc = child_process.spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
                proc.stdout.on('data', (data) => {
                    const lines = data.toString().split('\n').filter((l) => l.trim() !== '');
                    for (const line of lines) {
                        event.sender.send('log', `[${prefix}] ${line}`);
                    }
                });
                proc.stderr.on('data', (data) => {
                    const lines = data.toString().split('\n').filter((l) => l.trim() !== '');
                    for (const line of lines) {
                        event.sender.send('log', `[${prefix}] ERROR: ${line}`);
                    }
                });
                proc.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    }
                    else {
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
        }
        catch (e) {
            event.sender.send('verdict', { type: 'PIPELINE_ERROR', reason: `Stage 1 failed: ${e.message}` });
            return;
        }
        // --- Stage 2 ---
        const runSandbox1 = () => {
            return new Promise((resolve) => {
                let lastLine = '';
                const proc = child_process.spawn('bash', [sandbox1Script, convertedPng, refSimg, pubKey], { stdio: ['ignore', 'pipe', 'pipe'] });
                proc.stdout.on('data', (data) => {
                    const lines = data.toString().split('\n').filter((l) => l.trim() !== '');
                    for (const line of lines) {
                        event.sender.send('log', `[SANDBOX1] ${line}`);
                        lastLine = line; // capture the last line (verdict JSON)
                    }
                });
                proc.stderr.on('data', (data) => {
                    const lines = data.toString().split('\n').filter((l) => l.trim() !== '');
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
                    }
                    catch (err) {
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
            const lines = data.toString().split('\n').filter((l) => l.trim() !== '');
            for (const line of lines) {
                event.sender.send('log', `[MONAI] ${line}`);
            }
        });
        monaiProc.stderr.on('data', (data) => {
            monaiStderr += data.toString();
            const lines = data.toString().split('\n').filter((l) => l.trim() !== '');
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
            }
            else {
                event.sender.send('verdict', { type: 'PIPELINE_ERROR', reason: monaiStderr || `Docker exited with code ${code}` });
            }
        });
        monaiProc.on('error', (err) => {
            event.sender.send('log', `[GUARDIAN] ERROR: Docker error: ${err.message}`);
            event.sender.send('verdict', { type: 'PIPELINE_ERROR', reason: `Docker error: ${err.message}` });
        });
    }
    catch (err) {
        event.sender.send('log', `[GUARDIAN] ERROR: Pipeline execution failed: ${err.message}`);
        event.sender.send('verdict', { type: 'PIPELINE_ERROR', reason: err.message });
    }
});
