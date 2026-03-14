import React, { useState, useEffect, useRef } from 'react';
import { VerdictPayload, ElectronFile } from '../types';

export default function App() {
    const [file, setFile] = useState<File | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [verdict, setVerdict] = useState<VerdictPayload | null>(null);
    const [appState, setAppState] = useState<'welcome' | 'upload' | 'dashboard'>('welcome');
    const [useEvilConverter, setUseEvilConverter] = useState(false);
    const [runToken, setRunToken] = useState(0);
    const [isImageZoomed, setIsImageZoomed] = useState(false);

    // Stages: 0: Init, 1: Fingerprint/Convert, 2: Verify, 3: Infer, 4: Done
    const [currentStage, setCurrentStage] = useState<number>(0);

    const logEndRef = useRef<HTMLDivElement>(null);
    // stageRef keeps stage value accessible inside IPC callbacks without stale closure
    const stageRef = useRef(0);

    useEffect(() => {
        // Auto-scroll logs
        if (logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    // Keep stageRef in sync with currentStage so IPC callbacks read the latest value
    useEffect(() => { stageRef.current = currentStage; }, [currentStage]);

    useEffect(() => {
        window.guardian.removeAllListeners();

        window.guardian.onLog((line) => {
            setLogs(prev => [...prev, line]);

            // Use stageRef (not currentStage) to avoid stale closure
            if (stageRef.current < 1 && (line.includes('[ANCHOR]') || line.includes('[CONVERTER]'))) setCurrentStage(1);
            if (stageRef.current < 2 && (line.includes('[VERIFIER]') || line.includes('[SANDBOX1]'))) setCurrentStage(2);
            if (stageRef.current < 3 && line.includes('[MONAI]')) setCurrentStage(3);
        });

        window.guardian.onVerdict((data) => {
            setVerdict(data);
            setCurrentStage((prev) => (
                data.type === 'PASS' ? 4 : Math.max(prev, stageRef.current, 1)
            ));
            setIsRunning(false);
        });

        return () => {
            window.guardian.removeAllListeners();
        };
    }, []);

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
        stageRef.current = 0;
        setRunToken(prev => prev + 1);
        setIsRunning(true);
        setAppState('dashboard');
        window.guardian.startPipeline((file as ElectronFile).path, useEvilConverter).catch((error) => {
            const reason = error instanceof Error ? error.message : String(error);
            setVerdict({ type: 'PIPELINE_ERROR', reason });
            setIsRunning(false);
        });
    };

    const generatedImageSrc = verdict?.generated_image_path
        ? `file://${verdict.generated_image_path}?v=${runToken}`
        : null;
    const generatedImageName = verdict?.generated_image_path?.split('/').pop() || 'generated-image.png';

    // Theming constants
    const colors = {
        bg: '#F5F5F5',
        panelBg: '#FFFFFF',
        border: '#D4D4D4',
        text: '#050505',
        primary: '#60A5FA',
        pass: '#22C55E',
        warn: '#F59E0B',
        fail: '#EF4444',
        muted: '#6B7280',
        logPrefix: {
            '[GUARDIAN]': '#FFFFFF',
            '[ANCHOR]': '#38BDF8',
            '[CONVERTER]': '#FACC15',
            '[VERIFIER]': '#22C55E',
            '[SANDBOX1]': '#84CC16',
            '[MONAI]': '#A78BFA',
            'ERROR': '#EF4444'
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
        const isDefined = typeof scoreStr === 'number';
        const score = isDefined ? scoreStr : 0;
        const width = isDefined ? `${Math.min(100, Math.max(0, score * 100))}%` : '0%';
        const barColor = score >= 0.85 ? colors.pass : colors.fail;

        return (
            <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '6px' }}>
                    <span>{label}</span>
                    <span style={{ opacity: isDefined ? 1 : 0.4 }}>{isDefined ? score.toFixed(3) : 'N/A'}</span>
                </div>
                <div style={{ width: '100%', height: '8px', background: colors.border, borderRadius: '4px', overflow: 'hidden' }}>
                    {(verdict && isDefined) ? (
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
        const icons = ['1', '2', '3', '4'];
        let statusIcon = icons[stepNum - 1] || `${stepNum}`;

        // Status Logic
        if (stepNum < currentStage) {
            statusIcon = 'OK';
            statusColor = colors.pass;
        } else if (stepNum === currentStage) {
            statusColor = colors.primary;
        }

        // specific fail handling on final stage rendering
        if (verdict && verdict.type !== 'PASS' && stepNum >= currentStage) {
            statusColor = stepNum === currentStage ? colors.fail : colors.border;
            if (stepNum === currentStage) statusIcon = 'X';
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

    const renderConverterToggle = () => (
        <div style={{
            position: 'absolute',
            top: '24px',
            right: '24px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            backgroundColor: colors.panelBg,
            border: `1px solid ${colors.border}`,
            borderRadius: '999px',
            padding: '6px',
            boxShadow: '0 8px 24px rgba(255,255,255,0.04)',
            zIndex: 20
        }}>
            <span style={{
                fontSize: '0.8rem',
                opacity: 0.75,
                paddingLeft: '8px',
                whiteSpace: 'nowrap'
            }}>
                Converter
            </span>
            <button
                onClick={() => setUseEvilConverter(false)}
                disabled={isRunning}
                style={{
                    border: 'none',
                    borderRadius: '999px',
                    padding: '8px 12px',
                    backgroundColor: useEvilConverter ? 'transparent' : colors.primary,
                    color: useEvilConverter ? colors.text : colors.bg,
                    cursor: isRunning ? 'not-allowed' : 'pointer',
                    opacity: isRunning ? 0.6 : 1,
                    fontWeight: 'bold'
                }}
            >
                Clean
            </button>
            <button
                onClick={() => setUseEvilConverter(true)}
                disabled={isRunning}
                style={{
                    border: 'none',
                    borderRadius: '999px',
                    padding: '8px 12px',
                    backgroundColor: useEvilConverter ? colors.fail : 'transparent',
                    color: useEvilConverter ? colors.bg : colors.text,
                    cursor: isRunning ? 'not-allowed' : 'pointer',
                    opacity: isRunning ? 0.6 : 1,
                    fontWeight: 'bold'
                }}
            >
                Evil
            </button>
        </div>
    );

    const handleDownloadGeneratedImage = () => {
        if (!generatedImageSrc) return;

        const link = document.createElement('a');
        link.href = generatedImageSrc;
        link.download = generatedImageName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (appState === 'welcome') {
        return (
            <div style={{
                fontFamily: 'system-ui, -apple-system, sans-serif',
                backgroundColor: colors.bg,
                color: colors.text,
                height: '100vh',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center'
            }}>
                <div style={{
                    fontSize: '5rem',
                    color: colors.primary,
                    marginBottom: '20px',
                    animation: 'spin 10s linear infinite'
                }}>
                    ❖
                </div>
                <h1 style={{
                    fontSize: '3rem',
                    margin: '0 0 10px 0',
                    color: colors.text,
                    letterSpacing: '2px'
                }}>
                    SiMG
                </h1>
                <p style={{
                    fontSize: '1.2rem',
                    opacity: 0.7,
                    margin: '0 0 40px 0',
                    maxWidth: '500px'
                }}>
                    Supply Chain Attack Detection & Medical AI Pipeline Verification
                </p>
                <button
                    onClick={() => setAppState('upload')}
                    style={{
                        backgroundColor: colors.primary,
                        color: colors.bg,
                        border: 'none',
                        padding: '16px 48px',
                        fontSize: '1.2rem',
                        fontWeight: 'bold',
                        borderRadius: '30px',
                        cursor: 'pointer',
                        transition: 'transform 0.2s, background-color 0.2s',
                        boxShadow: '0 10px 30px rgba(255,255,255,0.12)'
                    }}
                    onMouseOver={(e) => {
                        e.currentTarget.style.transform = 'scale(1.05)';
                        e.currentTarget.style.backgroundColor = '#D9D9D9';
                    }}
                    onMouseOut={(e) => {
                        e.currentTarget.style.transform = 'scale(1)';
                        e.currentTarget.style.backgroundColor = colors.primary;
                    }}
                >
                    START GUARDIAN
                </button>
            </div>
        );
    }

    if (appState === 'upload') {
        return (
            <div style={{
                fontFamily: 'system-ui, -apple-system, sans-serif',
                backgroundColor: colors.bg,
                color: colors.text,
                height: '100vh',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '24px',
                boxSizing: 'border-box'
            }}>
                <h2 style={{ fontSize: '2.5rem', margin: '0 0 16px 0', color: colors.primary }}>
                    Upload DICOM Scan
                </h2>
                <p style={{ opacity: 0.7, fontSize: '1.2rem', marginBottom: '48px', textAlign: 'center', maxWidth: '600px' }}>
                    Select or drag-and-drop a DICOM medical image to begin the automated security verification and inference pipeline.
                </p>

                <div
                    onDrop={handleDrop}
                    onDragOver={e => e.preventDefault()}
                    style={{
                        width: '100%',
                        maxWidth: '700px',
                        border: `3px dashed ${file ? colors.primary : colors.border}`,
                        borderRadius: '16px',
                        backgroundColor: colors.panelBg,
                        padding: '80px 32px',
                        textAlign: 'center',
                        transition: 'border-color 0.2s, transform 0.2s',
                        position: 'relative',
                        cursor: 'pointer',
                        boxShadow: file ? '0 0 28px rgba(255,255,255,0.06)' : 'none'
                    }}
                    onMouseOver={(e) => {
                        if (!file) e.currentTarget.style.borderColor = colors.primary;
                    }}
                    onMouseOut={(e) => {
                        if (!file) e.currentTarget.style.borderColor = colors.border;
                    }}
                >
                    <input
                        type="file"
                        accept=".dcm,.dicom"
                        onChange={handleFileChange}
                        style={{
                            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                            opacity: 0, cursor: 'pointer', zIndex: 5
                        }}
                    />

                    <div style={{ fontSize: '5rem', marginBottom: '24px', color: file ? colors.primary : colors.border, transition: 'color 0.2s' }}>
                        {file ? 'FILE' : 'DROP'}
                    </div>

                    {file ? (
                        <div>
                            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: colors.text }}>{file.name}</div>
                            <div style={{ fontSize: '1.2rem', opacity: 0.6, marginTop: '12px' }}>
                                {(file.size / 1024).toFixed(1)} KB
                            </div>
                        </div>
                    ) : (
                        <div>
                            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: colors.text }}>Drop DICOM file here</div>
                            <div style={{ fontSize: '1.2rem', opacity: 0.6, marginTop: '12px' }}>
                                or click anywhere to browse your files
                            </div>
                        </div>
                    )}
                </div>

                <div style={{ marginTop: '48px', width: '100%', maxWidth: '700px', display: 'flex', gap: '20px' }}>
                    <button
                        onClick={() => setAppState('welcome')}
                        style={{
                            backgroundColor: 'transparent',
                            color: colors.text,
                            border: `2px solid ${colors.border}`,
                            padding: '20px 40px',
                            fontSize: '1.3rem',
                            fontWeight: 'bold',
                            borderRadius: '40px',
                            cursor: 'pointer',
                            flex: 1,
                            transition: 'background-color 0.2s'
                        }}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)'}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                        BACK
                    </button>
                    <button
                        onClick={(e) => { e.preventDefault(); handleRun(); }}
                        disabled={!file}
                        style={{
                            position: 'relative',
                            zIndex: 10,
                            backgroundColor: !file ? colors.border : colors.primary,
                            color: !file ? colors.muted : colors.bg,
                            border: 'none',
                            padding: '20px 40px',
                            fontSize: '1.3rem',
                            fontWeight: 'bold',
                            borderRadius: '40px',
                            cursor: !file ? 'not-allowed' : 'pointer',
                            flex: 2,
                            transition: 'background-color 0.3s, transform 0.2s',
                            boxShadow: file ? '0 12px 30px rgba(255,255,255,0.12)' : 'none'
                        }}
                        onMouseOver={(e) => {
                            if (file) {
                                e.currentTarget.style.transform = 'translateY(-2px)';
                                e.currentTarget.style.backgroundColor = '#D9D9D9';
                            }
                        }}
                        onMouseOut={(e) => {
                            if (file) {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.backgroundColor = colors.primary;
                            }
                        }}
                    >
                        RUN PIPELINE
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div style={{
            fontFamily: 'system-ui, -apple-system, sans-serif',
            backgroundColor: colors.bg,
            color: colors.text,
            minHeight: '100vh',
            position: 'relative',
            padding: '24px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px'
        }}>
            {renderConverterToggle()}

            {/* Header */}
            <header style={{ display: 'flex', justifyContent: 'center', textAlign: 'center' }}>
                <div>
                    <div style={{ fontSize: '2.2rem', color: colors.primary, marginBottom: '4px' }}>
                        ❖
                    </div>
                    <h1 style={{ margin: 0, fontSize: '1.5rem', color: colors.primary }}>
                        SiMG
                    </h1>
                    <p style={{ margin: '4px 0 0 0', opacity: 0.7, fontSize: '0.9rem' }}>
                    Supply Chain Attack Detection & Medical AI Pipeline
                    </p>
                </div>
            </header>

            {/* Main Grid container */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 2fr', gap: '24px' }}>

                {/* Left Column (Drop zone & Stages) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', height: '100%' }}>

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
                            {file ? 'FILE' : 'DROP'}
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
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRun(); }}
                            disabled={!file || isRunning}
                            style={{
                                position: 'relative',
                                zIndex: 10,
                                marginTop: '16px',
                                backgroundColor: !file || isRunning ? colors.border : colors.primary,
                                color: colors.text,
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

                    {/* Live Log Panel */}
                    <div style={{
                        backgroundColor: '#FFFFFF',
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
                            color: colors.text, fontWeight: 'bold', letterSpacing: '1px',
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

                {/* Right Column (Verdict) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

                    {/* Verdict Panel (Only visible after run, or conditionally showing empty state) */}
                    <div style={{
                        backgroundColor: verdict ?
                            (verdict.type === 'PASS' ? 'rgba(255,255,255,0.06)' :
                                verdict.type === 'SECURITY_FAILURE' ? 'rgba(255,255,255,0.03)' :
                                    'rgba(255,255,255,0.04)')
                            : colors.panelBg,
                        border: `1px solid ${verdict ?
                            (verdict.type === 'PASS' ? colors.pass :
                                verdict.type === 'SECURITY_FAILURE' ? colors.fail :
                                    colors.warn)
                            : colors.border}`,
                        borderRadius: '8px',
                        padding: '24px',
                        minHeight: '360px',
                        flex: 1,
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
                                <div style={{ display: 'inline-block', animation: 'spin 2s linear infinite' }}>RUN</div>
                                <div style={{ marginTop: '12px', fontWeight: 'bold', letterSpacing: '1px' }}>ANALYZING DICOM INTEGRITY...</div>
                            </div>
                        )}

                        {verdict && (
                            <div style={{ display: 'grid', gap: '20px' }}>
                                <h2 style={{
                                    margin: 0,
                                    color: verdict.type === 'PASS' ? colors.pass : verdict.type === 'SECURITY_FAILURE' ? colors.fail : colors.warn,
                                    display: 'flex', alignItems: 'center', justifyContent: verdict.type === 'SECURITY_FAILURE' ? 'center' : 'flex-start', gap: '12px',
                                    animation: 'none'
                                }}>
                                    {verdict.type === 'PASS' && 'INTEGRITY VERIFIED'}
                                    {verdict.type === 'SECURITY_FAILURE' && '!! COMPROMISED CONVERTER DETECTED !!'}
                                    {verdict.type === 'PIPELINE_ERROR' && 'PIPELINE ERROR'}
                                </h2>

                                {verdict.type === 'PASS' && (
                                    <div>
                                        <div style={{ fontSize: '1.2rem', marginBottom: '14px', fontWeight: 'bold' }}>
                                            Overall Score: {verdict.score?.toFixed(3)}
                                        </div>
                                        {verdict.diagnosis_name && (
                                            <div style={{ display: 'grid', gap: '10px' }}>
                                                <div>
                                                    <span style={{ opacity: 0.65 }}>Diagnosis: </span>
                                                    <span style={{ fontWeight: 'bold' }}>{verdict.diagnosis_name}</span>
                                                </div>
                                                {typeof verdict.diagnosis_confidence === 'number' && (
                                                    <div>
                                                        <span style={{ opacity: 0.65 }}>Confidence: </span>
                                                        <span style={{ fontWeight: 'bold' }}>{verdict.diagnosis_confidence.toFixed(2)}%</span>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {verdict.reason && (
                                    <div style={{
                                        backgroundColor: '#F3F4F6', padding: '12px',
                                        borderRadius: '4px', fontFamily: 'monospace', color: colors.text,
                                        borderLeft: `4px solid ${colors.warn}`
                                    }}>
                                        {verdict.reason}
                                    </div>
                                )}

                                {generatedImageSrc && (
                                    <div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                                            <div style={{ fontSize: '0.85rem', opacity: 0.65, fontWeight: 'bold' }}>
                                                Generated Image
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button
                                                    onClick={() => setIsImageZoomed(true)}
                                                    style={{
                                                        border: `1px solid ${colors.border}`,
                                                        backgroundColor: colors.panelBg,
                                                        color: colors.text,
                                                        borderRadius: '6px',
                                                        padding: '6px 10px',
                                                        cursor: 'pointer',
                                                        fontWeight: 'bold'
                                                    }}
                                                >
                                                    Zoom
                                                </button>
                                                <button
                                                    onClick={handleDownloadGeneratedImage}
                                                    style={{
                                                        border: `1px solid ${colors.border}`,
                                                        backgroundColor: colors.panelBg,
                                                        color: colors.text,
                                                        borderRadius: '6px',
                                                        padding: '6px 10px',
                                                        cursor: 'pointer',
                                                        fontWeight: 'bold'
                                                    }}
                                                >
                                                    Download
                                                </button>
                                            </div>
                                        </div>
                                        <div style={{
                                            border: `1px solid ${colors.border}`,
                                            borderRadius: '8px',
                                            padding: '12px',
                                            backgroundColor: colors.panelBg
                                        }}>
                                            <img
                                                src={generatedImageSrc}
                                                alt="Generated pipeline output"
                                                onClick={() => setIsImageZoomed(true)}
                                                style={{
                                                    display: 'block',
                                                    width: '100%',
                                                    maxHeight: '280px',
                                                    objectFit: 'contain',
                                                    borderRadius: '4px',
                                                    cursor: 'zoom-in'
                                                }}
                                            />
                                        </div>
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

                </div>
            </div>

            {isImageZoomed && generatedImageSrc && (
                <div
                    onClick={() => setIsImageZoomed(false)}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.82)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '32px',
                        zIndex: 1000
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            position: 'relative',
                            width: 'min(92vw, 1100px)',
                            maxHeight: '90vh',
                            backgroundColor: colors.panelBg,
                            borderRadius: '12px',
                            padding: '16px',
                            border: `1px solid ${colors.border}`
                        }}
                    >
                        <button
                            onClick={() => setIsImageZoomed(false)}
                            style={{
                                position: 'absolute',
                                top: '12px',
                                right: '12px',
                                border: `1px solid ${colors.border}`,
                                backgroundColor: colors.panelBg,
                                color: colors.text,
                                borderRadius: '6px',
                                padding: '6px 10px',
                                cursor: 'pointer',
                                fontWeight: 'bold'
                            }}
                        >
                            Close
                        </button>
                        <img
                            src={generatedImageSrc}
                            alt="Generated pipeline output enlarged"
                            style={{
                                display: 'block',
                                width: '100%',
                                maxHeight: 'calc(90vh - 32px)',
                                objectFit: 'contain',
                                borderRadius: '8px'
                            }}
                        />
                    </div>
                </div>
            )}

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
