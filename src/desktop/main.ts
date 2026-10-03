// src/desktop/main.ts
// Electron entry point and composition root.
// Owns: app lifecycle, single instance lock, service initialization.

import { app } from 'electron';
import { startup, shutdown } from './lifecycle.js';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  if (require('electron-squirrel-startup')) {
    app.quit();
  }
} catch {
  // electron-squirrel-startup not available in development
}

// ── Single instance lock ──────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is running — quit immediately
  console.log('Another instance is already running. Exiting.');
  app.quit();
} else {
  app.on('second-instance', () => {
    // Focus existing relevant window when second launch attempts
    console.log('Second instance detected — focusing existing instance.');
  });

  // ── App ready ─────────────────────────────────────────────
  app.whenReady().then(async () => {
    try {
      await startup();
    } catch (err) {
      console.error('Startup failed:', err);
      app.quit();
    }
  });

  // ── Keep app running when all windows close (tray mode) ───
  app.on('window-all-closed', () => {
    // Don't quit — we run as a tray/background agent
  });

  // ── Graceful shutdown ─────────────────────────────────────
  app.on('before-quit', async (event) => {
    event.preventDefault();
    await shutdown();
  });

  // Handle system signals
  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());
}
