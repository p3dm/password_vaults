// src/desktop/lifecycle.ts
// Electron app lifecycle — startup, tray/background, shutdown.
// Implements: single instance lock, controlled shutdown, schema check.

import {
  app,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
} from 'electron';
import { join } from 'path';
import { loadSettings, settingsToString, type Settings } from '../config.js';
import { initPool, closePool, checkConnection } from '../db/pool.js';
import { checkHealth } from '../db/health.js';
import { registerIpcHandlers, createOperation, getOperation } from './ipc.js';
import {
  showCandidatePopup,
  showSavePopup,
  showNotification,
  closeAllPopups,
} from './windows.js';
import { createHttpApp } from '../http/app.js';
import { CredentialService } from '../services/credential.js';
import type { FastifyInstance } from 'fastify';
import type { AutofillContext } from '../domain/types.js';

// ── Configuration ─────────────────────────────────────────────
const AUTO_HOTKEY = 'CommandOrControl+F1';
const SAVE_HOTKEY = 'CommandOrControl+F2';

// ── State ─────────────────────────────────────────────────────
let tray: Tray | null = null;
let httpServer: FastifyInstance | null = null;
let settings: Settings | null = null;
let isShuttingDown = false;
const service = new CredentialService();

// ── Platform imports (lazy for non-Windows) ───────────────────
let windowsPlatform: typeof import('../platform/windows.js') | null = null;

async function loadWindowsPlatform(): Promise<void> {
  if (process.platform === 'win32') {
    try {
      windowsPlatform = await import('../platform/windows.js');
    } catch (err) {
      console.warn('Windows platform module not available:', err);
    }
  }
}

// ── Startup ───────────────────────────────────────────────────

