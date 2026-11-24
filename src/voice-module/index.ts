/**
 * Public API of the voice-to-text module (for ClinicFlow). Independent of the
 * handwriting module; no patient / appointment / billing concepts.
 */
export { VoiceToTextEditor } from './VoiceToTextEditor';
export type { VoiceToTextEditorProps, VoiceToTextEditorHandle, VoiceEditorStatus } from './VoiceToTextEditor';

export type {
  SpeechRecognitionProvider,
  SpeechSession,
  SpeechSessionOptions,
  SpeechProviderCapabilities,
} from '../recognition/speech/SpeechRecognitionProvider';
export { WhisperServerProvider } from '../recognition/speech/WhisperServerProvider';
export { BrowserSpeechProvider } from '../recognition/speech/BrowserSpeechProvider';
export { SpeechServerClient } from '../recognition/speech/SpeechServerClient';

export type { VoiceStorageAdapter } from '../storage/VoiceStorage';
export { IndexedDBVoiceStorage } from '../storage/VoiceStorage';
export { buildVoiceSnapshot, transcriptText } from '../state/voiceText';
export { score as scoreTranscript } from '../recognition/speech/evaluation';

export type {
  SpeechLanguage,
  TranscriptSegment,
  RecordingInfo,
  VoiceDocument,
  VoiceSnapshot,
  EvaluationResult,
} from '../types/speech';
export { SPEECH_LANGUAGES, SpeechError } from '../types/speech';
