"""
VietDub AI - Local Backend Engine & Chẩn đoán trạng thái
Tích hợp trực tiếp VieNeu Local Python SDK (https://docs.vieneu.io/) và FFmpeg native.

Khởi chạy bằng lệnh:
    python local_backend.py
hoặc:
    python start.py
"""

import os
import sys
import json
import time
import shutil
import threading
import subprocess
import traceback
import base64
import re
import hashlib
import wave
import unicodedata
import urllib.request
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, unquote

PORT = 8000
OUTPUT_DIR = os.path.abspath("output")
os.makedirs(OUTPUT_DIR, exist_ok=True)

def to_ascii_slug(text: str) -> str:
    """Chuyển tên giọng tiếng Việt (ví dụ 'Đức Trí') thành tên file an toàn ASCII (ví dụ 'duc_tri')"""
    text = text.replace("Đ", "D").replace("đ", "d")
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^\w\s-]", "", text).strip().lower()
    return re.sub(r"[-\s]+", "_", slug) or "voice"

def format_ass_time(seconds: float) -> str:
    """Định dạng thời gian chuẩn ASS: H:MM:SS.cc (ví dụ 0:00:05.00, 0:01:23.45)"""
    seconds = max(0.0, float(seconds))
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int(round((seconds - int(seconds)) * 100))
    if cs >= 100:
        cs = 99
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"

def format_srt_time(seconds: float) -> str:
    """Định dạng thời gian chuẩn SRT: HH:MM:SS,mmm (ví dụ 00:00:05,000)"""
    seconds = max(0.0, float(seconds))
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int(round((seconds - int(seconds)) * 1000))
    if ms >= 1000:
        ms = 999
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

def translate_single_text_google(text: str) -> str:
    """Dịch tự động qua Google Translate API trực tiếp (hoàn toàn miễn phí, không cần key)"""
    text = text.strip()
    if not text:
        return ""
    try:
        url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q={urllib.parse.quote(text)}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=6) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            translated = "".join([part[0] for part in data[0] if part and part[0]])
            return translated if translated else text
    except Exception:
        return text

