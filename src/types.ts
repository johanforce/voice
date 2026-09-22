export type TTSMode = 'turbo' | 'v3nano';

export type Gender = 'Nam' | 'Nữ';
export type Region = 'Miền Bắc' | 'Miền Nam' | 'Miền Trung';

export interface VoiceProfile {
  id: string;
  name: string;
  mode: TTSMode;
  gender: Gender;
  region: Region;
  style: string;
  description: string;
  sampleText: string;
  tags: string[];
  pitch: number; // 0.8 to 1.2
  speed: number; // 0.9 to 1.15
  color: string;
  waveformSeed: number;
}

export interface SubtitleSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  text_vi: string;
  isCustomEdited?: boolean;
}

export interface PipelineConfig {
  videoUrl: string;
  videoTitle: string;
  videoDuration: number;
  whisperModel: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3';
  ttsMode: TTSMode;
  ttsVoice: string;
  ttsPrecision: 'fp32' | 'int8';
  originalVolume: number; // 0 to 1
  burnSubtitles: boolean;
  subtitleBox: boolean;
  subtitleBoxOpacity: number; // 0 to 1
  fontSize: number;
  geminiModel: string;
}

export type PipelineStep = 1 | 2 | 3 | 4 | 5;

export interface StepStatus {
  step: PipelineStep;
  title: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  progress: number; // 0 - 100
  detail: string;
}
