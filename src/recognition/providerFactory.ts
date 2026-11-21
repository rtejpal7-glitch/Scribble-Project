import type { HandwritingRecognitionProvider } from './HandwritingRecognitionProvider';
import { MyScriptProvider } from './MyScriptProvider';
import { UnavailableProvider } from './UnavailableProvider';

/**
 * Picks the provider from build-time config. Add new engines here
 * (e.g. 'mlkit' → MLKitProvider, 'local' → LocalRecognitionProvider).
 */
export function createDefaultProvider(): HandwritingRecognitionProvider {
  const env = import.meta.env;
  const kind = (env.VITE_RECOGNITION_PROVIDER ?? 'myscript').toLowerCase();
  switch (kind) {
    case 'myscript':
      return new MyScriptProvider({ endpoint: env.VITE_RECOGNITION_ENDPOINT || '/api/recognize' });
    case 'none':
      return new UnavailableProvider();
    default:
      return new UnavailableProvider(`Unknown recognition provider "${kind}".`);
  }
}

export function defaultDebounceMs(): number {
  const v = Number(import.meta.env.VITE_RECOGNITION_DEBOUNCE_MS);
  return Number.isFinite(v) && v >= 200 && v <= 5000 ? v : 500;
}
