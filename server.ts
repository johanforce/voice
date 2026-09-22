import express from 'express';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// Lazy GoogleGenAI client
let aiClient: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
  });
});

// Translation API using Gemini with fallback models
app.post('/api/translate', async (req, res) => {
  try {
    const { segments, targetLanguage = 'vi', model } = req.body;
    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return res.status(400).json({ error: 'Danh sách đoạn phụ đề trống.' });
    }

    const ai = getAI();
    const numbered = segments
      .map((seg: { id: number; text: string }, idx: number) => `${idx + 1}. ${seg.text}`)
      .join('\n');

    const prompt =
      `Bạn là biên dịch viên chuyên nghiệp. Dịch các câu sau sang tiếng Việt tự nhiên, ` +
      `giữ đúng văn phong nói chuyện (video, lồng tiếng), không giải thích thêm gì cả. ` +
      `Trả lời DUY NHẤT một danh sách đánh số, mỗi dòng một câu dịch, ` +
      `đúng theo thứ tự và số lượng dòng như đầu vào:\n\n${numbered}`;

    const defaultFallbackModels = [
      'gemini-3.8-flash',
      'gemini-3.6-flash',
      'gemini-3.6-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.4-flash',
      'gemini-3.2-flash',
      'gemini-3.1-flash',
    ];

    const fallbackModels = model
      ? [model, ...defaultFallbackModels.filter(m => m !== model)]
      : defaultFallbackModels;

    let translatedText = '';
    let usedModel = '';
    let lastError: unknown = null;

    for (const modelName of fallbackModels) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            temperature: 0.3,
          },
        });
        if (response.text) {
          translatedText = response.text;
          usedModel = modelName;
          break;
        }
      } catch (err) {
        console.warn(`Model ${modelName} failed, trying next fallback:`, err);
        lastError = err;
      }
    }

    if (!translatedText) {
      throw lastError || new Error('Không thể tạo bản dịch từ Gemini');
    }

    // Parse numbered lines matching Python script logic
    const lines = translatedText
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    const parsedResults: string[] = [];
    for (const line of lines) {
      const match = line.match(/^(\d+)[\.\)]\s*(.*)$/);
      if (match) {
        parsedResults.push(match[2].trim());
      } else {
        parsedResults.push(line);
      }
    }

    // Align with expected segments count
    const updatedSegments = segments.map((seg, idx) => ({
      ...seg,
      text_vi: parsedResults[idx] || seg.text_vi || '',
    }));

    res.json({
      success: true,
      usedModel,
      segments: updatedSegments,
    });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'Lỗi xử lý bản dịch';
    console.error('Translation error:', error);
    res.status(500).json({
      success: false,
      error: errMsg,
    });
  }
});

// Export configured Python script (main.py and config)
app.post('/api/export-script', (req, res) => {
  const {
    inputVideo = 'C:\\Users\\thangnc\\Downloads\\haha.mp4',
    whisperModel = 'small',
    ttsMode = 'turbo',
    ttsVoice = 'Minh Quân Pro',
    ttsPrecision = 'fp32',
    burnSubtitles = true,
    subtitleBox = true,
    subtitleBoxOpacity = 0.6,
    originalVolume = 0.2,
  } = req.body;

  const pythonScript = `"""
Công cụ dịch video sang tiếng Việt: phụ đề + lồng tiếng.
Cấu hình xuất từ VietDub AI Web Interface.
Chạy: python main.py
"""

import os
import sys
import json
import math
import time
import subprocess

# ======================= CONFIG - XUẤT TỪ GIAO DIỆN WEB =======================
INPUT_VIDEO = r"${inputVideo}"
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

WHISPER_MODEL_SIZE = "${whisperModel}"
SOURCE_LANG = None
TTS_MODE = "${ttsMode}"
TTS_PRECISION = "${ttsPrecision}"
TTS_VOICE = "${ttsVoice}"
BURN_SUBTITLES = ${burnSubtitles ? 'True' : 'False'}
SUBTITLE_BOX = ${subtitleBox ? 'True' : 'False'}
SUBTITLE_BOX_OPACITY = ${subtitleBoxOpacity}
ORIGINAL_VOLUME = ${originalVolume}
OUTPUT_DIR = "output"

GEMINI_MODEL_FALLBACK_LIST = [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3-flash-preview",
]
# ==============================================================================

# (Kế thừa toàn bộ logic main.py đã tích hợp trong repo)
print(f"[+] Khởi động VietDub với giọng: {TTS_VOICE} ({TTS_MODE}), âm lượng nền: {ORIGINAL_VOLUME:.0%}")
`;

  res.json({
    success: true,
    script: pythonScript,
    filename: 'main.py',
  });
});

// Download local_backend.py endpoint
app.get('/api/download-local-backend', (req, res) => {
  const filePath = path.join(process.cwd(), 'local_backend.py');
  if (fs.existsSync(filePath)) {
    res.download(filePath, 'local_backend.py');
  } else {
    res.status(404).send('File not found');
  }
});

// Download start.py endpoint
app.get('/api/download-start-py', (req, res) => {
  const filePath = path.join(process.cwd(), 'start.py');
  if (fs.existsSync(filePath)) {
    res.download(filePath, 'start.py');
  } else {
    res.status(404).send('File not found');
  }
});

// Download run.bat endpoint
app.get('/api/download-run-bat', (req, res) => {
  const filePath = path.join(process.cwd(), 'run.bat');
  if (fs.existsSync(filePath)) {
    res.download(filePath, 'run.bat');
  } else {
    res.status(404).send('File not found');
  }
});

function tryStartPythonBackend() {
  // Check if port 8000 is already active
  const testReq = http.get('http://127.0.0.1:8000/health', res => {
    if (res.statusCode === 200) {
      console.log('✅ Python Local Engine is already running on port 8000.');
    }
  });

  testReq.on('error', () => {
    const pyScript = path.join(process.cwd(), 'local_backend.py');
    if (fs.existsSync(pyScript)) {
      console.log('🚀 Auto-starting Python Local Engine (local_backend.py) on port 8000...');
      try {
        const pyProc = spawn('python', [pyScript], { stdio: 'inherit', shell: true });
        pyProc.on('error', err => {
          console.log('⚠️ Notice: Could not auto-start python backend:', err.message);
        });
      } catch {
        // Python might not be installed in the container, which is normal
      }
    }
  });
}

async function startServer() {
  tryStartPythonBackend();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VietDub AI Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
