// Teststelle 2: die echte App in Electron, gesteuert mit Playwright im Testmodus.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WM_ACTIVATE } from '../../src/main/testMode';
import { launchCodium, prepareAppState } from '../support/launchApp';
import { extendedWindowStyle, WS_EX_NOACTIVATE } from '../support/nativeWindow';
import { useTempDirs } from '../support/tempDir';

describe('App im Testmodus', () => {
  const tempDir = useTempDirs();

  it('startet unsichtbar, zeigt die Oberfläche über den Vertrag, zeichnet auf und beendet sich wieder', async () => {
    const codium = await launchCodium({ dataRoot: tempDir() });
    try {
      const page = await codium.page('Welcome to Codium');
      await expect.poll(() => page.locator('h1').textContent(), { timeout: 15_000 }).toBe('Codium');
      // Die Version kommt über den Vertrag aus dem Kern.
      await expect
        .poll(() => page.locator('.welcome-version').textContent(), { timeout: 15_000 })
        .toMatch(/^Version \d+\.\d+\.\d+/);

      // Die Schutzversprechen des Testmodus: auf keinem Bildschirm sichtbar, ohne Fokus. Windows setzt die Lage
      // nicht genau auf die verlangten -32000, deshalb wird gegen alle Bildschirme geprüft.
      const windows = await codium.app.evaluate(({ BrowserWindow, screen }) => {
        const displays = screen.getAllDisplays().map((d) => d.bounds);
        return BrowserWindow.getAllWindows().map((w) => {
          const b = w.getBounds();
          const onSomeDisplay = displays.some(
            (d) => b.x < d.x + d.width && b.x + b.width > d.x && b.y < d.y + d.height && b.y + b.height > d.y,
          );
          return { bounds: b, onSomeDisplay, focused: w.isFocused() };
        });
      });
      expect(windows).toHaveLength(1);
      expect(windows[0].onSomeDisplay, JSON.stringify(windows[0].bounds)).toBe(false);
      expect(windows[0].focused).toBe(false);

      // Code und Daten eines gescheiterten Befehls kommen unverändert über die Brücke in die Oberfläche.
      const failed = await page.evaluate(() =>
        (window as unknown as { codium: { invoke(name: string): Promise<unknown> } }).codium.invoke('gibt.es.nicht'),
      );
      expect(failed).toEqual({ ok: false, error: { message: 'Unknown command: gibt.es.nicht', code: 'UNKNOWN_COMMAND' } });

      const recorded = await codium.recorded();
      expect(recorded.map((e) => e.kind)).toContain('window-opened');
    } finally {
      await codium.close();
    }
  });

  it('öffnet Fenster, die Windows nicht aktivieren kann; Fokus und Eingaben in der Seite gehen trotzdem (Ticket 27)', async () => {
    // Ein aktivierbares Testfenster nähme Windows als nächstes Vordergrundfenster, wenn der Nutzer sein eigenes
    // schliesst oder minimiert; seine Eingaben landeten dann im unsichtbaren Fenster.
    const alpha = path.join(tempDir(), 'Alpha');
    fs.mkdirSync(alpha, { recursive: true });
    fs.writeFileSync(path.join(alpha, 'notes.txt'), 'hello\n');
    const dataRoot = tempDir();
    prepareAppState(dataRoot, { openProjects: [alpha], recentProjects: [alpha] });
    const codium = await launchCodium({ dataRoot });
    try {
      const page = await codium.page('Alpha – Codium');
      const windows = await codium.app.evaluate(
        ({ BrowserWindow }, message) =>
          BrowserWindow.getAllWindows().map((w) => ({
            hwnd: w.getNativeWindowHandle().readBigUInt64LE(0).toString(),
            focusable: w.isFocusable(),
            activationHooked: w.isWindowMessageHooked(message),
          })),
        WM_ACTIVATE,
      );
      expect(windows).toHaveLength(1);
      expect(windows[0].focusable).toBe(false);
      // So sieht Windows das Fenster (nur gelesen): WS_EX_NOACTIVATE ist gesetzt.
      expect(extendedWindowStyle(BigInt(windows[0].hwnd)) & WS_EX_NOACTIVATE).toBe(WS_EX_NOACTIVATE);
      // Eine Aktivierung trotz allem käme in die Aufzeichnung, und `close()` meldete sie.
      expect(windows[0].activationHooked).toBe(true);

      // In der Seite geht Fokus weiter: Fokus-Ereignisse, :focus und Tastatureingaben im Editor.
      await page.evaluate(() => {
        const seen: string[] = [];
        (window as unknown as { focusEvents: string[] }).focusEvents = seen;
        document.addEventListener('focusin', (event) => seen.push((event.target as Element).closest('.editor-host') ? 'editor' : 'other'));
      });
      const tree = page.getByRole('tree', { name: 'Project Files' });
      await tree.getByRole('treeitem', { name: 'notes.txt', exact: true }).dblclick({ timeout: 15_000 });
      await page.locator('.editor-host .view-lines').click({ timeout: 15_000 });
      await expect.poll(() => page.locator('.editor-host :focus').count(), { timeout: 10_000 }).toBe(1);
      expect(await page.evaluate(() => document.hasFocus())).toBe(true);
      expect(await page.evaluate(() => (window as unknown as { focusEvents: string[] }).focusEvents)).toContain('editor');
      await page.keyboard.press('Control+End');
      await page.keyboard.type('fokus');
      await expect
        .poll(() => page.locator('.editor-host .view-lines').innerText(), { timeout: 10_000 })
        .toMatch(/fokus/);

      // Windows hat das Fenster dabei nie aktiviert.
      expect(await codium.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isFocused()))).toBe(false);
      expect((await codium.recorded()).filter((e) => e.kind === 'window-activated')).toEqual([]);
    } finally {
      await codium.close();
    }
  });

  it('hat im Hauptprozess einen grösseren Threadpool, damit hängende Dateiabfragen nicht alles aufhalten', async () => {
    const codium = await launchCodium({ dataRoot: tempDir() });
    try {
      await codium.page('Welcome to Codium');
      // Sechs Lesevorgänge auf eine Pipe, die nie antwortet, belegen sechs Threads. Mit den 4 Threads, die libuv
      // ohne Einstellung hat, käme eine Dateiabfrage danach nicht mehr durch.
      const result = await codium.app.evaluate(async () => {
        const fs = process.getBuiltinModule('node:fs') as typeof import('node:fs');
        const net = process.getBuiltinModule('node:net') as typeof import('node:net');
        const pipePath = `\\\\.\\pipe\\codium-ui-test-${process.pid}`;
        const sockets: Array<import('node:net').Socket> = [];
        const server = net.createServer((socket) => {
          socket.on('error', () => {});
          sockets.push(socket);
        });
        await new Promise<void>((resolve) => server.listen(pipePath, resolve));
        const handles = [];
        for (let i = 0; i < 6; i++) handles.push(await fs.promises.open(pipePath, 'r'));
        const reads = handles.map((h) => h.read(Buffer.alloc(1), 0, 1, null).catch(() => undefined));
        await new Promise((resolve) => setTimeout(resolve, 200));
        const stat = await Promise.race([
          fs.promises.stat(process.execPath).then(() => 'ok'),
          new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 2000)),
        ]);
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await Promise.all(reads);
        for (const handle of handles) await handle.close().catch(() => undefined);
        return { stat, pool: process.env.UV_THREADPOOL_SIZE };
      });
      // Die Abfrage kam durch, und die Variable ist wieder weg, damit Kindprozesse sie nicht erben.
      expect(result.stat).toBe('ok');
      expect(result.pool).toBeUndefined();
    } finally {
      await codium.close();
    }
  });

  it('verweigert den Start ohne Testmodus oder mit einem Datenordner ausserhalb des Temp-Ordners', async () => {
    await expect(launchCodium({ dataRoot: tempDir(), env: { CODIUM_TEST_HIDDEN: '' } })).rejects.toThrow(/Testmodus/);
    await expect(launchCodium({ dataRoot: tempDir(), env: { CODIUM_TEST_DATA_DIR: '' } })).rejects.toThrow(/Testmodus/);
    const outside = path.join(os.homedir(), 'codium-test-nicht-hier');
    await expect(launchCodium({ dataRoot: tempDir(), env: { CODIUM_TEST_DATA_DIR: outside } })).rejects.toThrow(/Temp-Ordner/);
  });
});
