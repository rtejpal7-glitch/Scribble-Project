/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'myscript' (default) or 'none'. */
  readonly VITE_RECOGNITION_PROVIDER?: string;
  /** Same-origin recognition proxy path. Default '/api/recognize'. */
  readonly VITE_RECOGNITION_ENDPOINT?: string;
  /** Writing pause before recognition, ms (200–5000). Default 500. */
  readonly VITE_RECOGNITION_DEBOUNCE_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