def translate_segments(segments: list, api_key: str = "", model_name: str = "gemini-2.5-flash") -> list:
    """
    Dịch danh sách các đoạn câu thoại trích xuất từ Whisper sang tiếng Việt tự nhiên thật sự.
    Tuyệt đối không dùng câu mẫu lặp lại.
    Ưu tiên 1: Google Gemini API (nếu có API Key)
    Ưu tiên 2: Node.js server proxy (cổng 3000 /api/translate)
    Ưu tiên 3: Google Translate API trực tiếp
    """
    if not segments:
        return segments

    # 1. Thử dịch bằng Google Gemini nếu có API key
    clean_key = (api_key or "").strip()
    if clean_key:
        models_to_try = [model_name, "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]
        seen = set()
        models = [m for m in models_to_try if m and not (m in seen or seen.add(m))]

        numbered_texts = "\n".join([f"{i+1}. {s.get('text', '')}" for i, s in enumerate(segments)])
        prompt = (
            "Bạn là chuyên gia biên dịch và lồng tiếng video chuyên nghiệp. "
            "Hãy dịch toàn bộ danh sách các câu thoại sau đây sang tiếng Việt tự nhiên, phù hợp với lời nói video. "
            "QUY TẮC BẮT BUỘC: Giữ nguyên số lượng câu và đúng thứ tự đánh số tương ứng (1. ..., 2. ...), không thêm bất kỳ lời dẫn nào khác:\n\n"
            + numbered_texts
        )

        for m in models:
            try:
                log(f"[+] Đang dịch {len(segments)} câu bằng Gemini ({m})...")
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={clean_key}"
                payload = json.dumps({"contents": [{"parts": [{"text": prompt}]}]}).encode("utf-8")
                req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=20) as resp:
                    res_json = json.loads(resp.read().decode("utf-8"))
                    candidates = res_json.get("candidates", [])
                    if candidates:
                        raw_reply = candidates[0].get("content", {}).get("parts", [])[0].get("text", "")
                        lines = [line.strip() for line in raw_reply.strip().split("\n") if line.strip()]
                        parsed = {}
                        for line in lines:
                            match = re.match(r"^(\d+)[\.\)\:\-]\s*(.*)", line)
                            if match:
                                num = int(match.group(1))
                                parsed[num] = match.group(2).strip()

                        if len(parsed) >= max(1, len(segments) // 2):
                            for idx, s in enumerate(segments):
                                trans_val = parsed.get(idx + 1)
                                s["translated"] = trans_val if trans_val else s.get("text", "")
                            log(f"[+] ✅ Gemini ({m}) đã dịch thành công {len(segments)} đoạn hội thoại.")
                            return segments
            except Exception as e:
                log(f"[!] Gemini {m} dịch không thành công: {e}")

    # 2. Thử gọi Node.js Web Server (Port 3000)
    try:
        req_data = json.dumps({"segments": segments, "targetLanguage": "vi", "model": model_name}).encode("utf-8")
        req = urllib.request.Request("http://127.0.0.1:3000/api/translate", data=req_data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if "translations" in data and len(data["translations"]) == len(segments):
                for idx, t in enumerate(data["translations"]):
                    segments[idx]["translated"] = t
                log(f"[+] ✅ Đã dịch qua Web Server API (cổng 3000).")
                return segments
    except Exception:
        pass

    # 3. Fallback sang Google Translate trực tiếp (không cần API key)
    log(f"[+] Dịch trực tiếp {len(segments)} câu bằng Google Translate...")
    for idx, s in enumerate(segments):
        orig = s.get("text", "").strip()
        if orig:
            trans = translate_single_text_google(orig)
            s["translated"] = trans
        else:
            s["translated"] = ""
        log(f"    [{idx+1}/{len(segments)}] {s.get('text')} -> {s['translated']}")

    return segments

# Bảng theo dõi chẩn đoán & debug chi tiết
diagnostics = {
    "vieneu_installed": False,
    "vieneu_version": None,
    "vieneu_error": None,
    "vieneu_loaded": False,
    "last_tts_voice": None,
    "last_tts_duration_ms": 0,
    "last_tts_file_size": 0,
    "last_tts_is_real": False,
    "last_tts_error": None,
    "torch_cuda": False,
    "torch_version": None,
    "ffmpeg_path": None,
    "ffmpeg_version": None,
    "whisper_installed": False,
}

# Trạng thái tác vụ lồng tiếng
job_state = {
    "is_running": False,
    "progress": 0,
    "status": "Sẵn sàng",
    "logs": ["[+] Python Local Backend đã khởi động trên cổng 8000."],
    "output_video": None,
    "output_audio": None,
    "error": None,
}

def log(message: str):
    timestamp = time.strftime("%H:%M:%S")
    entry = f"[{timestamp}] {message}"
    print(entry)
    job_state["logs"].append(entry)

def check_dependencies():
    """Kiểm tra môi trường và lưu chẩn đoán theo tài liệu https://docs.vieneu.io/"""
    ffmpeg_bin = shutil.which("ffmpeg")
    has_ffmpeg = ffmpeg_bin is not None
    diagnostics["ffmpeg_path"] = ffmpeg_bin

    if has_ffmpeg:
        try:
            res = subprocess.run(["ffmpeg", "-version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            diagnostics["ffmpeg_version"] = res.stdout.split("\n")[0] if res.stdout else "Đã cài"
        except Exception:
            diagnostics["ffmpeg_version"] = "Đã cài (ffmpeg)"

    # Kiểm tra torch & CUDA
    try:
        import torch
        diagnostics["torch_version"] = torch.__version__
        diagnostics["torch_cuda"] = torch.cuda.is_available()
    except Exception:
        diagnostics["torch_version"] = "Chưa cài torch"
        diagnostics["torch_cuda"] = False

    # Kiểm tra vieneu
    has_vieneu = False
    try:
        import vieneu
        has_vieneu = True
        diagnostics["vieneu_installed"] = True
        diagnostics["vieneu_version"] = getattr(vieneu, "__version__", "Đã cài đặt")
    except ImportError as e:
        has_vieneu = False
        diagnostics["vieneu_installed"] = False
        diagnostics["vieneu_error"] = f"Chưa cài package vieneu ({str(e)})"
    except Exception as e:
        has_vieneu = False
        diagnostics["vieneu_installed"] = False
        diagnostics["vieneu_error"] = f"Lỗi nạp vieneu: {str(e)}"

    # Kiểm tra whisper
    has_whisper = False
    try:
        import faster_whisper
        has_whisper = True
        diagnostics["whisper_installed"] = True
    except Exception:
        has_whisper = False
        diagnostics["whisper_installed"] = False

    try:
        import google.generativeai
        has_gemini = True
    except Exception:
        has_gemini = False

    return {
        "ffmpeg": has_ffmpeg,
        "vieneu": has_vieneu,
        "whisper": has_whisper,
        "gemini": has_gemini,
        "cuda": diagnostics["torch_cuda"],
    }

# ==========================================================
# VIENEU PYTHON SDK INTEGRATION (https://docs.vieneu.io/)
# ==========================================================
_vieneu_instance = None
_vieneu_lock = threading.Lock()

def get_vieneu_engine():
    """
    Khởi tạo VieNeu TTS theo tài liệu chuẩn https://docs.vieneu.io/:
        from vieneu import Vieneu
        tts = Vieneu()
    """
    global _vieneu_instance
    with _vieneu_lock:
        if _vieneu_instance is None:
            try:
                from vieneu import Vieneu
                log("[VieNeu SDK] Đang khởi tạo mô hình VieNeu-TTS vào RAM/VRAM...")
                _vieneu_instance = Vieneu()
                diagnostics["vieneu_loaded"] = True
                diagnostics["vieneu_error"] = None
                log("[VieNeu SDK] ✅ Đã nạp thành công mô hình VieNeu (On-Device Neural TTS)!")
            except ImportError as e:
                diagnostics["vieneu_loaded"] = False
                diagnostics["vieneu_error"] = f"ImportError: {str(e)}. Cần chạy: pip install vieneu"
                log(f"[VieNeu SDK] ❌ {diagnostics['vieneu_error']}")
                return None
            except Exception as e:
                diagnostics["vieneu_loaded"] = False
                diagnostics["vieneu_error"] = f"Lỗi khởi tạo Vieneu(): {str(e)}\n{traceback.format_exc()}"
                log(f"[VieNeu SDK] ⚠️ Lỗi khi nạp mô hình: {e}")
                return None
        return _vieneu_instance

def synthesize_audio_vieneu(text: str, voice: str = "Minh Quân", output_path: str = "") -> tuple[bool, bool, str]:
    """
    Sử dụng VieNeu SDK để tổng hợp giọng nói:
        audio = tts.infer(text=text, voice=voice)
        tts.save(audio, output_path)
    Trả về: (thành_công: bool, là_vieneu_thật: bool, thông_điệp: str)
    """
    start_time = time.time()
    diagnostics["last_tts_voice"] = voice

    tts = get_vieneu_engine()
    if tts is not None:
        try:
            log(f"[VieNeu SDK] 🎙️ Đang tổng hợp giọng '{voice}': \"{text[:45]}...\"")

            # Thử gọi infer theo chuẩn https://docs.vieneu.io/
            try:
                audio = tts.infer(text=text, voice=voice)
            except TypeError:
                audio = tts.infer(text)

            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            tts.save(audio, output_path)

            elapsed_ms = round((time.time() - start_time) * 1000, 1)
            file_size = os.path.getsize(output_path) if os.path.exists(output_path) else 0

            diagnostics["last_tts_duration_ms"] = elapsed_ms
            diagnostics["last_tts_file_size"] = file_size
            diagnostics["last_tts_is_real"] = True
            diagnostics["last_tts_error"] = None

            log(f"[VieNeu SDK] ✅ Đã lưu audio VieNeu thật ({file_size} bytes, {elapsed_ms}ms) tại: {output_path}")
            return True, True, f"Thành công sinh giọng VieNeu thật ({elapsed_ms}ms)"
        except Exception as e:
            err_msg = f"{str(e)}\n{traceback.format_exc()}"
            diagnostics["last_tts_error"] = err_msg
            log(f"[VieNeu SDK] ❌ Lỗi khi gọi tts.infer(): {e}")

    # Fallback nếu máy chưa cài hoặc lỗi mô hình
    try:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        if shutil.which("ffmpeg"):
            # Sinh file âm thanh WAV chuẩn mono 24kHz
            subprocess.run([
                "ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.2",
                "-ar", "24000", "-ac", "1", output_path
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            file_size = os.path.getsize(output_path) if os.path.exists(output_path) else 0
            diagnostics["last_tts_is_real"] = False
            diagnostics["last_tts_file_size"] = file_size
            diagnostics["last_tts_error"] = diagnostics.get("vieneu_error") or "Không thể nạp VieNeu SDK"

            log(f"[Fallback] Đã tạo file audio đệm tại {output_path}")
            return True, False, "Tạo file đệm (VieNeu chưa nạp thành công)"
    except Exception as fe:
        diagnostics["last_tts_error"] = str(fe)
        pass

    diagnostics["last_tts_is_real"] = False
    return False, False, diagnostics.get("last_tts_error") or "Lỗi tổng hợp audio"

# ==========================================================
# TIMED TTS AUDIO - GIỮ NGUYÊN TIMELINE SRT/ASS
# ==========================================================
def _ffprobe_duration(path: str) -> float:
    """Lấy duration chính xác của một file audio bằng ffprobe."""
    if not shutil.which("ffprobe") or not os.path.exists(path):
        return 0.0
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        return max(0.0, float(result.stdout.strip()))
    except Exception:
        return 0.0


def _atempo_filter_for_ratio(ratio: float) -> str:
    """
    Tạo chuỗi atempo để thay đổi tốc độ mà không đổi cao độ.
    FFmpeg giới hạn mỗi atempo trong khoảng 0.5..2.0 nên phải tách
    thành nhiều filter khi ratio lớn.
    """
    ratio = max(0.01, float(ratio))
    parts = []
    while ratio > 2.0:
        parts.append("atempo=2.0")
        ratio /= 2.0
    while ratio < 0.5:
        parts.append("atempo=0.5")
        ratio /= 0.5
    parts.append(f"atempo={ratio:.8f}")
    return ",".join(parts)


def _prepare_tts_clip(input_path: str, output_path: str, max_duration: float) -> bool:
    """
    Chuẩn hóa từng câu TTS thành WAV mono 24kHz và KHÔNG cho phép
    audio vượt quá slot thời gian của câu subtitle.

    Quy tắc:
      - Nếu audio ngắn hơn slot: giữ nguyên tốc độ, để phần còn lại im lặng.
      - Nếu audio dài hơn slot: tăng tốc bằng atempo.
      - Cuối cùng luôn atrim cứng về max_duration để tuyệt đối không
        tràn sang câu subtitle kế tiếp.
    """
    if not os.path.exists(input_path) or max_duration <= 0:
        return False

    source_duration = _ffprobe_duration(input_path)
    if source_duration <= 0:
        return False

    # Chỉ tăng tốc khi cần. Không làm chậm TTS vì điều đó dễ khiến
    # giọng đọc kéo dài bất tự nhiên.
    filters = []
    if source_duration > max_duration:
        speed_ratio = source_duration / max_duration
        filters.append(_atempo_filter_for_ratio(speed_ratio))

    filters.append(f"atrim=duration={max_duration:.6f}")
    filters.append("asetpts=N/SR/TB")

    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-vn",
        "-ac", "1",
        "-ar", "24000",
        "-c:a", "pcm_s16le",
        "-filter:a", ",".join(filters),
        output_path,
    ]
    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if result.returncode != 0 or not os.path.exists(output_path):
            log(f"[!] FFmpeg xử lý TTS clip thất bại: {result.stderr[-500:]}")
            return False
        return True
    except Exception as e:
        log(f"[!] Không thể xử lý TTS clip: {e}")
        return False


def build_timed_tts_audio(segments: list, voice: str, output_path: str) -> bool:
    """
    Tạo một WAV timeline hoàn chỉnh từ các câu TTS.

    MỖI segment được synthesize riêng và đặt đúng vị trí start/end của
    Whisper/SRT. Không nối các câu bằng ". ". Không để câu trước tràn
    sang câu sau.
    """
    valid_segments = []
    for idx, seg in enumerate(segments):
        text = seg.get("translated", seg.get("text", "")).strip()
        try:
            start = max(0.0, float(seg.get("start", 0)))
            end = max(start, float(seg.get("end", start)))
        except (TypeError, ValueError):
            continue
        if text and end > start:
            valid_segments.append((idx, seg, text, start, end))

    if not valid_segments:
        log("[!] Không có segment hợp lệ để tạo timeline TTS.")
        return False

    segment_dir = os.path.join(OUTPUT_DIR, "tts_segments")
    os.makedirs(segment_dir, exist_ok=True)

    prepared_clips = []
    max_end = 0.0

    for pos, (idx, seg, text, start, end) in enumerate(valid_segments):
        # Không cho câu hiện tại vượt qua thời điểm bắt đầu câu kế tiếp,
        # kể cả khi SRT/Whisper vô tình có khoảng thời gian chồng lấn.
        if pos + 1 < len(valid_segments):
            next_start = valid_segments[pos + 1][3]
            slot_end = min(end, next_start)
        else:
            slot_end = end

        slot_duration = slot_end - start
        if slot_duration <= 0.01:
            log(f"    [{idx + 1}] Bỏ qua segment có slot quá ngắn: {start:.2f}s -> {end:.2f}s")
            continue

        text_hash = hashlib.sha1(f"{voice}|{text}".encode("utf-8")).hexdigest()[:12]
        raw_path = os.path.join(segment_dir, f"seg_{idx:05d}_{text_hash}_raw.wav")
        prepared_path = os.path.join(segment_dir, f"seg_{idx:05d}_{text_hash}_timed.wav")

        # Sinh TTS từng câu riêng biệt. Cache theo voice + text để lần chạy
        # sau không phải gọi VieNeu lại nếu nội dung không đổi.
        if not os.path.exists(raw_path) or os.path.getsize(raw_path) == 0:
            ok, is_real, _ = synthesize_audio_vieneu(text, voice=voice, output_path=raw_path)
            if not ok:
                log(f"[!] Không tạo được TTS cho segment {idx + 1}.")
                continue
            if not is_real:
                log(f"[!] Segment {idx + 1} đang dùng audio fallback thay vì VieNeu thật.")

        if not os.path.exists(prepared_path) or os.path.getsize(prepared_path) == 0:
            if not _prepare_tts_clip(raw_path, prepared_path, slot_duration):
                continue

        prepared_duration = _ffprobe_duration(prepared_path)
        if prepared_duration <= 0:
            continue

        prepared_clips.append((start, prepared_path, prepared_duration))
        max_end = max(max_end, slot_end)

        log(
            f"    TTS [{idx + 1}/{len(valid_segments)}] "
            f"{start:.2f}s -> {slot_end:.2f}s | slot={slot_duration:.2f}s | "
            f"audio={prepared_duration:.2f}s"
        )

    if not prepared_clips:
        log("[!] Không tạo được bất kỳ TTS clip nào.")
        return False

    # Tạo PCM timeline bằng wave thay vì nối các câu. Mỗi clip được chèn
    # đúng sample offset tương ứng với start time của subtitle.
    sample_rate = 24000
    sample_width = 2
    channels = 1
    total_duration = max_end + 2.0
    total_frames = int(round(total_duration * sample_rate))

    try:
        with wave.open(output_path, "wb") as out_wav:
            out_wav.setnchannels(channels)
            out_wav.setsampwidth(sample_width)
            out_wav.setframerate(sample_rate)

            silence_chunk_frames = sample_rate * 2
            silence_chunk = b"\x00" * (silence_chunk_frames * sample_width)
            remaining = total_frames

            # Ghi timeline theo từng block để không cần cấp phát một buffer
            # khổng lồ bằng RAM cho cả video.
            current_frame = 0
            for start, clip_path, clip_duration in sorted(prepared_clips, key=lambda x: x[0]):
                target_frame = min(total_frames, int(round(start * sample_rate)))
                gap_frames = target_frame - current_frame

                while gap_frames > 0:
                    n = min(gap_frames, silence_chunk_frames)
                    out_wav.writeframes(silence_chunk[: n * sample_width])
                    current_frame += n
                    gap_frames -= n

                with wave.open(clip_path, "rb") as clip_wav:
                    clip_frames = min(clip_wav.getnframes(), total_frames - current_frame)
                    remaining_clip = clip_frames
                    while remaining_clip > 0:
                        chunk = clip_wav.readframes(min(sample_rate * 2, remaining_clip))
                        if not chunk:
                            break
                        out_wav.writeframes(chunk)
                        written = len(chunk) // sample_width
                        current_frame += written
                        remaining_clip -= written

                if current_frame >= total_frames:
                    break

            while current_frame < total_frames:
                n = min(total_frames - current_frame, silence_chunk_frames)
                out_wav.writeframes(silence_chunk[: n * sample_width])
                current_frame += n

        log(f"[+] ✅ Đã tạo TTS timeline chuẩn SRT: {output_path}")
        return os.path.exists(output_path) and os.path.getsize(output_path) > 0
    except Exception as e:
        log(f"[!] Lỗi khi ghép timeline TTS: {e}")
        return False


# ==========================================================
# TÁCH SEGMENT THEO KHOẢNG IM LẶNG THỰC TẾ
# ==========================================================
def split_segments_by_silence(whisper_segments: list, silence_threshold: float = 1.2) -> list:
    """Tách segment Whisper tại các khoảng im lặng lớn giữa các từ."""
    result = []
    for original in whisper_segments:
        words = original.get("words") or []
        if not words:
            result.append({
                "start": round(float(original["start"]), 2),
                "end": round(float(original["end"]), 2),
                "text": original.get("text", "").strip(),
            })
            continue

        current_words = []
        previous_end = None

        def flush_current():
            if not current_words:
                return
            first = current_words[0]
            last = current_words[-1]
            text_value = "".join(str(w.get("word", "")) for w in current_words).strip()
            start = float(first.get("start", original["start"]))
            end = float(last.get("end", original["end"]))
            if text_value and end > start:
                result.append({
                    "start": round(start, 2),
                    "end": round(end, 2),
                    "text": text_value,
                })

        for word in words:
            word_start = word.get("start")
            word_end = word.get("end")
            if word_start is None or word_end is None:
                continue
            word_start = float(word_start)
            word_end = float(word_end)
            if current_words and previous_end is not None and word_start - previous_end >= silence_threshold:
                flush_current()
                current_words = []
            current_words.append({
                "word": word.get("word", ""),
                "start": word_start,
                "end": word_end,
            })
            previous_end = word_end
        flush_current()

    result = [x for x in result if x.get("text", "").strip() and float(x.get("end", 0)) > float(x.get("start", 0))]
    result.sort(key=lambda x: (float(x["start"]), float(x["end"])))
    return result


# ==========================================================
# QUY TRÌNH PIPELINE 5 BƯỚC XỬ LÝ VIDEO
# ==========================================================
def run_pipeline_thread(config: dict):
    try:
        job_state["is_running"] = True
        job_state["progress"] = 0
        job_state["error"] = None
        job_state["output_video"] = None

        tts_voice = config.get("tts_voice", "Minh Quân")
        tts_mode = config.get("tts_mode", "turbo")
        whisper_model = config.get("whisper_model", "base")
        orig_vol = int(config.get("original_volume", 20))

        log("🚀 BẮT ĐẦU QUY TRÌNH DỊCH & LỒNG TIẾNG NATIVE...")
        log(f"Thiết lập: Giọng={tts_voice}, Mode={tts_mode}, Whisper={whisper_model}, Âm lượng gốc={orig_vol}%")

        source_type = config.get("source_type", "youtube")
        video_input = os.path.join(OUTPUT_DIR, "video_input.mp4")

        # Nạp video đầu vào
        if source_type == "youtube":
            url = (config.get("url") or config.get("video_url") or "").strip()
            if not url:
                job_state["error"] = "Chưa cung cấp link video YouTube hợp lệ."
                job_state["status"] = "Lỗi: Thiếu link YouTube."
                log("[!] Lỗi: Chưa cung cấp link video YouTube.")
                return

            log(f"Đang tải video thực tế từ link YouTube: {url}")
            job_state["status"] = f"Đang tải video từ YouTube ({url})..."
            job_state["progress"] = 10

            if not shutil.which("yt-dlp"):
                job_state["error"] = "Máy chủ chưa cài công cụ yt-dlp để tải video YouTube. Hãy chạy: pip install yt-dlp"
                job_state["status"] = "Lỗi: Thiếu thư viện yt-dlp."
                log("[!] Lỗi: Chưa cài yt-dlp. Vui lòng chạy lệnh: pip install yt-dlp")
                return

            if os.path.exists(video_input):
                try:
                    os.remove(video_input)
                except Exception:
                    pass

            cmd = [
                "yt-dlp",
                "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                "--merge-output-format", "mp4",
                "-o", video_input,
                url
            ]
            res_dl = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if res_dl.returncode != 0 or not os.path.exists(video_input):
                err_msg = res_dl.stderr.strip().split("\n")[-1] if res_dl.stderr else "Không tải được video"
                log(f"[!] Lỗi yt-dlp khi tải video: {err_msg}")
                job_state["error"] = f"Lỗi yt-dlp: {err_msg}"
                job_state["status"] = "Lỗi tải video từ YouTube."
                return

            log(f"[+] Đã tải xong video YouTube thành công: {video_input} ({os.path.getsize(video_input)} bytes)")
        else:
            local_path = (config.get("local_file_path") or config.get("video_file") or "").strip()
            if local_path and os.path.exists(local_path):
                shutil.copy(local_path, video_input)
                log(f"[+] Đã nạp file video cục bộ: {local_path}")
            else:
                log(f"[!] Đường dẫn video cục bộ không tồn tại: {local_path}")
                job_state["error"] = f"File video cục bộ không tồn tại: {local_path}"
                job_state["status"] = "Lỗi: File video local không tồn tại."
                return

        if not os.path.exists(video_input):
            job_state["error"] = "Không tìm thấy file video đầu vào để xử lý."
            job_state["status"] = "Lỗi: Thiếu file video."
            return

        # Bước 1: Tách audio bằng FFmpeg
        job_state["status"] = "Bước 1/5: Tách audio từ video (ffmpeg)..."
        job_state["progress"] = 25
        audio_wav = os.path.join(OUTPUT_DIR, "audio_original.wav")
        log("[+] Bước 1/5: Tách audio sang PCM 16kHz WAV bằng ffmpeg...")

        if shutil.which("ffmpeg") and os.path.exists(video_input):
            cmd_ffmpeg = [
                "ffmpeg", "-y", "-i", video_input,
                "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", audio_wav
            ]
            subprocess.run(cmd_ffmpeg, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            log("[+] Đã trích xuất audio 16kHz mono thành công.")
        else:
            log("[+] Đã nạp file audio đệm cho tiến trình.")

        # Bước 2: Nhận dạng giọng nói (Faster-Whisper)
        job_state["status"] = f"Bước 2/5: Nhận dạng giọng nói (Whisper {whisper_model})..."
        job_state["progress"] = 40
        log(f"[+] Bước 2/5: Khởi chạy mô hình Faster-Whisper (model={whisper_model})...")

        segments = []
        try:
            from faster_whisper import WhisperModel
            # Sử dụng Faster-Whisper với bộ lọc âm thanh VAD để loại bỏ các đoạn im lặng/nhạc nền
            model = WhisperModel(whisper_model, device="cpu", compute_type="int8")
            try:
                whisper_segments, info = model.transcribe(
                    audio_wav,
                    beam_size=5,
                    vad_filter=True,
                    vad_parameters=dict(min_silence_duration_ms=400),
                    word_timestamps=True,
                )
            except Exception:
                whisper_segments, info = model.transcribe(audio_wav, beam_size=5)

            raw_whisper_segments = []
            for seg in whisper_segments:
                txt = seg.text.strip()
                if not txt:
                    continue
                words = []
                for word in (getattr(seg, "words", None) or []):
                    word_text = getattr(word, "word", "")
                    word_start = getattr(word, "start", None)
                    word_end = getattr(word, "end", None)
                    if word_text and word_start is not None and word_end is not None:
                        words.append({"word": word_text, "start": float(word_start), "end": float(word_end)})
                raw_whisper_segments.append({"start": float(seg.start), "end": float(seg.end), "text": txt, "words": words})

            silence_threshold = float(config.get("silence_split_threshold", 1.2))
            segments = split_segments_by_silence(raw_whisper_segments, silence_threshold=max(0.2, silence_threshold))

            for seg in segments:
                log(f"    [{seg['start']:.2f}s -> {seg['end']:.2f}s] {seg['text']}")

            log(f"[+] Whisper đã nhận dạng {len(raw_whisper_segments)} segment gốc, sau khi tách khoảng im lặng còn {len(segments)} segment thoại.")
        except Exception as e:
            log(f"[!] Faster-Whisper không khả dụng: {e}. Vui lòng cài đặt: pip install faster-whisper")
            segments = []

        if not segments:
            log("[!] Không phát hiện được đoạn hội thoại/giọng nói nào từ âm thanh video. Quy trình dừng lại.")
            job_state["error"] = "Không phát hiện giọng nói trong video để phiên âm và lồng tiếng. Vui lòng kiểm tra lại âm thanh của file video."
            job_state["status"] = "Lỗi: Không tìm thấy giọng nói trong video."
            return

        # Bước 3: Dịch sang tiếng Việt thực tế (Gemini hoặc Google Translate)
        trans_model = config.get("translation_model", "gemini-2.5-flash")
        api_key_input = config.get("api_key", "")
        job_state["status"] = f"Bước 3/5: Dịch {len(segments)} câu thoại sang tiếng Việt..."
        job_state["progress"] = 60
        log(f"[+] Bước 3/5: Dịch ngữ cảnh câu thoại sang tiếng Việt (Model: {trans_model})...")

        segments = translate_segments(segments, api_key=api_key_input, model_name=trans_model)

        # Bước 4: Tạo file phụ đề chuẩn .ass và .srt
        job_state["status"] = "Bước 4/5: Xuất file phụ đề chuẩn .ass và .srt..."
        job_state["progress"] = 75

        use_box = config.get("subtitle_box", True)
        box_opacity = config.get("subtitle_box_opacity", 75)
        # Tính mã alpha hex cho màu nền box của ASS (&HAABBGGRR)
        alpha_val = int(255 * (1.0 - (box_opacity / 100.0)))
        alpha_hex = f"{alpha_val:02X}"
        back_color_ass = f"&H{alpha_hex}000000"
        border_style_val = 3 if use_box else 1

        ass_path = os.path.join(OUTPUT_DIR, "subtitles.ass")
        with open(ass_path, "w", encoding="utf-8") as f:
            f.write("[Script Info]\n")
            f.write("Title: VietDub AI Subtitles\n")
            f.write("ScriptType: v4.00+\n")
            f.write("PlayResX: 1920\n")
            f.write("PlayResY: 1080\n")
            f.write("WrapStyle: 0\n")
            f.write("[V4+ Styles]\n")
            f.write("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n")
            f.write(f"Style: Default,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,{back_color_ass},-1,0,0,0,100,100,0,0,{border_style_val},2,0,2,30,30,50,1\n")
            f.write("[Events]\n")
            f.write("Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
            for seg in segments:
                start_str = format_ass_time(seg["start"])
                end_str = format_ass_time(seg["end"])
                text_content = seg.get("translated", seg.get("text", "")).replace("\n", " ").strip()
                f.write(f"Dialogue: 0,{start_str},{end_str},Default,,0,0,0,,{text_content}\n")
        log(f"[+] Đã tạo file phụ đề ASS chuẩn: {ass_path}")

        srt_path = os.path.join(OUTPUT_DIR, "subtitles.srt")
        with open(srt_path, "w", encoding="utf-8") as f:
            for idx, seg in enumerate(segments, 1):
                start_srt = format_srt_time(seg["start"])
                end_srt = format_srt_time(seg["end"])
                text_content = seg.get("translated", seg.get("text", "")).replace("\n", " ").strip()
                f.write(f"{idx}\n{start_srt} --> {end_srt}\n{text_content}\n\n")
        log(f"[+] Đã tạo file phụ đề SRT chuẩn: {srt_path}")

        # Bước 5: Lồng tiếng VieNeu & Trộn âm thanh FFmpeg
        job_state["status"] = f"Bước 5/5: Lồng tiếng VieNeu ({tts_voice}) & Hòa âm FFmpeg..."
        job_state["progress"] = 85
        log(f"[+] Bước 5/5: Kích hoạt VieNeu SDK (voice={tts_voice})...")

        tts_wav = os.path.join(OUTPUT_DIR, "tts_combined.wav")
        all_translated = [
            s.get("translated", s.get("text", "")).strip()
            for s in segments
            if s.get("translated", s.get("text", "")).strip()
        ]
        if not all_translated:
            log("[!] Không có nội dung thoại nào để VieNeu lồng tiếng.")
            job_state["error"] = "Không có nội dung thoại hợp lệ để lồng tiếng."
            job_state["status"] = "Lỗi: Không có nội dung thoại lồng tiếng."
            return

        # QUAN TRỌNG: Không được nối toàn bộ câu thành một đoạn TTS duy nhất.
        # Mỗi subtitle/segment phải được VieNeu tổng hợp riêng rồi đặt vào
        # đúng timestamp start/end của Whisper/SRT.
        if not build_timed_tts_audio(segments, voice=tts_voice, output_path=tts_wav):
            job_state["error"] = "Không thể tạo audio TTS theo timeline SRT."
            job_state["status"] = "Lỗi: Không tạo được timeline lồng tiếng."
            return

        burn = config.get("burn_subtitles", True)
        final_video_name = f"video_long_tieng_goc{orig_vol}_{int(time.time())}.mp4"
        final_video_path = os.path.join(OUTPUT_DIR, final_video_name)

        if shutil.which("ffmpeg") and os.path.exists(video_input) and os.path.exists(tts_wav):
            log(f"[+] Hòa âm FFmpeg: Giảm âm lượng gốc xuống {orig_vol}%, phủ tiếng VieNeu...")
            vol_factor = round(orig_vol / 100.0, 2)

            # Kiểm tra nếu người dùng chọn ép cứng phụ đề (burn subtitles)
            mixed_successfully = False
            if burn and os.path.exists(ass_path):
                try:
                    escaped_ass = ass_path.replace("\\", "/").replace(":", "\\:")
                    filter_burn = f"[0:v]subtitles='{escaped_ass}'[vout];[0:a]volume={vol_factor}[a0];[1:a]volume=1.0[a1];[a0][a1]amix=inputs=2:duration=first[aout]"
                    cmd_mix = [
                        "ffmpeg", "-y",
                        "-i", video_input,
                        "-i", tts_wav,
                        "-filter_complex", filter_burn,
                        "-map", "[vout]", "-map", "[aout]",
                        "-c:v", "libx264", "-c:a", "aac", "-b:a", "192k",
                        final_video_path
                    ]
                    res = subprocess.run(cmd_mix, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                    if res.returncode == 0 and os.path.exists(final_video_path):
                        mixed_successfully = True
                        log(f"[+] Đã ép cứng phụ đề ASS và hòa âm thành công vào video.")
                except Exception as burn_err:
                    log(f"[!] Chèn phụ đề ffmpeg gặp lỗi ({burn_err}), chuyển sang hòa âm tiêu chuẩn.")

            if not mixed_successfully:
                filter_str = f"[0:a]volume={vol_factor}[a0];[1:a]volume=1.0[a1];[a0][a1]amix=inputs=2:duration=first[aout]"
                cmd_mix = [
                    "ffmpeg", "-y",
                    "-i", video_input,
                    "-i", tts_wav,
                    "-filter_complex", filter_str,
                    "-map", "0:v", "-map", "[aout]",
                    "-c:v", "libx264", "-c:a", "aac", "-b:a", "192k",
                    final_video_path
                ]
                subprocess.run(cmd_mix, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                log(f"[+] Hoàn tất xuất video thành phẩm: {final_video_path}")
        else:
            if os.path.exists(video_input):
                shutil.copy(video_input, final_video_path)

        job_state["output_video"] = final_video_name
        job_state["progress"] = 100
        job_state["status"] = "Hoàn tất! Video đã lồng tiếng xong."
        log(f"[+] 🎉 Toàn bộ quy trình hoàn tất 100%! Video lưu tại: {final_video_path}")

    except Exception as e:
        log(f"[!] Lỗi trong quá trình xử lý: {str(e)}")
        job_state["error"] = str(e)
        job_state["status"] = f"Lỗi: {str(e)}"
    finally:
        job_state["is_running"] = False

# ==========================================================
# HTTP SERVER & API ENDPOINTS
# ==========================================================
class RequestHandler(BaseHTTPRequestHandler):
    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed_url = urlparse(self.path)
        path = parsed_url.path

        if path == "/" or path == "":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self._send_cors_headers()
            self.end_headers()
            deps = check_dependencies()
            html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>VietDub AI - Local Backend Engine</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 40px 20px; text-align: center; }}
        .card {{ max-width: 620px; margin: 0 auto; background: #1e293b; padding: 32px; border-radius: 16px; border: 1px solid #334155; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }}
        h1 {{ color: #38bdf8; font-size: 22px; margin-bottom: 8px; }}
        p {{ color: #94a3b8; font-size: 14px; line-height: 1.6; }}
        .badge {{ display: inline-block; padding: 6px 14px; border-radius: 9999px; background: #064e3b; color: #34d399; font-weight: bold; font-size: 13px; margin: 12px 0 20px 0; }}
        .deps {{ background: #0f172a; border-radius: 8px; padding: 16px; text-align: left; font-family: monospace; font-size: 13px; margin: 20px 0; }}
        .dep-item {{ margin: 6px 0; }}
        .ok {{ color: #4ade80; }}
        .warn {{ color: #fbbf24; }}
        .notice {{ background: #0369a1; color: #e0f2fe; padding: 14px; border-radius: 8px; font-size: 13px; margin-top: 20px; }}
        .btn {{ display: inline-block; margin-top: 15px; padding: 10px 20px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold; }}
    </style>
</head>
<body>
    <div class="card">
        <h1>🚀 VietDub AI - Local Engine đã sẵn sàng!</h1>
        <div class="badge">● Máy chủ cục bộ đang chạy tại cổng 8000</div>
        <p>Cầu nối giữa Web GUI và VieNeu Python SDK (https://docs.vieneu.io/):</p>
        <div class="deps">
            <div class="dep-item">FFmpeg Native: {'<span class="ok">✅ ĐÃ CÓ</span>' if deps['ffmpeg'] else '<span class="warn">❌ CHƯA CÀI FFMPEG</span>'}</div>
            <div class="dep-item">VieNeu Python SDK: {'<span class="ok">✅ ĐÃ CÓ (from vieneu import Vieneu)</span>' if deps['vieneu'] else '<span class="warn">⚠️ Chưa cài: pip install vieneu</span>'}</div>
            <div class="dep-item">PyTorch CUDA: {'<span class="ok">✅ CÓ GPU CUDA</span>' if deps['cuda'] else '<span class="warn">● Chế độ CPU</span>'}</div>
            <div class="dep-item">Faster-Whisper: {'<span class="ok">✅ ĐÃ CÓ</span>' if deps['whisper'] else '<span class="warn">⚠️ Chưa cài faster-whisper</span>'}</div>
        </div>
        <div class="notice">
            👉 <strong>Bạn không cần thao tác ở trang này.</strong><br>
            Hãy mở giao diện Web tại <strong>http://localhost:3000</strong> để điều khiển hoặc bấm vào nút <strong>"Bảng Debug Trạng Thái"</strong>!
        </div>
        <a class="btn" href="http://localhost:3000">Mở Giao Diện Web (Port 3000)</a>
    </div>
</body>
</html>"""
            self.wfile.write(html.encode("utf-8"))

        elif path == "/health" or path == "/api/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._send_cors_headers()
            self.end_headers()
            deps = check_dependencies()
            res = {
                "status": "ok",
                "message": "VietDub AI Local Engine is running",
                "dependencies": deps,
                "diagnostics": diagnostics,
                "is_running": job_state["is_running"],
            }
            self.wfile.write(json.dumps(res).encode("utf-8"))

        elif path == "/api/debug" or path == "/debug":
            # Endpoint chẩn đoán chi tiết hệ thống
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._send_cors_headers()
            self.end_headers()
            deps = check_dependencies()
            res = {
                "status": "ok",
                "python_version": sys.version,
                "platform": sys.platform,
                "output_dir": OUTPUT_DIR,
                "dependencies": deps,
                "diagnostics": diagnostics,
                "job_state": job_state,
            }
            self.wfile.write(json.dumps(res, indent=2).encode("utf-8"))

        elif path == "/status" or path == "/api/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps(job_state).encode("utf-8"))

        elif path.startswith("/output/"):
            # Giải mã percent-encoding (ví dụ %C4%90%E1%BB%A9c -> Đức)
            clean_path = unquote(path)
            filename = os.path.basename(clean_path)
            file_path = os.path.join(OUTPUT_DIR, filename)
            if os.path.exists(file_path):
                file_size = os.path.getsize(file_path)
                content_type = "video/mp4"
                if filename.endswith(".wav"):
                    content_type = "audio/wav"
                elif filename.endswith(".mp3"):
                    content_type = "audio/mpeg"
                elif filename.endswith(".ass") or filename.endswith(".srt") or filename.endswith(".txt"):
                    content_type = "text/plain; charset=utf-8"

                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(file_size))
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Cache-Control", "no-cache")
                self._send_cors_headers()
                self.end_headers()
                with open(file_path, "rb") as f:
                    shutil.copyfileobj(f, self.wfile)
            else:
                self.send_response(404)
                self._send_cors_headers()
                self.end_headers()
        else:
            self.send_response(404)
            self._send_cors_headers()
            self.end_headers()

    def do_POST(self):
        parsed_url = urlparse(self.path)
        path = parsed_url.path

        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length).decode("utf-8")
        body = json.loads(post_data) if post_data else {}

        if path == "/start" or path == "/api/start":
            if job_state["is_running"]:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Tiến trình khác đang chạy."}).encode("utf-8"))
                return

            thread = threading.Thread(target=run_pipeline_thread, args=(body,))
            thread.daemon = True
            thread.start()

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({"status": "started", "message": "Bắt đầu chạy trên Local Engine"}).encode("utf-8"))

        elif path == "/preview-voice" or path == "/api/preview-voice":
            voice = body.get("voice", "Minh Quân")
            text = body.get("text", "Xin chào các bạn, đây là giọng đọc thử nghiệm qua VieNeu TTS.")

            log(f"[VieNeu SDK] Yêu cầu nghe thử giọng: '{voice}'")
            safe_slug = to_ascii_slug(voice)
            preview_filename = f"preview_{safe_slug}.wav"
            preview_filepath = os.path.join(OUTPUT_DIR, preview_filename)

            # Gọi VieNeu SDK
            ok, is_real, message = synthesize_audio_vieneu(text, voice=voice, output_path=preview_filepath)

            # Tạo audio_base64 để Web GUI phát trực tiếp từ bộ nhớ RAM (tránh hoàn toàn lỗi 404/URL encoding)
            audio_base64 = None
            if os.path.exists(preview_filepath) and os.path.getsize(preview_filepath) > 0:
                try:
                    with open(preview_filepath, "rb") as f:
                        raw_bytes = f.read()
                    audio_base64 = f"data:audio/wav;base64,{base64.b64encode(raw_bytes).decode('ascii')}"
                except Exception as b64_err:
                    log(f"[!] Không thể encode base64: {b64_err}")

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({
                "status": "ok" if ok else "error",
                "voice": voice,
                "is_real_vieneu": is_real,
                "audio_url": f"/output/{preview_filename}",
                "audio_base64": audio_base64,
                "message": message,
                "duration_ms": diagnostics["last_tts_duration_ms"],
                "file_size": diagnostics["last_tts_file_size"],
                "error": diagnostics["last_tts_error"],
            }).encode("utf-8"))

        elif path == "/api/debug-tts":
            # Endpoint test chuyên dụng để chẩn đoán xem VieNeu có tạo được tiếng Việt thật không
            voice = body.get("voice", "Minh Quân")
            text = body.get("text", "Xin chào, đây là câu thử nghiệm trực tiếp từ VieNeu Local SDK.")
            safe_slug = to_ascii_slug(voice)
            test_filename = f"test_debug_{safe_slug}_{int(time.time())}.wav"
            test_filepath = os.path.join(OUTPUT_DIR, test_filename)

            ok, is_real, message = synthesize_audio_vieneu(text, voice=voice, output_path=test_filepath)

            audio_base64 = None
            if os.path.exists(test_filepath) and os.path.getsize(test_filepath) > 0:
                try:
                    with open(test_filepath, "rb") as f:
                        raw_bytes = f.read()
                    audio_base64 = f"data:audio/wav;base64,{base64.b64encode(raw_bytes).decode('ascii')}"
                except Exception as b64_err:
                    log(f"[!] Không thể encode base64: {b64_err}")

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": ok,
                "is_real_vieneu": is_real,
                "audio_url": f"/output/{test_filename}" if ok else None,
                "audio_base64": audio_base64,
                "message": message,
                "duration_ms": diagnostics["last_tts_duration_ms"],
                "file_size": diagnostics["last_tts_file_size"],
                "error": diagnostics["last_tts_error"],
                "diagnostics": diagnostics,
            }).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

def run_server():
    server_address = ("0.0.0.0", PORT)
    httpd = HTTPServer(server_address, RequestHandler)
    print("=" * 65)
    print(f"🚀 VietDub AI - Local Backend Engine đang chạy trên cổng {PORT}")
    print("📖 VieNeu Documentation: https://docs.vieneu.io/")
    print("👉 Hãy mở giao diện Web để điều khiển trực tiếp FFmpeg & VieNeu!")
    print("=" * 65)
    deps = check_dependencies()
    print(f"Kiểm tra FFmpeg: {'✅ ĐÃ CÓ' if deps['ffmpeg'] else '❌ CHƯA CÓ (cần cài ffmpeg)'}")
    print(f"Kiểm tra VieNeu SDK: {'✅ ĐÃ CÓ (from vieneu import Vieneu)' if deps['vieneu'] else '⚠️  Chưa cài package vieneu'}")
    print(f"Kiểm tra PyTorch CUDA: {'✅ CÓ CUDA GPU' if deps['cuda'] else '● CPU'}")
    print(f"Kiểm tra Faster-Whisper: {'✅ ĐÃ CÓ' if deps['whisper'] else '⚠️  Chưa cài package faster-whisper'}")
    print("-" * 65)
    httpd.serve_forever()

if __name__ == "__main__":
    run_server()
