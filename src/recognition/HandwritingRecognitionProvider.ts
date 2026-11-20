import type {
  IncrementalRecognitionRequest,
  ProviderAvailability,
  ProviderCapabilities,
  RecognitionRequest,
  RecognitionResult,
} from '../types/recognition';

/**
 * Contract every recognition engine implements. React components never talk to
 * a provider directly; they go through RecognitionManager, so engines can be
 * swapped (MyScript today, ML Kit / an on-device engine later) without UI changes.
 *
 * Implementations must:
 *  - receive real digital ink (stroke coordinates + timing), never screenshots;
 *  - honour `request.signal` so stale requests can be cancelled;
 *  - throw `RecognitionError` with an accurate `kind` / `retryable` flag;
 *  - return line + word structure with stroke IDs when they can
 *    (`capabilities.wordStrokeMapping`), which drives ink ↔ text synchronisation.
 */
export interface HandwritingRecognitionProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;

  /** Cheap check used for status display (credentials configured, endpoint reachable…). */
  checkAvailability(): Promise<ProviderAvailability>;

  /** Recognise the complete ink of one page. Used after any change, including erasing. */
  recognizePage(request: RecognitionRequest): Promise<RecognitionResult>;

  /**
   * Optional incremental path for engines that keep server/on-device state.
   * RecognitionManager falls back to `recognizePage` when this is absent.
   */
  recognizeIncremental?(request: IncrementalRecognitionRequest): Promise<RecognitionResult>;

  dispose?(): void;
}
