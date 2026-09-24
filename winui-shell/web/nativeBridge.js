/**
 * nativeBridge.js — web side of the WebView2 native bridge.
 *
 * WinUI host side: NativeBridge.cs (CoreWebView2.WebMessageReceived)
 * Web side: window.chrome.webview.postMessage() + 'message' events.
 *
 * Usage:
 *   await nativeHost.call('power.status');                 // request/response
 *   nativeHost.on('power.updated', data => {...});         // host-pushed events
 *   nativeHost.post({ channel: 'custom', args: [] });      // fire-and-forget
 */
(() => {
  'use strict';

  if (!window.chrome?.webview) {
    // Not running inside WebView2 (plain browser, or Electron without the shim).
    window.nativeHost = null;
    return;
  }

  let seq = 0;
  const pending = new Map();        // id -> { resolve, reject }
  const eventListeners = new Map(); // event name -> Set<listener>

  /**
   * Call a native action exposed by the WinUI host.
   * Sends { id, action, payload } and resolves with the host's result.
   */
  function call(action, payload = {}) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      window.chrome.webview.postMessage({ id, action, payload });
    });
  }

  /** Subscribe to host-pushed events. Returns an unsubscribe function. */
  function on(event, listener) {
    if (!eventListeners.has(event)) eventListeners.set(event, new Set());
    eventListeners.get(event).add(listener);
    return () => eventListeners.get(event).delete(listener);
  }

  window.chrome.webview.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;

    // Host-pushed event (no id).
    if (msg.event) {
      (eventListeners.get(msg.event) ?? new Set()).forEach((fn) => {
        try { fn(msg.data); } catch (err) { console.error('[nativeBridge] listener failed', err); }
      });
      return;
    }

    // Response to a call().
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error(msg.error ?? 'Native call failed'));
  });

  window.nativeHost = {
    available: true,
    call,
    on,
    post: (data) => window.chrome.webview.postMessage(data),
  };
})();
