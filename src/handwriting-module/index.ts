/**
 * Public API of the handwriting module. A host application (e.g. ClinicFlow)
 * should import only from here. Nothing in this module depends on patients,
 * appointments, prescriptions or billing.
 */
export { HandwritingEditor } from './HandwritingEditor';
export type { HandwritingEditorProps, HandwritingEditorHandle, EditorStatus } from './HandwritingEditor';

export type { HandwritingRecognitionProvider } from '../recognition/HandwritingRecognitionProvider';
export { MyScriptProvider } from '../recognition/MyScriptProvider';
export { UnavailableProvider } from '../recognition/UnavailableProvider';
export { RecognitionManager } from '../recognition/RecognitionManager';

export type { StorageAdapter } from '../storage/StorageAdapter';
export { MemoryStorage } from '../storage/StorageAdapter';
export { IndexedDBStorage } from '../storage/IndexedDBStorage';

export { buildSnapshot, documentToPlainText } from '../state/snapshot';

export type {
  HandwritingDocument,
  HandwritingSnapshot,
  PageSnapshot,
  PageData,
  TextBlock,
  DocumentSummary,
} from '../types/document';
export type { Stroke, ToolState } from '../types/handwriting';
export type {
  RecognitionResult,
  RecognitionStatus,
  RecognizedLine,
  RecognizedWord,
  ProviderAvailability,
} from '../types/recognition';
export { RecognitionError } from '../types/recognition';