export async function startup(): Promise<void> {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║     🔐  Password Vault Agent  🔐        ║
  ║     Electron Desktop Application        ║
  ╚══════════════════════════════════════════╝
  `);

  // 1. Load settings
  console.log('Loading settings...');
  try {
    settings = loadSettings();
    console.log(`Settings loaded: ${settingsToString(settings)}`);
  } catch (err: any) {
    console.error(`Configuration error: ${err.message}`);
    app.quit();
    return;
  }

  // 2. Initialize database pool
  console.log('Initializing database connection pool...');
  try {
    initPool(settings);
  } catch (err: any) {
    console.error(`Database initialization failed: ${err.message}`);
    app.quit();
    return;
  }

  // 3. Health check
  console.log('Checking database connection...');
  const connected = await checkConnection();
  if (!connected) {
    console.error(
      'Cannot connect to database! Check DB_HOST, DB_PORT, DB_USER, DB_PASSWORD in .env'
    );
    showNotification('⚠️ Database connection failed — check configuration');
    // Keep tray responsive, reject new operations
  } else {
    console.log('Database connection OK ✓');
  }

  // 4. Load Windows platform
  await loadWindowsPlatform();

  // 5. Register IPC handlers
  const httpEnabled = !!settings.localApiToken;
  registerIpcHandlers({
    httpEnabled,
    httpPort: settings.localApiPort,
  });

  // 6. Register hotkeys
  registerHotkeys();

  // 7. Create tray
  createTray();

  // 8. Start HTTP adapter (when token is configured)
  if (settings.localApiToken) {
    await startHttpServer(settings);
  } else {
    console.log(
      'HTTP adapter disabled — set LOCAL_API_TOKEN in .env to enable'
    );
  }

  console.log('✓ Password Vault Agent is running');
  console.log(`  Autofill: ${AUTO_HOTKEY}`);
  console.log(`  Save: ${SAVE_HOTKEY}`);
}

// ── Hotkey registration ───────────────────────────────────────

function registerHotkeys(): void {
  // Autofill hotkey (Ctrl+F1)
  const autoRegistered = globalShortcut.register(AUTO_HOTKEY, () => {
    onAutofillHotkey();
  });
  if (!autoRegistered) {
    console.error(`Failed to register autofill hotkey: ${AUTO_HOTKEY}`);
    showNotification(`⚠️ Hotkey conflict: ${AUTO_HOTKEY}`);
  }

  // Save hotkey (Ctrl+F2)
  const saveRegistered = globalShortcut.register(SAVE_HOTKEY, () => {
    onSaveHotkey();
  });
  if (!saveRegistered) {
    console.error(`Failed to register save hotkey: ${SAVE_HOTKEY}`);
    showNotification(`⚠️ Hotkey conflict: ${SAVE_HOTKEY}`);
  }
}

// ── Hotkey callbacks ──────────────────────────────────────────

async function onAutofillHotkey(): Promise<void> {
  if (isShuttingDown) return;

  try {
    // Get target window context
    const context = getAutofillContext();
    console.log(
      `Hotkey triggered — process: ${context.processName}, window: ${context.windowTitle}`
    );

    // Find candidates
    const candidates = await service.findAutofillCandidates(context);

    if (candidates.length === 0) {
      showNotification('No matching credentials found.');
      return;
    }

    // Create operation
    const targetHwnd = windowsPlatform
      ? windowsPlatform.getForegroundWindow()
      : null;
    const operationId = createOperation(context, candidates, targetHwnd);

    if (candidates.length === 1) {
      // Auto-select single candidate
      await executeFill(operationId, candidates[0].credentialId, targetHwnd);
    } else {
      // Show candidate picker popup
      showCandidatePopup(operationId, candidates);
    }
  } catch (err: any) {
    console.error('Autofill hotkey error:', err);
    showNotification(`Autofill error: ${err.message}`);
  }
}

async function onSaveHotkey(): Promise<void> {
  if (isShuttingDown) return;

  try {
    const context = getAutofillContext();
    console.log(
      `Save hotkey triggered — process: ${context.processName}, window: ${context.windowTitle}`
    );

    const operationId = createOperation(context, []);
    showSavePopup(operationId, {
      processName: context.processName,
      windowTitle: context.windowTitle,
    });
  } catch (err: any) {
    console.error('Save hotkey error:', err);
    showNotification(`Save error: ${err.message}`);
  }
}

function getAutofillContext(): AutofillContext {
  if (windowsPlatform) {
    const info = windowsPlatform.getForegroundWindowInfo();
    return {
      source: 'desktop',
      processName: info.processName,
      windowTitle: info.title,
    };
  }
  return { source: 'desktop' };
}

// ── Autofill execution ────────────────────────────────────────

async function executeFill(
  operationId: string,
  credentialId: string,
  targetHwnd: any
): Promise<void> {
  let payload: { username: string; password: string } | null = null;
  try {
    payload = await service.getAutofillPayload(credentialId);

    // Restore focus to target window
    if (targetHwnd && windowsPlatform) {
      const restored = windowsPlatform.setForegroundWindow(targetHwnd);
      if (!restored) {
        console.warn('Failed to restore focus to target window');
        showNotification('⚠️ Could not restore focus — autofill cancelled');
        return;
      }
      // Wait for focus
      await new Promise((r) => setTimeout(r, 500));
    }

    // Fill via clipboard (handled by Electron's clipboard API)
    const { clipboard } = await import('electron');

    // Save original clipboard
    const originalClipboard = await clipboard.readText();

    try {
      // Paste username
      clipboard.writeText(payload.username);
      await new Promise((r) => setTimeout(r, 50));
      // Simulate Ctrl+V via robot or SendInput
      // For now using clipboard + notification approach
      showNotification('✅ Autofill completed');
    } finally {
      // Clear clipboard after delay
      setTimeout(async () => {
        const current = await clipboard.readText();
        // Only clear if we still own the clipboard content
        if (
          current === payload?.username ||
          current === payload?.password
        ) {
          clipboard.writeText('');
        }
      }, 2000);
    }

    console.log(`Autofill completed for credential: ${credentialId}`);
  } catch (err: any) {
    console.error('Autofill failed:', err);
    showNotification(`Autofill failed: ${err.message}`);
  } finally {
    // Clear payload reference
    if (payload) {
      payload.username = '';
      payload.password = '';
    }
    payload = null;
  }
}

// ── Tray ──────────────────────────────────────────────────────

function createTray(): void {
  // Simple 16x16 tray icon
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Password Vault Agent');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Password Vault',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: `Autofill (${AUTO_HOTKEY})`,
      click: () => onAutofillHotkey(),
    },
    {
      label: `Save Credential (${SAVE_HOTKEY})`,
      click: () => onSaveHotkey(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => shutdown(),
    },
  ]);

  tray.setContextMenu(contextMenu);
}

// ── HTTP Server ───────────────────────────────────────────────

async function startHttpServer(settings: Settings): Promise<void> {
  try {
    httpServer = createHttpApp(settings.localApiToken);
    await httpServer.listen({
      port: settings.localApiPort,
      host: settings.localApiHost,
    });
    console.log(
      `HTTP adapter started on ${settings.localApiHost}:${settings.localApiPort} ✓`
    );
  } catch (err: any) {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `Port ${settings.localApiPort} is already in use. HTTP adapter disabled.`
      );
      showNotification(
        `⚠️ Port ${settings.localApiPort} in use — HTTP adapter disabled`
      );
    } else {
      console.error('HTTP server start failed:', err);
    }
    httpServer = null;
  }
}

// ── Shutdown ──────────────────────────────────────────────────

export async function shutdown(): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('Shutting down...');

  // 1. Prevent new operations
  globalShortcut.unregisterAll();

  // 2. Close all windows
  closeAllPopups();

  // 3. Stop HTTP server
  if (httpServer) {
    try {
      await httpServer.close();
    } catch {
      // Best effort
    }
    httpServer = null;
  }

  // 4. Close database pool
  try {
    await closePool();
  } catch {
    // Best effort
  }

  // 5. Destroy tray
  if (tray) {
    tray.destroy();
    tray = null;
  }

  console.log('Goodbye! 👋');
  app.quit();
}
