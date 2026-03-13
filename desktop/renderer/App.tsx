import React, { useState, useEffect, useRef } from 'react';
import { VerdictPayload } from '../types';

export default function App() {
    const [file, setFile] = useState<File | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [verdict, setVerdict] = useState<VerdictPayload | null>(null);

    // Stages: 0: Init, 1: Fingerprint/Convert, 2: Verify, 3: Infer, 4: Done
    const [currentStage, setCurrentStage] = useState<number>(0);

    const logEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Auto-scroll logs
        if (logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    useEffect(() => {
        if (isRunning) {
            window.guardian.removeAllListeners();

            window.guardian.onLog((line) => {
                setLogs(prev => [...prev, line]);

                // Infer stage progression from logs
                if (currentStage < 1 && (line.includes('[ANCHOR]') || line.includes('[CONVERTER]'))) setCurrentStage(1);
                if (currentStage < 2 && (line.includes('[VERIFIER]') || line.includes('[SANDBOX1]'))) setCurrentStage(2);
                if (currentStage < 3 && line.includes('[MONAI]')) setCurrentStage(3);
            });

            window.guardian.onVerdict((data) => {
                setVerdict(data);
                setCurrentStage(4);
                setIsRunning(false);
            });
        }

        return () => {
            if (!isRunning) window.guardian.removeAllListeners();
        };
    }, [isRunning]);

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        if (isRunning) return;
        const droppedFile = e.dataTransfer.files[0];
        if (droppedFile) setFile(droppedFile);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setFile(e.target.files[0]);
        }
    };

    const handleRun = () => {
        if (!file) return;
        setLogs([]);
        setVerdict(null);
        setCurrentStage(0);
        setIsRunning(true);
        // @ts-ignore path exists on File in Electron
        window.guardian.startPipeline(file.path);
    };

    // Theming constants
    const colors = {
        bg: '#0F172A',         // Deep navy
        panelBg: '#1E293B',    // Charcoal
        border: '#334155',
        text: '#E2E8F0',
        primary: '#0EA5E9',    // Sky blue
        pass: '#10B981',       // Clinical green
        warn: '#F59E0B',       // Amber
        fail: '#EF4444',       // Alert red
        logPrefix: {
            '[GUARDIAN]': '#FFFFFF',
            '[ANCHOR]': '#22D3EE',    // Cyan
            '[CONVERTER]': '#FDE047', // Yellow
            '[VERIFIER]': '#84CC16',  // Lime
            '[SANDBOX1]': '#84CC16',  // Lime alias
            '[MONAI]': '#38BDF8',     // Skyblue
            'ERROR': '#EF4444'        // Red
        }
    };

    const renderLogLine = (log: string, idx: number) => {
        let color = colors.text;
        let fontWeight = 'normal';

        if (log.includes('ERROR')) {
            color = colors.logPrefix['ERROR'];
            fontWeight = 'bold';
        } else {
            for (const [prefix, prefixColor] of Object.entries(colors.logPrefix)) {
                if (log.startsWith(prefix)) {
                    color = prefixColor;
                    break;
                }
            }
        }

        return (
            <div key={idx} style={{ color, fontWeight, marginBottom: '2px', wordBreak: 'break-all' }}>
                {log}
            </div>
        );
    };

    const ScoreBar = ({ label, scoreStr }: { label: string, scoreStr?: number }) => {
        const score = typeof scoreStr === 'number' ? scoreStr : 0;
        const width = `${Math.min(100, Math.max(0, score * 100))}%`;
        const barColor = score >= 0.85 ? colors.pass : colors.fail;

        return (
            <div style={{ marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '4px' }}>
                    <span>{label}</span>
                    <span>{score.toFixed(3)}</span>
                </div>
                <div style={{ width: '100%', height: '8px', background: colors.border, borderRadius: '4px', overflow: 'hidden' }}>
                    {verdict ? (
                        <div style={{
                            height: '100%',
                            width: width,
                            background: barColor,
                            transition: 'width 1s ease-out'
                        }} />
                    ) : (
                        <div style={{ width: '0%' }} />
                    )}
                </div>
            </div>
        );
    };

    const renderStage = (stepNum: number, label: string) => {
        let statusColor = colors.text;
        const icons = ['①', '②', '③', '④'];
        let statusIcon = icons[stepNum - 1] || `${stepNum}`;

        // Status Logic
        if (stepNum < currentStage) {
            statusIcon = '✓';
            statusColor = colors.pass;
        } else if (stepNum === currentStage) {
            statusColor = colors.primary;
        }

        // specific fail handling on final stage rendering
        if (verdict && verdict.type !== 'PASS' && stepNum >= currentStage) {
            statusColor = stepNum === currentStage ? colors.fail : colors.border;
            if (stepNum === currentStage) statusIcon = '✗';
        }

        return (
            <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                color: statusColor,
                opacity: stepNum > currentStage ? 0.4 : 1,
                fontWeight: stepNum === currentStage ? 'bold' : 'normal'
            }}>
                <div style={{
                    width: '24px', height: '24px', borderRadius: '50%',
                    border: `1px solid ${statusColor}`, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem'
                }}>
                    {statusIcon}
                </div>
                <span>{label}</span>
            </div>
        );
    };

    return (
        <div style={{
            fontFamily: 'system-ui, -apple-system, sans-serif',
            backgroundColor: colors.bg,
            color: colors.text,
            minHeight: '100vh',
            padding: '24px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px'
        }}>

            {/* Header */}
            <header>
                <h1 style={{ margin: 0, fontSize: '1.5rem', color: colors.primary, display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '1.8rem' }}>❖</span> DICOM GUARDIAN
                </h1>
                <p style={{ margin: '4px 0 0 0', opacity: 0.7, fontSize: '0.9rem' }}>
                    Supply Chain Attack Detection & Medical AI Pipeline
                </p>
            </header>

            {/* Main Grid container */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 2fr', gap: '24px' }}>

                {/* Left Column (Drop zone & Stages) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

                    {/* File Drop Zone */}
                    <div
                        onDrop={handleDrop}
                        onDragOver={e => e.preventDefault()}
                        style={{
                            border: `2px dashed ${file ? colors.primary : colors.border}`,
                            borderRadius: '8px',
                            backgroundColor: colors.panelBg,
                            padding: '32px 16px',
                            textAlign: 'center',
                            transition: 'border-color 0.2s',
                            position: 'relative',
                            cursor: isRunning ? 'not-allowed' : 'pointer',
                            opacity: isRunning ? 0.7 : 1
                        }}
                    >
                        <input
                            type="file"
                            accept=".dcm,.dicom"
                            onChange={handleFileChange}
                            disabled={isRunning}
                            style={{
                                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                                opacity: 0, cursor: isRunning ? 'not-allowed' : 'pointer'
                            }}
                        />

                        <div style={{ fontSize: '2rem', marginBottom: '12px', color: file ? colors.primary : colors.border }}>
                            {file ? '📄' : '📥'}
                        </div>

                        {file ? (
                            <div>
                                <div style={{ fontWeight: 'bold' }}>{file.name}</div>
                                <div style={{ fontSize: '0.8rem', opacity: 0.6, marginTop: '4px' }}>
                                    {(file.size / 1024).toFixed(1)} KB
                                </div>
                            </div>
                        ) : (
                            <div>
                                <div style={{ fontWeight: 'bold' }}>Drop DICOM file here</div>
                                <div style={{ fontSize: '0.8rem', opacity: 0.6, marginTop: '4px' }}>
                                    or click to browse
                                </div>
                            </div>
                        )}

                        <button
                            onClick={(e) => { e.stopPropagation(); handleRun(); }}
                            disabled={!file || isRunning}
                            style={{
                                marginTop: '16px',
                                backgroundColor: !file || isRunning ? colors.border : colors.primary,
                                color: 'white',
                                border: 'none',
                                padding: '8px 24px',
                                borderRadius: '4px',
                                fontWeight: 'bold',
                                cursor: !file || isRunning ? 'not-allowed' : 'pointer',
                                transition: 'background-color 0.2s',
                                width: '100%'
                            }}
                        >
                            {isRunning ? 'PIPELINE RUNNING...' : 'RUN PIPELINE'}
                        </button>
                    </div>

                    {/* Stage Indicator Panel */}
                    <div style={{
                        backgroundColor: colors.panelBg,
                        borderRadius: '8px',
                        padding: '24px',
                        border: `1px solid ${colors.border}`
                    }}>
                        <h3 style={{ margin: '0 0 16px 0', fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '1px', opacity: 0.8 }}>
                            Pipeline Status
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {renderStage(1, "Fingerprint + Convert")}
                            {renderStage(2, "Verify Security")}
                            {renderStage(3, "MONAI Inference")}
                            {renderStage(4, "Pipeline Complete")}
                        </div>
                    </div>
                </div>

                {/* Right Column (Verdict & Logs) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

                    {/* Verdict Panel (Only visible after run, or conditionally showing empty state) */}
                    <div style={{
                        backgroundColor: verdict ?
                            (verdict.type === 'PASS' ? 'rgba(16, 185, 129, 0.1)' :
                                verdict.type === 'SECURITY_FAILURE' ? 'rgba(239, 68, 68, 0.1)' :
                                    'rgba(245, 158, 11, 0.1)')
                            : colors.panelBg,
                        border: `1px solid ${verdict ?
                            (verdict.type === 'PASS' ? colors.pass :
                                verdict.type === 'SECURITY_FAILURE' ? colors.fail :
                                    colors.warn)
                            : colors.border}`,
                        borderRadius: '8px',
                        padding: '24px',
                        minHeight: '180px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center'
                    }}>
                        {!verdict && !isRunning && (
                            <div style={{ textAlign: 'center', opacity: 0.4 }}>
                                Awaiting pipeline execution...
                            </div>
                        )}

                        {isRunning && !verdict && (
                            <div style={{ textAlign: 'center', color: colors.primary }}>
                                <div style={{ display: 'inline-block', animation: 'spin 2s linear infinite' }}>⚙️</div>
                                <div style={{ marginTop: '12px', fontWeight: 'bold', letterSpacing: '1px' }}>ANALYZING DICOM INTEGRITY...</div>
                            </div>
                        )}

                        {verdict && (
                            <div>
                                <h2 style={{
                                    margin: '0 0 16px 0',
                                    color: verdict.type === 'PASS' ? colors.pass : verdict.type === 'SECURITY_FAILURE' ? colors.fail : colors.warn,
                                    display: 'flex', alignItems: 'center', gap: '12px',
                                    animation: verdict.type === 'SECURITY_FAILURE' ? 'flash 2s infinite' : 'none'
                                }}>
                                    {verdict.type === 'PASS' && '✓ INTEGRITY VERIFIED'}
                                    {verdict.type === 'SECURITY_FAILURE' && '!! COMPROMISED CONVERTER DETECTED !!'}
                                    {verdict.type === 'PIPELINE_ERROR' && '⚠ PIPELINE ERROR'}
                                </h2>

                                {verdict.type === 'PASS' && (
                                    <div style={{ fontSize: '1.2rem', marginBottom: '24px', fontWeight: 'bold' }}>
                                        Overall Score: {verdict.score?.toFixed(3)}
                                    </div>
                                )}

                                {verdict.reason && (
                                    <div style={{
                                        backgroundColor: 'rgba(0,0,0,0.3)', padding: '12px',
                                        borderRadius: '4px', fontFamily: 'monospace', color: colors.warn,
                                        marginBottom: '16px', borderLeft: `4px solid ${colors.warn}`
                                    }}>
                                        {verdict.reason}
                                    </div>
                                )}

                                {(verdict.type === 'PASS' || verdict.type === 'SECURITY_FAILURE') && (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
                                        <ScoreBar label="pHash Cryptographic Score" scoreStr={verdict.phash_score} />
                                        <ScoreBar label="Ring Artifact Analysis" scoreStr={verdict.ring_score} />
                                        <ScoreBar label="Histogram Frequency Match" scoreStr={verdict.hist_score} />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Live Log Panel */}
                    <div style={{
                        backgroundColor: '#000000',
                        borderRadius: '8px',
                        border: `1px solid ${colors.border}`,
                        padding: '16px',
                        fontFamily: '"Fira Code", "Courier New", Courier, monospace',
                        fontSize: '0.85rem',
                        height: '280px',
                        display: 'flex',
                        flexDirection: 'column'
                    }}>
                        <div style={{
                            borderBottom: `1px solid ${colors.border}`,
                            paddingBottom: '8px', marginBottom: '8px',
                            color: colors.primary, fontWeight: 'bold', letterSpacing: '1px',
                            display: 'flex', justifyContent: 'space-between'
                        }}>
                            <span>TERMINAL OUTPUT</span>
                            <span style={{ opacity: 0.5 }}>[{logs.length} lines]</span>
                        </div>

                        <div style={{ flex: 1, overflowY: 'auto' }}>
                            {logs.length === 0 ? (
                                <div style={{ opacity: 0.3, fontStyle: 'italic' }}>System idle. Ready for input.</div>
                            ) : (
                                logs.map((log, idx) => renderLogLine(log, idx))
                            )}
                            <div ref={logEndRef} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Inline styles for basic animations */}
            <style>{`
        @keyframes flash {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        ::-webkit-scrollbar-track {
          background: ${colors.bg};
        }
        ::-webkit-scrollbar-thumb {
          background: ${colors.border};
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: ${colors.primary};
        }
      `}</style>
        </div>
    );
}
