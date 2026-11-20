// Echte Ports „Ordnerauswahl“, „Geheimnisse“ und „Shell-Aktionen“ mit Electron, samt Testmodus.

import { BrowserWindow, clipboard, dialog, safeStorage, shell } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FolderPickerPort, SecretsPort, ShellActionsPort } from '../core/ports';
import type { TestMode, TestRecorder } from '../testMode';

/** Ordnerdialog von Windows; im Testmodus kommt die Antwort aus `CODIUM_TEST_PICK_DIR`. */
export class ElectronFolderPicker implements FolderPickerPort {
  constructor(
    private readonly testMode: TestMode,
    private readonly recorder: TestRecorder,
  ) {}

  async pickFolder(options: { windowId?: number; title: string }): Promise<string | null> {
    if (this.testMode.hidden) {
      const picked = this.testMode.pickDir ?? null;
      this.recorder.record('folder-picked', { title: options.title, picked });
      return picked;
    }
    const parent = options.windowId === undefined ? null : BrowserWindow.fromId(options.windowId);
    const dialogOptions: Electron.OpenDialogOptions = { title: options.title, properties: ['openDirectory'] };
    const result = parent ? await dialog.showOpenDialog(parent, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  }
}

/** Verschlüsselung von Windows für das Benutzerkonto (DPAPI über Electron). */
export class ElectronSecrets implements SecretsPort {
  available(): Promise<boolean> {
    return safeStorage.isAsyncEncryptionAvailable();
  }

  async encrypt(plain: string): Promise<string> {
    return (await safeStorage.encryptStringAsync(plain)).toString('base64');
  }

  async decrypt(encrypted: string): Promise<string> {
    return (await safeStorage.decryptStringAsync(Buffer.from(encrypted, 'base64'))).result;
  }
}

/**
 * Papierkorb, Explorer und Zwischenablage. Im Testmodus ist der Papierkorb ein Ordner im Datenordner, und
 * Explorer und Zwischenablage werden nur aufgezeichnet (die Zwischenablage lebt dann im Speicher).
 */
export class ElectronShellActions implements ShellActionsPort {
  private testClipboard = '';

  constructor(
    private readonly testMode: TestMode,
    private readonly recorder: TestRecorder,
    /** Papierkorb-Ordner im Testmodus. */
    private readonly testTrashDir: string,
  ) {}

  async trash(targetPath: string): Promise<void> {
    if (!this.testMode.hidden) {
      await shell.trashItem(targetPath);
      return;
    }
    fs.mkdirSync(this.testTrashDir, { recursive: true });
    const destination = path.join(this.testTrashDir, `${Date.now()}-${path.basename(targetPath)}`);
    try {
      fs.renameSync(targetPath, destination);
    } catch {
      // Anderes Laufwerk: kopieren und löschen.
      fs.cpSync(targetPath, destination, { recursive: true });
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
    this.recorder.record('trash', { path: targetPath, movedTo: destination });
  }

  showInExplorer(targetPath: string): void {
    if (this.testMode.hidden) {
      this.recorder.record('show-in-explorer', { path: targetPath });
      return;
    }
    shell.showItemInFolder(targetPath);
  }

  async writeClipboard(text: string): Promise<void> {
    if (this.testMode.hidden) {
      this.testClipboard = text;
      this.recorder.record('clipboard-write', { text });
      return;
    }
    await clipboard.writeText(text);
  }

  async readClipboard(): Promise<string> {
    return this.testMode.hidden ? this.testClipboard : clipboard.readText();
  }
}
