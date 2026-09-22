import React, { useState, useEffect } from 'react';
import {
    X,
    RefreshCw,
    Play,
    AlertTriangle,
    CheckCircle2,
    XCircle,
    HelpCircle,
    Cpu,
    Volume2,
    Terminal,
    Activity,
    Layers,
} from 'lucide-react';

interface DiagnosticsModalProps {
    isOpen: boolean;
    onClose: () => void;
    localServerUrl: string;
}

interface DebugData {
    status: string;
    python_version?: string;
    platform?: string;
    dependencies?: {
        ffmpeg: boolean;
        vieneu: boolean;
        whisper: boolean;
        gemini: boolean;
        cuda: boolean;
    };
    diagnostics?: {
        vieneu_installed: boolean;
        vieneu_version?: string;
        vieneu_error?: string;
        vieneu_loaded: boolean;
        last_tts_voice?: string;
        last_tts_duration_ms?: number;
        last_tts_file_size?: number;
        last_tts_is_real?: boolean;
        last_tts_error?: string;
        torch_cuda?: boolean;
        torch_version?: string;
        ffmpeg_path?: string;
        ffmpeg_version?: string;
        whisper_installed?: boolean;
    };
}

export function DiagnosticsModal({
                                     isOpen,
                                     onClose,
                                     localServerUrl,
                                 }: DiagnosticsModalProps) {
    const [loading, setLoading] = useState(false);
    const [debugData, setDebugData] = useState<DebugData | null>(null);
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const [pingMs, setPingMs] = useState<number | null>(null);

    // Direct TTS test state
    const [testText, setTestText] = useState('Xin chào, đây là câu thử nghiệm trực tiếp từ VieNeu Local SDK.');
    const [testVoice, setTestVoice] = useState('Minh Quân');
    const [testingTTS, setTestingTTS] = useState(false);
    const [testResult, setTestResult] = useState<{
        success: boolean;
        is_real_vieneu: boolean;
        audio_url?: string;
        audio_base64?: string;
        duration_ms?: number;
        file_size?: number;
        error?: string;
        message?: string;
    } | null>(null);

    // Fetch debug info
    const fetchDiagnostics = async () => {
        setLoading(true);
        setConnectionError(null);
        const start = performance.now();
        try {
            const res = await fetch(`${localServerUrl}/api/debug`, { method: 'GET' });
            const end = performance.now();
            setPingMs(Math.round(end - start));

            if (res.ok) {
                const data = await res.json();
                setDebugData(data);
            } else {
                setConnectionError(`Máy chủ phản hồi mã lỗi HTTP ${res.status}`);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Không kết nối được';
            setConnectionError(
                `Không thể kết nối tới ${localServerUrl} (${msg}). Hãy đảm bảo đã chạy: python local_backend.py hoặc python start.py`
            );
            setDebugData(null);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchDiagnostics();
        }
    }, [isOpen]);

    // Run direct TTS Test on Local Python
    const handleTestTTS = async () => {
        setTestingTTS(true);
        setTestResult(null);
        try {
            const res = await fetch(`${localServerUrl}/api/debug-tts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    voice: testVoice,
                    text: testText,
                }),
            });
            const data = await res.json();
            setTestResult(data);

            if (data.audio_base64 || data.audio_url) {
                const audioSrc = data.audio_base64 || `${localServerUrl}${encodeURI(data.audio_url)}?t=${Date.now()}`;
                const audio = new Audio(audioSrc);
                audio.play().catch(e => console.log('Không thể tự phát audio:', e));
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Lỗi kết nối';
            setTestResult({
                success: false,
                is_real_vieneu: false,
                error: `Không gọi được tới ${localServerUrl}/api/debug-tts: ${msg}`,
            });
        } finally {
            setTestingTTS(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
            <div className="bg-white border border-slate-300 shadow-2xl w-full max-w-3xl rounded-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Modal Header */}
                <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between border-b border-slate-800">
                    <div className="flex items-center gap-2.5">
                        <Activity className="w-5 h-5 text-emerald-400" />
                        <div>
                            <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                                <span>Chẩn Đoán &amp; Debug Trạng Thái Toàn Diện</span>
                                <span className="text-[11px] font-normal px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                  {pingMs !== null ? `${pingMs}ms latency` : 'Local Engine'}
                </span>
                            </h2>
                            <p className="text-xs text-slate-400">
                                Tìm hiểu lý do tại sao phát sinh giọng nước ngoài &amp; kiểm tra VieNeu Native SDK
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Modal Body */}
                <div className="p-5 space-y-5 overflow-y-auto text-xs sm:text-sm text-slate-700">
                    {/* 1. GIẢI THÍCH NGUYÊN NHÂN GIỌNG NƯỚC NGOÀI */}
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-950 space-y-2">
                        <div className="font-bold flex items-center gap-2 text-sm text-amber-900">
                            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                            <span>Tại sao bạn lại nghe thấy giọng đọc nước ngoài (tiếng Anh lơ lớ)?</span>
                        </div>
                        <p className="text-xs text-amber-900/90 leading-relaxed">
                            Mặc định trên hệ điều hành <strong>Windows</strong>, hệ thống chỉ có giọng tiếng Anh (như <code>Microsoft David</code> hoặc <code>Microsoft Zira</code>). Khi Web GUI chưa kết nối được tới <strong>VieNeu Python Local (cổng 8000)</strong>, trình duyệt sẽ dùng giọng mặc định của Windows để đọc tiếng Việt, dẫn đến việc người nghe nghe như <em>người Mỹ đang đánh vần chữ tiếng Việt</em>!
                        </p>
                        <div className="text-xs bg-white/80 p-2.5 rounded-lg border border-amber-300/70 font-medium">
                            👉 <strong>Giải pháp chuẩn:</strong> Bạn cần chạy file <code>python local_backend.py</code> (hoặc <code>python start.py</code>) để nạp <strong>VieNeu Neural TTS</strong> xịn vào máy!
                        </div>
                    </div>

                    {/* 2. TRẠNG THÁI KẾT NỐI LOCAL BACKEND */}
                    <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50">
                        <div className="flex items-center justify-between">
                            <div className="font-bold text-slate-900 flex items-center gap-2">
                                <Terminal className="w-4 h-4 text-blue-600" />
                                <span>1. Máy chủ Python Local (Cổng 8000)</span>
                            </div>
                            <button
                                onClick={fetchDiagnostics}
                                disabled={loading}
                                className="px-2.5 py-1 text-xs bg-white hover:bg-slate-100 border border-slate-300 rounded-md font-semibold text-slate-700 flex items-center gap-1 cursor-pointer transition-colors"
                            >
                                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                                <span>{loading ? 'Đang kiểm tra...' : 'Kiểm tra lại'}</span>
                            </button>
                        </div>

                        {connectionError ? (
                            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-xs flex items-start gap-2">
                                <XCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                                <div>
                                    <strong>Chưa kết nối được:</strong> {connectionError}
                                </div>
                            </div>
                        ) : debugData ? (
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                                <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                                    <div className="text-slate-500 text-[11px]">FFmpeg Native</div>
                                    <div className="font-bold text-slate-800 flex items-center gap-1 mt-0.5">
                                        {debugData.dependencies?.ffmpeg ? (
                                            <span className="text-emerald-600 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Sẵn sàng
                      </span>
                                        ) : (
                                            <span className="text-red-600 flex items-center gap-1">
                        <XCircle className="w-3.5 h-3.5" /> Chưa cài
                      </span>
                                        )}
                                    </div>
                                </div>

                                <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                                    <div className="text-slate-500 text-[11px]">VieNeu Python SDK</div>
                                    <div className="font-bold text-slate-800 flex items-center gap-1 mt-0.5">
                                        {debugData.dependencies?.vieneu ? (
                                            <span className="text-emerald-600 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Đã cài (vieneu)
                      </span>
                                        ) : (
                                            <span className="text-amber-600 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> Chưa cài
                      </span>
                                        )}
                                    </div>
                                </div>

                                <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                                    <div className="text-slate-500 text-[11px]">PyTorch &amp; GPU</div>
                                    <div className="font-bold text-slate-800 flex items-center gap-1 mt-0.5">
                                        {debugData.dependencies?.cuda ? (
                                            <span className="text-emerald-600 flex items-center gap-1">
                        <Cpu className="w-3.5 h-3.5" /> CUDA GPU
                      </span>
                                        ) : (
                                            <span className="text-slate-700 flex items-center gap-1">
                        <Cpu className="w-3.5 h-3.5" /> CPU Mode
                      </span>
                                        )}
                                    </div>
                                </div>

                                <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                                    <div className="text-slate-500 text-[11px]">Faster-Whisper</div>
                                    <div className="font-bold text-slate-800 flex items-center gap-1 mt-0.5">
                                        {debugData.dependencies?.whisper ? (
                                            <span className="text-emerald-600 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Sẵn sàng
                      </span>
                                        ) : (
                                            <span className="text-slate-600 flex items-center gap-1">Chưa cài</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {debugData?.diagnostics?.vieneu_error && (
                            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-900 text-xs space-y-1">
                                <div className="font-bold flex items-center gap-1.5 text-red-800">
                                    <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                                    <span>Chi tiết lỗi khi nạp VieNeu SDK từ Python:</span>
                                </div>
                                <pre className="p-2 bg-slate-900 text-red-300 font-mono text-[11px] rounded overflow-x-auto whitespace-pre-wrap">
                  {debugData.diagnostics.vieneu_error}
                </pre>
                            </div>
                        )}
                    </div>

                    {/* 3. TEST TRỰC TIẾP VIENEU LOCAL TTS (1-CLICK TEST) */}
                    <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-white">
                        <div className="font-bold text-slate-900 flex items-center gap-2">
                            <Volume2 className="w-4 h-4 text-emerald-600" />
                            <span>2. Test phát trực tiếp âm thanh từ VieNeu Local SDK</span>
                        </div>
                        <p className="text-xs text-slate-600">
                            Gửi một câu ngắn trực tiếp tới hàm <code>tts.infer()</code> trên Python máy bạn để xác nhận chất lượng giọng tiếng Việt:
                        </p>

                        <div className="flex flex-col sm:flex-row gap-2">
                            <input
                                type="text"
                                value={testText}
                                onChange={e => setTestText(e.target.value)}
                                className="flex-1 bg-slate-50 border border-slate-300 px-3 py-1.5 rounded-lg text-xs outline-none focus:border-blue-500 font-medium"
                                placeholder="Nhập câu tiếng Việt muốn thử nghiệm..."
                            />
                            <select
                                value={testVoice}
                                onChange={e => setTestVoice(e.target.value)}
                                className="bg-slate-50 border border-slate-300 px-3 py-1.5 rounded-lg text-xs outline-none focus:border-blue-500 font-semibold"
                            >
                                <option value="Minh Quân">Minh Quân (Nam)</option>
                                <option value="Đức Trí">Đức Trí (Nam)</option>
                                <option value="Thùy Dung">Thùy Dung (Nữ)</option>
                                <option value="Khánh Linh">Khánh Linh (Nữ)</option>
                                <option value="Bảo Ngọc">Bảo Ngọc (Nữ)</option>
                            </select>
                            <button
                                onClick={handleTestTTS}
                                disabled={testingTTS}
                                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                            >
                                <Play className="w-3 h-3 fill-current" />
                                <span>{testingTTS ? 'Đang sinh...' : 'Bấm để sinh thử'}</span>
                            </button>
                        </div>

                        {testResult && (
                            <div
                                className={`p-3 rounded-lg border text-xs space-y-2 ${
                                    testResult.success
                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                                        : 'bg-red-50 border-red-200 text-red-950'
                                }`}
                            >
                                <div className="flex items-center justify-between font-bold">
                  <span className="flex items-center gap-1.5">
                    {testResult.success ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : (
                        <XCircle className="w-4 h-4 text-red-600" />
                    )}
                      <span>{testResult.message || (testResult.success ? 'Thành công' : 'Lỗi')}</span>
                  </span>
                                    {testResult.duration_ms && (
                                        <span className="text-[11px] font-normal text-slate-600">
                      Thời gian: {testResult.duration_ms}ms &bull; Dung lượng: {testResult.file_size} bytes
                    </span>
                                    )}
                                </div>

                                {(testResult.audio_base64 || testResult.audio_url) && (
                                    <div className="pt-1">
                                        <audio
                                            src={
                                                testResult.audio_base64 ||
                                                `${localServerUrl}${encodeURI(testResult.audio_url || '')}?t=${Date.now()}`
                                            }
                                            controls
                                            autoPlay
                                            className="w-full h-8"
                                        />
                                    </div>
                                )}

                                {testResult.error && (
                                    <pre className="p-2 bg-slate-900 text-red-300 font-mono text-[11px] rounded overflow-x-auto whitespace-pre-wrap">
                    {testResult.error}
                  </pre>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Modal Footer */}
                <div className="p-4 bg-slate-100 border-t border-slate-200 flex items-center justify-between">
                    <div className="text-xs text-slate-500">
                        Xem tài liệu VieNeu chính thức tại:{' '}
                        <a
                            href="https://docs.vieneu.io/"
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:underline font-semibold"
                        >
                            https://docs.vieneu.io/
                        </a>
                    </div>
                    <button
                        onClick={onClose}
                        className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                    >
                        Đóng
                    </button>
                </div>
            </div>
        </div>
    );
}
