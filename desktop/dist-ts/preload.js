"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('guardian', {
    startPipeline: (dicomPath) => electron_1.ipcRenderer.invoke('start-pipeline', dicomPath),
    onLog: (callback) => electron_1.ipcRenderer.on('log', (_event, line) => callback(line)),
    onVerdict: (callback) => electron_1.ipcRenderer.on('verdict', (_event, data) => callback(data)),
    removeAllListeners: () => {
        electron_1.ipcRenderer.removeAllListeners('log');
        electron_1.ipcRenderer.removeAllListeners('verdict');
    }
});
