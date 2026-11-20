/**
 * Registers the service worker in production builds only (a worker in dev mode
 * caches Vite's modules and causes confusing stale reloads).
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(async (reg) => {
        await navigator.serviceWorker.ready;
        // Ask the worker to cache every file of this build for offline use.
        (reg.active ?? navigator.serviceWorker.controller)?.postMessage({ type: 'PRECACHE' });
        reg.update().catch(() => undefined);
      })
      .catch((err) => console.warn('Service worker registration failed', err));
  });
}
