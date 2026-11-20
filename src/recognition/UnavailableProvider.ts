import type { HandwritingRecognitionProvider } from './HandwritingRecognitionProvider';
import { RecognitionError, type ProviderAvailability, type RecognitionResult } from '../types/recognition';

/**
 * Explicit "no recognition engine" provider. It never invents text: the editor
 * keeps working as a handwriting notebook, and the UI shows that recognition is
 * not configured.
 */
export class UnavailableProvider implements HandwritingRecognitionProvider {
  readonly id = 'none';
  readonly displayName = 'No recognition engine';
  readonly capabilities = { incremental: false, requiresNetwork: false, wordStrokeMapping: false, languages: [] };

  constructor(private readonly reason = 'Handwriting recognition is disabled (VITE_RECOGNITION_PROVIDER=none).') {}

  async checkAvailability(): Promise<ProviderAvailability> {
    return { available: false, requiresNetwork: false, reason: this.reason };
  }

  async recognizePage(): Promise<RecognitionResult> {
    throw new RecognitionError('not-configured', this.reason);
  }
}
