import React, { useState, useEffect, useRef } from 'react';
import {
  TURBO_VOICES,
  NANO_VOICES,
  ALL_VOICES,
} from './data/voices';
import { voicePreviewEngine } from './utils/audioPreviewEngine';
import { DiagnosticsModal } from './components/DiagnosticsModal';
import {
  Play,
  FolderOpen,
  Volume2,
  Clipboard,
  Check,
  Eye,
  EyeOff,
  RotateCcw,
  Download,
  X,
  FileVideo,
  Upload,
  Globe,
  HardDrive,
  Cpu,
  Terminal,
  Server,
  HelpCircle,
  ExternalLink,
  Activity,
  ArrowDown,
} from 'lucide-react';

export default function App() {
  // Engine Mode: 'local' (FFmpeg + VieNeu on user's machine) or 'cloud' (Web Cloud Simulation)
  const [engineMode, setEngineMode] = useState<'local' | 'cloud'>('local');
  const [localServerUrl, setLocalServerUrl] = useState('http://localhost:8000');
  const [isLocalConnected, setIsLocalConnected] = useState<boolean | null>(null);
  const [localDeps, setLocalDeps] = useState<{ ffmpeg?: boolean; vieneu?: boolean; whisper?: boolean } | null>(null);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false);

  // Source selection: YouTube URL or Local File
  const [sourceType, setSourceType] = useState<'youtube' | 'local'>('youtube');
  const [url, setUrl] = useState('');
  const [localFilePath, setLocalFilePath] = useState('');
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [localFileUrl, setLocalFileUrl] = useState<string | null>(null);

  // Settings matching user script and gui.py
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [translationModel, setTranslationModel] = useState('gemini-3.8-flash');
  const [whisperModel, setWhisperModel] = useState<'tiny' | 'base' | 'small' | 'medium' | 'large-v3'>('small');
  const [quality, setQuality] = useState('720');
  const [ttsMode, setTtsMode] = useState<'turbo' | 'v3nano'>('turbo');
  const [ttsVoice, setTtsVoice] = useState('Đức Trí');
  const [previewText, setPreviewText] = useState('Xin chào, đây là giọng đọc thử của VieNeu.');
  const [origVol, setOrigVol] = useState(20);
  const [burnSubtitles, setBurnSubtitles] = useState(true);
  const [subtitleBox, setSubtitleBox] = useState(true);
  const [subtitleBoxOpacity, setSubtitleBoxOpacity] = useState(60);

  // Status & Progress
  const [statusText, setStatusText] = useState('Sẵn sàng.');
  const [progress, setProgress] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [resultReady, setResultReady] = useState(false);
  const [resultVideoUrl, setResultVideoUrl] = useState<string>('');
  const [showResultModal, setShowResultModal] = useState(false);
  const [copied, setCopied] = useState(false);

  // File input ref
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Monospace Logs
  const [logs, setLogs] = useState<string[]>([
    '[+] Hệ thống đã sẵn sàng.',
    '[+] Bàn điều khiển Web GUI cho FFmpeg & VieNeu Local Engine.',
  ]);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const [autoScrollLogs, setAutoScrollLogs] = useState(true);

  // Active voices list for selected mode
  const currentVoiceList = ttsMode === 'v3nano' ? NANO_VOICES : TURBO_VOICES;

  // Auto-scroll logs ONLY inside the log container (avoids hijacking or locking main window scroll)
  useEffect(() => {
    if (autoScrollLogs && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScrollLogs]);

  // Pause auto-scroll if user scrolls up to read earlier logs; resume if at bottom
  const handleLogScroll = () => {
    if (!logContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight <= 35;
    setAutoScrollLogs(isAtBottom);
  };

  const scrollToBottomLogs = () => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
    setAutoScrollLogs(true);
  };

  // Check Local Engine Health
  const checkLocalEngine = async () => {
    try {
      const res = await fetch(`${localServerUrl}/health`, { method: 'GET' });
      if (res.ok) {
        const data = await res.json();
        setIsLocalConnected(true);
        if (data.dependencies) {
          setLocalDeps(data.dependencies);
        }
        appendLog(`[+] Đã kết nối với Python Local Engine tại ${localServerUrl}. FFmpeg: ${data.dependencies?.ffmpeg ? 'Sẵn sàng' : 'Chưa cài'}.`);
        return true;
      }
    } catch {
      setIsLocalConnected(false);
    }
    return false;
  };

  // Initial health check
  useEffect(() => {
    checkLocalEngine();
  }, [localServerUrl]);

  // When mode changes, update voice if current voice is not in list
  const handleModeChange = (newMode: 'turbo' | 'v3nano') => {
    setTtsMode(newMode);
    const voices = newMode === 'v3nano' ? NANO_VOICES : TURBO_VOICES;
    if (!voices.some(v => v.name === ttsVoice)) {
      setTtsVoice(voices[0].name);
    }
  };

  const appendLog = (line: string) => {
    setLogs(prev => [...prev, line]);
  };

  // Paste from clipboard
  const handlePasteUrl = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text.trim());
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      // Fallback
    }
  };

  // Handle local file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLocalFile(file);
      setLocalFilePath(file.name);
      const objUrl = URL.createObjectURL(file);
      setLocalFileUrl(objUrl);
      appendLog(`[+] Đã nạp file video cục bộ: ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`);
    }
  };

  // Preview Voice
  const handlePreviewVoice = async () => {
    if (isRunning) {
      alert('Hãy chờ tiến trình dịch & lồng tiếng hoàn tất rồi nghe thử giọng.');
      return;
    }
    if (isPreviewing) return;

    const voiceObj =
        ALL_VOICES.find(v => v.name === ttsVoice && v.mode === ttsMode) ||
        ALL_VOICES.find(v => v.name === ttsVoice) ||
        ALL_VOICES[0];

    setIsPreviewing(true);
    setStatusText(`Đang tạo giọng thử: ${voiceObj.name} (${ttsMode})...`);
    appendLog(`[+] Nghe thử VieNeu: mode=${ttsMode}, voice=${voiceObj.name}`);
    appendLog(`    Nội dung: "${previewText}"`);

    // Nếu chưa kết nối Local Engine, không phát giọng Windows
    if (!isLocalConnected) {
      setIsPreviewing(false);
      appendLog(`[!] Không thể nghe thử: Local Engine (cổng 8000) chưa kết nối.`);
      appendLog(`    👉 Đã xóa bỏ hoàn toàn giọng đọc dự phòng của Windows (Microsoft David/Zira).`);
      appendLog(`    👉 Vui lòng chạy "python start.py" để nghe thử trực tiếp âm thanh VieNeu AI thật.`);
      setStatusText(`Cần chạy python start.py để nghe giọng VieNeu AI thật.`);
      alert('Local Engine chưa được kết nối! Đã vô hiệu hóa toàn bộ giọng đọc mặc định của Windows. Vui lòng mở Terminal và chạy: python start.py');
      return;
    }

    try {
      const res = await fetch(`${localServerUrl}/preview-voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voice: voiceObj.name,
          text: previewText,
          mode: ttsMode,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.is_real_vieneu === false) {
          setIsPreviewing(false);
          appendLog(`[!] Cảnh báo: VieNeu Local chưa nạp được mô hình (${data.message || data.error || 'chưa cài vieneu'}).`);
          appendLog(`    👉 Bấm nút "Debug Trạng Thái" ở góc phải trên để kiểm tra.`);
          setStatusText(`VieNeu Local chưa sẵn sàng: ${data.message || 'Lỗi nạp model'}`);
          alert(`VieNeu chưa sẵn sàng: ${data.message || 'Vui lòng kiểm tra lại thư viện vieneu trên máy tính.'}`);
          return;
        }

        appendLog(`[VieNeu SDK] ✅ Đã nhận audio tiếng Việt chuẩn: ${voiceObj.name} (${data.duration_ms}ms, ${data.file_size} bytes)`);

        const audioSrc =
            data.audio_base64 ||
            (data.audio_url
                ? `${localServerUrl}${encodeURI(data.audio_url)}?t=${Date.now()}`
                : null);

        if (audioSrc) {
          await voicePreviewEngine.playRealAudio(
              voiceObj.id,
              audioSrc,
              isPlaying => {
                setIsPreviewing(isPlaying);
                if (!isPlaying) {
                  setStatusText(`Đã phát xong giọng: ${voiceObj.name}`);
                }
              }
          );
        }
      } else {
        setIsPreviewing(false);
        appendLog(`[!] Máy chủ Local phản hồi mã lỗi HTTP ${res.status}.`);
        setStatusText(`Lỗi kết nối Local Engine (${res.status})`);
      }
    } catch (e) {
      setIsPreviewing(false);
      console.warn('Lỗi khi gọi VieNeu preview local:', e);
      appendLog(`[!] Lỗi khi kết nối VieNeu: ${e instanceof Error ? e.message : 'Timeout'}.`);
      setStatusText(`Lỗi kết nối Local Engine.`);
    }
  };

  // Start Pipeline (Directly controls Local Engine when connected, or falls back to Cloud)
  const handleStart = async () => {
    if (isRunning) return;

    if (sourceType === 'youtube' && !url.trim()) {
      alert('Hãy nhập hoặc dán link YouTube hợp lệ.');
      return;
    }
    if (sourceType === 'local' && !localFilePath.trim()) {
      alert('Hãy chọn file video local hoặc nhập đường dẫn file video cục bộ.');
      return;
    }

    if (!apiKey.trim()) {
      alert('Hãy nhập Gemini API key để thực hiện bước dịch sang tiếng Việt.');
      return;
    }

    if (!isLocalConnected) {
      appendLog(`[!] KHÔNG CÓ KẾT NỐI LOCAL ENGINE (Cổng 8000).`);
      appendLog(`[!] Toàn bộ chế độ demo mô phỏng (text giả, video mẫu, giọng Windows) đã bị xóa bỏ hoàn toàn.`);
      appendLog(`👉 Để xử lý video thật của bạn, hãy mở Terminal/CMD trong thư mục dự án và chạy:`);
      appendLog(`   python start.py   (hoặc: python local_backend.py)`);
      appendLog(`   Sau đó bấm lại nút "Bắt đầu lồng tiếng".`);
      setStatusText('Chưa kết nối Local Engine. Hãy chạy python start.py trên máy tính.');
      alert('Local Engine chưa được kết nối! Đã xóa bỏ hoàn toàn chế độ chạy thử nghiệm/demo. Vui lòng mở Terminal và chạy: python start.py để xử lý video thật của bạn.');
      return;
    }

    setIsRunning(true);
    setResultReady(false);
    setProgress(5);
    setLogs([]);
    setStatusText('Đang gửi lệnh tới VieNeu Local Engine...');
    appendLog(`[+] Gửi lệnh thực thi tới Python Local Engine (${localServerUrl})...`);
    appendLog(`[+] Các công nghệ cục bộ kích hoạt: FFmpeg, VieNeu (${ttsVoice}), Whisper (${whisperModel})`);

    try {
      const payload = {
        source_type: sourceType,
        url: url,
        local_file_path: localFilePath,
        tts_voice: ttsVoice,
        tts_mode: ttsMode,
        whisper_model: whisperModel,
        original_volume: origVol,
        burn_subtitles: burnSubtitles,
        subtitle_box: subtitleBox,
        subtitle_box_opacity: subtitleBoxOpacity,
        translation_model: translationModel,
        api_key: apiKey,
      };

      const res = await fetch(`${localServerUrl}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`Máy chủ Local phản hồi mã lỗi HTTP ${res.status}`);
      }

      const startData = await res.json();
      appendLog(`[+] ${startData.message || 'Tiến trình đã được kích hoạt thành công trên máy tính.'}`);

      // Bắt đầu đọc log và tiến độ thực tế từ Python Engine
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`${localServerUrl}/status`);
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            if (statusData.progress !== undefined) setProgress(statusData.progress);
            if (statusData.status) setStatusText(statusData.status);
            if (statusData.logs && statusData.logs.length > 0) {
              setLogs(statusData.logs);
            }
            if (!statusData.is_running && statusData.progress >= 100) {
              clearInterval(pollInterval);
              setIsRunning(false);
              setResultReady(true);
              if (statusData.output_video) {
                setResultVideoUrl(`${localServerUrl}/output/${statusData.output_video}`);
              } else if (localFileUrl) {
                setResultVideoUrl(localFileUrl);
              }
              setShowResultModal(true);
            } else if (statusData.error) {
              clearInterval(pollInterval);
              setIsRunning(false);
              alert(`Lỗi từ Local Engine: ${statusData.error}`);
            }
          }
        } catch (pollErr) {
          console.error('Lỗi khi đọc log local:', pollErr);
        }
      }, 1000);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Lỗi kết nối';
      appendLog(`[!] Không kết nối được Local Engine: ${errMsg}.`);
      setIsRunning(false);
      setStatusText(`Lỗi kết nối Local: ${errMsg}`);
      alert(`Lỗi kết nối Local Engine: ${errMsg}`);
    }
  };

  return (
      <div className="min-h-screen w-full bg-[#f1f3f6] text-slate-800 flex flex-col font-sans">
        {/* Top Application Bar */}
        <header className="w-full bg-white border-b border-slate-200 px-4 sm:px-8 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm flex-shrink-0">
              <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
              >
                <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
                <line x1="16" y1="8" x2="2" y2="22" />
                <line x1="17.5" y1="15" x2="9" y2="15" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 leading-tight flex items-center gap-2">
                <span>Dịch &amp; lồng tiếng video YouTube sang tiếng Việt</span>
                <span className="text-[11px] font-normal px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                Bàn điều khiển Web GUI
              </span>
              </h1>
              <p className="text-xs text-slate-500">
                Điều khiển trực tiếp FFmpeg &bull; VieNeu Neural TTS Local &bull; Faster-Whisper
              </p>
            </div>
          </div>

          {/* Engine Connection Status Badge & Diagnostics Button */}
          <div className="flex items-center gap-2 text-xs">
            <button
                onClick={() => setShowDiagnosticsModal(true)}
                className="px-3 py-1.5 rounded-lg font-medium border border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-700 flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                title="Kiểm tra chi tiết kết nối, VieNeu SDK và thử nghiệm giọng tiếng Việt"
            >
              <Activity className="w-3.5 h-3.5 text-blue-600" />
              <span>Debug Trạng Thái</span>
            </button>

            <button
                onClick={() => setShowSetupModal(true)}
                className={`px-3 py-1.5 rounded-lg font-medium border flex items-center gap-1.5 transition-all cursor-pointer ${
                    isLocalConnected
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                        : 'bg-amber-50 text-amber-800 border-amber-300'
                }`}
            >
              <Server className="w-3.5 h-3.5" />
              <span>
              {isLocalConnected
                  ? 'Đã kết nối Local Engine'
                  : 'Chưa kết nối Local Engine (Xem cách chạy)'}
            </span>
              <span
                  className={`w-2 h-2 rounded-full ${
                      isLocalConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                  }`}
              />
            </button>
          </div>
        </header>

        {/* Main Full-width Screen Body */}
        <main className="w-full flex-1 max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 flex flex-col gap-4">
          {/* Engine Mode Banner */}
          <div className="bg-white border border-slate-200/90 rounded-xl p-3 px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
              Chế độ thực thi:
            </span>
              <div className="inline-flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
                <button
                    onClick={() => setEngineMode('local')}
                    className={`px-3 py-1 rounded-md font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                        engineMode === 'local'
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                    }`}
                >
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>Python Local Engine (FFmpeg + VieNeu trên máy bạn)</span>
                </button>
                <button
                    onClick={() => setEngineMode('cloud')}
                    className={`px-3 py-1 rounded-md font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                        engineMode === 'cloud'
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                    }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Web Cloud (Trực tuyến)</span>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {engineMode === 'local' && (
                  <button
                      onClick={checkLocalEngine}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Kiểm tra kết nối ({localServerUrl})</span>
                  </button>
              )}
              <button
                  onClick={() => setShowSetupModal(true)}
                  className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Hướng dẫn</span>
              </button>
            </div>
          </div>

          {/* Top Control Card */}
          <div className="w-full bg-white border border-slate-200/90 rounded-xl p-5 sm:p-6 shadow-sm space-y-5">
            {/* Nguồn Video: Toggle giữa Link YouTube và File Local */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-800">Nguồn video đầu vào:</span>
                  <div className="inline-flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
                    <button
                        onClick={() => setSourceType('youtube')}
                        className={`px-3 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                            sourceType === 'youtube'
                                ? 'bg-white text-blue-700 shadow-xs'
                                : 'text-slate-600 hover:text-slate-900'
                        }`}
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span>Link YouTube</span>
                    </button>
                    <button
                        onClick={() => setSourceType('local')}
                        className={`px-3 py-1 rounded-md font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                            sourceType === 'local'
                                ? 'bg-white text-blue-700 shadow-xs'
                                : 'text-slate-600 hover:text-slate-900'
                        }`}
                    >
                      <HardDrive className="w-3.5 h-3.5" />
                      <span>File Video Local</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Input theo nguồn đã chọn */}
              {sourceType === 'youtube' ? (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                    <label
                        htmlFor="url-input"
                        className="text-sm font-semibold text-slate-700 sm:w-28 flex-shrink-0"
                    >
                      Link YouTube:
                    </label>
                    <div className="flex-1 flex gap-2">
                      <input
                          id="url-input"
                          type="text"
                          value={url}
                          onChange={e => setUrl(e.target.value)}
                          placeholder="https://www.youtube.com/watch?v=... hoặc shorts/..."
                          className="flex-1 bg-slate-50 hover:bg-white focus:bg-white border border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none px-3.5 py-2 text-sm text-slate-900 rounded-lg transition-all"
                      />
                      <button
                          onClick={handlePasteUrl}
                          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 border border-slate-300 text-slate-800 text-sm font-medium rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                          title="Dán link từ clipboard"
                      >
                        {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Clipboard className="w-4 h-4" />}
                        <span>{copied ? 'Đã dán' : 'Dán'}</span>
                      </button>
                    </div>
                  </div>
              ) : (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                    <label className="text-sm font-semibold text-slate-700 sm:w-28 flex-shrink-0">
                      File Video Local:
                    </label>
                    <div className="flex-1 flex gap-2">
                      <input
                          type="text"
                          value={localFilePath}
                          onChange={e => setLocalFilePath(e.target.value)}
                          placeholder="Nhập đường dẫn file (vd: C:\video.mp4) hoặc bấm Chọn file..."
                          className="flex-1 bg-slate-50 hover:bg-white focus:bg-white border border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none px-3.5 py-2 text-sm text-slate-900 rounded-lg transition-all"
                      />
                      <input
                          ref={fileInputRef}
                          type="file"
                          accept="video/*"
                          onChange={handleFileChange}
                          className="hidden"
                      />
                      <button
                          onClick={() => fileInputRef.current?.click()}
                          className="px-4 py-2 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-300 text-blue-800 text-sm font-semibold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Upload className="w-4 h-4" />
                        <span>Chọn file...</span>
                      </button>
                    </div>
                  </div>
              )}
            </div>

            {/* Group Box: Cài đặt (Settings) */}
            <fieldset className="border border-slate-300/80 rounded-xl p-4 sm:p-5 bg-slate-50/50 space-y-4">
              <legend className="px-2 text-sm font-bold text-slate-800 bg-white border border-slate-200 rounded-md shadow-2xs">
                Cài đặt
              </legend>

              {/* Row 1: Gemini API key & Model AI Dịch */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-slate-700 w-36 flex-shrink-0">
                    Gemini API key:
                  </label>
                  <div className="flex-1 relative">
                    <input
                        type={showApiKey ? 'text' : 'password'}
                        value={apiKey}
                        onChange={e => setApiKey(e.target.value)}
                        placeholder="Nhập API key Gemini..."
                        className="w-full bg-white border border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none px-3 py-1.5 pr-8 text-sm text-slate-900 rounded-lg font-mono transition-all"
                    />
                    <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer p-1"
                    >
                      {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Option chọn Model AI để dịch */}
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-slate-700 w-36 flex-shrink-0 flex items-center gap-1.5">
                    <Cpu className="w-4 h-4 text-blue-600" />
                    <span>Model AI dịch:</span>
                  </label>
                  <select
                      value={translationModel}
                      onChange={e => setTranslationModel(e.target.value)}
                      className="flex-1 bg-white border border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none px-3 py-1.5 text-sm text-slate-900 rounded-lg cursor-pointer font-semibold"
                  >
                    <option value="gemini-3.8-flash">gemini-3.8-flash (Mới nhất, dịch tự nhiên - Mặc định)</option>
                    <option value="gemini-3.7-flash">gemini-3.7-flash</option>
                    <option value="gemini-3.6-flash">gemini-3.6-flash</option>
                    <option value="gemini-3.5-flash">gemini-3.5-flash</option>
                    <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite</option>
                    <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
                  </select>
                </div>
              </div>

              {/* Row 2: Model nhận dạng & Chất lượng tải */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-slate-700 w-36 flex-shrink-0">
                    Model nhận dạng:
                  </label>
                  <select
                      value={whisperModel}
                      onChange={e => setWhisperModel(e.target.value as typeof whisperModel)}
                      className="flex-1 bg-white border border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none px-3 py-1.5 text-sm text-slate-900 rounded-lg cursor-pointer"
                  >
                    <option value="tiny">tiny (Siêu nhanh)</option>
                    <option value="base">base (Nhanh vừa)</option>
                    <option value="small">small (Chuẩn khuyên dùng)</option>
                    <option value="medium">medium (Chính xác cao)</option>
                    <option value="large-v3">large-v3 (Chính xác tối đa)</option>
                  </select>
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-slate-700 w-36 flex-shrink-0">
                    Chất lượng tải (px):
                  </label>
                  <select
                      value={quality}
                      disabled={sourceType === 'local'}
                      onChange={e => setQuality(e.target.value)}
                      className="flex-1 bg-white border border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none px-3 py-1.5 text-sm text-slate-900 rounded-lg cursor-pointer disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <option value="480">480p</option>
                    <option value="720">720p (Khuyên dùng)</option>
                    <option value="1080">1080p (Full HD)</option>
                  </select>
                </div>
              </div>

              {/* Row 3: Chế độ giọng & Giọng đọc + Nghe thử */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-slate-700 w-36 flex-shrink-0">
                    Chế độ giọng:
                  </label>
                  <select
                      value={ttsMode}
                      onChange={e => handleModeChange(e.target.value as 'turbo' | 'v3nano')}
                      className="flex-1 bg-white border border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none px-3 py-1.5 text-sm text-slate-900 rounded-lg cursor-pointer font-medium"
                  >
                    <option value="turbo">turbo (48kHz, chất lượng cao nhất)</option>
                    <option value="v3nano">v3nano (24kHz, tốc độ nhanh x3)</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-slate-700 w-24 flex-shrink-0">
                    Giọng đọc:
                  </label>
                  <div className="flex-1 flex items-center gap-2">
                    <select
                        value={ttsVoice}
                        onChange={e => setTtsVoice(e.target.value)}
                        className="flex-1 bg-white border border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none px-3 py-1.5 text-sm text-slate-900 rounded-lg cursor-pointer font-semibold"
                    >
                      {currentVoiceList.map(v => (
                          <option key={v.id} value={v.name}>
                            {v.name} ({v.gender} &bull; {v.region})
                          </option>
                      ))}
                    </select>
                    <button
                        onClick={handlePreviewVoice}
                        disabled={isPreviewing}
                        className="whitespace-nowrap px-3 py-1.5 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 border border-blue-300 text-blue-800 text-xs font-semibold rounded-lg shadow-2xs cursor-pointer flex items-center gap-1.5 transition-colors"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>{isPreviewing ? 'Đang tạo...' : 'Nghe thử'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Row 4: Câu nghe thử */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <label className="text-sm font-medium text-slate-700 sm:w-36 flex-shrink-0">
                  Câu nghe thử:
                </label>
                <input
                    type="text"
                    value={previewText}
                    onChange={e => setPreviewText(e.target.value)}
                    className="flex-1 bg-white border border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none px-3.5 py-1.5 text-sm text-slate-900 rounded-lg transition-all"
                />
              </div>

              {/* Row 5: Âm lượng tiếng gốc */}
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm font-medium text-slate-700 sm:w-36 flex-shrink-0">
                  Âm lượng tiếng gốc (%):
                </label>
                <div className="flex items-center gap-3">
                  <input
                      type="number"
                      min={0}
                      max={100}
                      step={5}
                      value={origVol}
                      onChange={e =>
                          setOrigVol(Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)))
                      }
                      className="w-20 bg-white border border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none px-3 py-1.5 text-sm text-slate-900 rounded-lg font-semibold"
                  />
                  <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={origVol}
                      onChange={e => setOrigVol(parseInt(e.target.value, 10))}
                      className="w-32 accent-blue-600 cursor-pointer"
                  />
                  <span className="text-xs text-slate-500">
                  (0 = tắt hẳn tiếng gốc, 100 = giữ nguyên)
                </span>
                </div>
              </div>

              {/* Row 6 & 7: Checkboxes for Burn Subtitles & Background Box */}
              <div className="pt-2 border-t border-slate-200/80 space-y-2.5">
                <div className="flex items-center gap-2">
                  <input
                      id="burn-sub-check"
                      type="checkbox"
                      checked={burnSubtitles}
                      onChange={e => setBurnSubtitles(e.target.checked)}
                      className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                  <label
                      htmlFor="burn-sub-check"
                      className="cursor-pointer text-sm font-medium text-slate-800"
                  >
                    Đốt cứng phụ đề vào hình video (FFmpeg burn subtitles)
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 pl-6">
                  <div className="flex items-center gap-2">
                    <input
                        id="sub-box-check"
                        type="checkbox"
                        checked={subtitleBox}
                        disabled={!burnSubtitles}
                        onChange={e => setSubtitleBox(e.target.checked)}
                        className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer disabled:opacity-40"
                    />
                    <label
                        htmlFor="sub-box-check"
                        className={`cursor-pointer text-sm font-medium ${
                            !burnSubtitles ? 'text-slate-400' : 'text-slate-800'
                        }`}
                    >
                      Nền tối sau phụ đề (dễ đọc hơn)
                    </label>
                  </div>

                  <div className="flex items-center gap-2">
                    <label
                        className={`text-sm font-medium whitespace-nowrap ${
                            !burnSubtitles || !subtitleBox ? 'text-slate-400' : 'text-slate-700'
                        }`}
                    >
                      Độ đậm nền (%):
                    </label>
                    <input
                        type="number"
                        min={0}
                        max={100}
                        step={10}
                        disabled={!burnSubtitles || !subtitleBox}
                        value={subtitleBoxOpacity}
                        onChange={e =>
                            setSubtitleBoxOpacity(
                                Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0))
                            )
                        }
                        className="w-20 bg-white border border-slate-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none px-3 py-1.5 text-sm rounded-lg disabled:bg-slate-100 disabled:text-slate-400 font-semibold"
                    />
                  </div>
                </div>
              </div>
            </fieldset>

            {/* Action Buttons Row */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                  onClick={handleStart}
                  disabled={isRunning}
                  className={`px-6 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 shadow-sm transition-all cursor-pointer ${
                      isRunning
                          ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                          : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-blue-500/20'
                  }`}
              >
                <Play className="w-4 h-4 fill-current" />
                <span>{isRunning ? 'Đang tiến hành...' : 'Bắt đầu'}</span>
              </button>

              <button
                  onClick={() => setShowResultModal(true)}
                  disabled={!resultReady}
                  className={`px-5 py-2.5 rounded-lg text-sm font-semibold border flex items-center gap-2 transition-all ${
                      resultReady
                          ? 'bg-emerald-50 hover:bg-emerald-100 border-emerald-300 text-emerald-800 cursor-pointer shadow-xs'
                          : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed opacity-60'
                  }`}
              >
                <FolderOpen className="w-4 h-4" />
                <span>Mở thư mục kết quả</span>
              </button>
            </div>

            {/* Progress Bar & Status Text */}
            <div className="space-y-2 pt-1">
              <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden p-0.5">
                <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-200 ease-out"
                    style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-slate-600 font-medium">
              <span className="flex items-center gap-1.5">
                <span
                    className={`w-2 h-2 rounded-full ${
                        isRunning
                            ? 'bg-blue-500 animate-pulse'
                            : resultReady
                                ? 'bg-emerald-500'
                                : 'bg-slate-400'
                    }`}
                />
                {statusText}
              </span>
                <span className="font-mono text-slate-500">{progress}%</span>
              </div>
            </div>
          </div>

          {/* Group Box: Nhật ký (Logs Box) */}
          <div className="w-full flex-1 border border-slate-200/90 rounded-xl p-4 sm:p-5 bg-white shadow-sm flex flex-col min-h-[300px]">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 text-xs font-bold text-slate-800 bg-slate-100 border border-slate-200 rounded-md">
                Nhật ký tiến trình ({logs.length})
              </span>
                <button
                    type="button"
                    onClick={() => {
                      if (!autoScrollLogs) {
                        scrollToBottomLogs();
                      } else {
                        setAutoScrollLogs(false);
                      }
                    }}
                    className={`text-[11px] px-2 py-0.5 rounded border transition-all cursor-pointer flex items-center gap-1.5 ${
                        autoScrollLogs
                            ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                            : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                    }`}
                    title={autoScrollLogs ? 'Bấm để tạm dừng tự động cuộn' : 'Bấm để bật lại tự động cuộn'}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${autoScrollLogs ? 'bg-blue-500' : 'bg-amber-500'}`} />
                  <span>{autoScrollLogs ? 'Tự động cuộn: Bật' : 'Tự động cuộn: Tạm dừng'}</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                {!autoScrollLogs && (
                    <button
                        type="button"
                        onClick={scrollToBottomLogs}
                        className="text-xs text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded border border-blue-200 flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                        title="Cuộn xuống cuối nhật ký"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                      <span>Cuộn xuống cuối</span>
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => setLogs(['[+] Đã làm mới nhật ký.'])}
                    className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer transition-colors px-2 py-1 rounded hover:bg-slate-100"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Xóa nhật ký</span>
                </button>
              </div>
            </div>

            <div
                ref={logContainerRef}
                onScroll={handleLogScroll}
                className="flex-1 bg-slate-950 text-emerald-400 font-mono text-xs sm:text-[13px] p-3.5 rounded-lg overflow-y-auto max-h-[360px] select-text space-y-1 border border-slate-800 shadow-inner overscroll-contain"
            >
              {logs.map((line, idx) => (
                  <div key={idx} className="whitespace-pre-wrap leading-relaxed">
                    {line}
                  </div>
              ))}
            </div>
          </div>
        </main>

        {/* Setup / Instructions Modal for Python Local Engine */}
        {showSetupModal && (
            <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white border border-slate-300 shadow-2xl w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col">
                <div className="bg-slate-50 border-b border-slate-200 px-5 py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Server className="w-5 h-5 text-blue-600" />
                    <span className="text-sm font-bold text-slate-900">
                  Cài Đặt &amp; Kết Nối Python Local Engine (FFmpeg &bull; VieNeu Local)
                </span>
                  </div>
                  <button
                      onClick={() => setShowSetupModal(false)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-5 space-y-4 text-xs sm:text-sm text-slate-700 max-h-[70vh] overflow-y-auto">
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 text-blue-900 space-y-1">
                    <div className="font-bold flex items-center gap-1.5 text-sm">
                      <span>⚡ HỢP NHẤT: Chạy cả Web (Port 3000) và Python (Port 8000) cùng lúc</span>
                    </div>
                    <p className="text-xs text-blue-800">
                      Bạn có thể khởi động cả 2 cổng 3000 và 8000 chỉ bằng <strong>1 lệnh duy nhất</strong>, trình duyệt sẽ tự động bật lên!
                    </p>
                  </div>

                  {/* Cách 1: Chạy python start.py */}
                  <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2.5">
                    <div className="font-bold text-slate-900 flex items-center justify-between">
                      <span>Cách 1: Chạy file hợp nhất start.py (1 lệnh duy nhất)</span>
                      <a
                          href="/api/download-start-py"
                          download="start.py"
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold rounded shadow-2xs cursor-pointer"
                      >
                        <Download className="w-3 h-3" />
                        <span>Tải start.py</span>
                      </a>
                    </div>
                    <p className="text-xs text-slate-600">
                      Mở CMD tại thư mục và gõ lệnh sau, cả 2 cổng 8000 &amp; 3000 sẽ cùng mở:
                    </p>
                    <pre className="bg-slate-900 text-emerald-400 p-2.5 rounded-lg font-mono text-xs overflow-x-auto">
                  python start.py
                </pre>
                  </div>

                  {/* Cách 2: 1-Click trên Windows run.bat */}
                  <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2.5">
                    <div className="font-bold text-slate-900 flex items-center justify-between">
                      <span>Cách 2: Nhấp đúp chuột file run.bat (Dành cho Windows)</span>
                      <a
                          href="/api/download-run-bat"
                          download="run.bat"
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold rounded shadow-2xs cursor-pointer"
                      >
                        <Download className="w-3 h-3" />
                        <span>Tải run.bat</span>
                      </a>
                    </div>
                    <p className="text-xs text-slate-600">
                      Tải file <code>run.bat</code> về thư mục dự án và nhấp đúp chuột, hệ thống sẽ tự động bật 2 cửa sổ cmd cho cổng 8000 và 3000 và tự mở trình duyệt.
                    </p>
                  </div>

                  {/* Tải local_backend.py */}
                  <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 space-y-2">
                    <div className="font-bold text-slate-900 flex items-center justify-between">
                      <span>Tải riêng file local_backend.py</span>
                      <a
                          href="/api/download-local-backend"
                          download="local_backend.py"
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-700 hover:bg-slate-800 text-white text-[11px] font-semibold rounded cursor-pointer"
                      >
                        <Download className="w-3 h-3" />
                        <span>Tải local_backend.py</span>
                      </a>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      * Yêu cầu máy đã cài <code>ffmpeg</code> và các gói: <code>pip install vieneu faster-whisper google-generativeai yt-dlp</code>
                    </p>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                  <button
                      onClick={() => {
                        checkLocalEngine();
                        setShowSetupModal(false);
                      }}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                  >
                    Đã chạy, kiểm tra kết nối ngay
                  </button>
                  <button
                      onClick={() => setShowSetupModal(false)}
                      className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                  >
                    Đóng
                  </button>
                </div>
              </div>
            </div>
        )}

        {/* Result Player Modal */}
        {showResultModal && (
            <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white border border-slate-300 shadow-2xl w-full max-w-3xl rounded-2xl overflow-hidden flex flex-col">
                {/* Modal Header */}
                <div className="bg-slate-50 border-b border-slate-200 px-5 py-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileVideo className="w-5 h-5 text-blue-600" />
                    <span className="text-sm font-bold text-slate-900">
                  Video đã lồng tiếng hoàn tất: video_long_tieng_goc{origVol}.mp4
                </span>
                  </div>
                  <button
                      onClick={() => setShowResultModal(false)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-slate-200 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Video Player */}
                <div className="bg-black relative flex items-center justify-center aspect-video max-h-[460px]">
                  <video
                      src={resultVideoUrl}
                      controls
                      autoPlay
                      className="w-full h-full object-contain"
                  />
                </div>

                {/* Modal Footer with Actions */}
                <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                  <div className="text-slate-600 space-y-0.5">
                    <p>
                      Động cơ:{' '}
                      <strong>
                        {engineMode === 'local' && isLocalConnected
                            ? 'Python Local (FFmpeg + VieNeu)'
                            : 'Web Engine'}
                      </strong>{' '}
                      &bull; Model dịch: <strong>{translationModel}</strong>
                    </p>
                    <p>
                      Giọng đọc: <strong>{ttsVoice}</strong> ({ttsMode.toUpperCase()}) &bull; Âm lượng nền:{' '}
                      <strong>{origVol}%</strong>
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <a
                        href={resultVideoUrl}
                        download="video_long_tieng_ai.mp4"
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      <span>Tải Video (.mp4)</span>
                    </a>
                    <button
                        onClick={() => setShowResultModal(false)}
                        className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-medium rounded-lg transition-colors cursor-pointer"
                    >
                      Đóng
                    </button>
                  </div>
                </div>
              </div>
            </div>
        )}

        {/* Diagnostics & Debug Modal */}
        <DiagnosticsModal
            isOpen={showDiagnosticsModal}
            onClose={() => setShowDiagnosticsModal(false)}
            localServerUrl={localServerUrl}
        />
      </div>
  );
}
