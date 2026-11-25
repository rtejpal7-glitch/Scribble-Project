import type { SpeechEngineId } from '../../types/speech';
import type { SpeechRecognitionProvider } from './SpeechRecognitionProvider';
import { WhisperServerProvider } from './WhisperServerProvider';
import { BrowserSpeechProvider } from './BrowserSpeechProvider';

/**
 * User-level voice settings, stored in this browser only (never in the app
 * bundle). The server token is entered by the user, like a password.
 */
export interface SpeechSettings {
  engine: SpeechEngineId;
  serverUrl: string;
  serverToken: string;
  /** Explicit consent required before audio is sent to Apple/Google. */
  browserConsent: boolean;
  /** Keep recordings (WAV) on this device after transcription. Off by default. */
  retainAudio: boolean;
  autoPunctuation: boolean;
  /** Start a new paragraph after this much silence between utterances (seconds). */
  paragraphPauseSec: number;
  /** Terms (drug names, conditions) used to bias recognition. */
  vocabulary: string;
  /** Suggest corrections for sentences that don't make sense (local AI model on the speech server). */
  sentenceCheck: boolean;
}

const KEY = 'inkflow:speech-settings';

export function defaultSpeechSettings(): SpeechSettings {
  return {
    engine: 'server',
    serverUrl: import.meta.env.VITE_SPEECH_SERVER_URL || 'http://localhost:8765',
    serverToken: '',
    browserConsent: false,
    retainAudio: false,
    autoPunctuation: true,
    paragraphPauseSec: 4,
    vocabulary: '',
    sentenceCheck: true,
  };
}

export function loadSpeechSettings(): SpeechSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaultSpeechSettings(), ...(JSON.parse(raw) as Partial<SpeechSettings>) };
  } catch {
    /* ignore */
  }
  return defaultSpeechSettings();
}

export function saveSpeechSettings(s: SpeechSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function createSpeechProvider(s: SpeechSettings): { provider: SpeechRecognitionProvider | null; reason?: string } {
  if (s.engine === 'browser') {
    if (!s.browserConsent)
      return { provider: null, reason: 'The browser engine sends audio to Apple or Google. Allow it in Voice settings to use it.' };
    return { provider: new BrowserSpeechProvider() };
  }
  return { provider: new WhisperServerProvider({ url: s.serverUrl, token: s.serverToken }) };
}
