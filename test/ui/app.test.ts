// Teststelle 2: die echte App in Electron, gesteuert mit Playwright im Testmodus.

import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { launchCodium } from '../support/launchApp';
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
      expect(result).toEqual({ stat: 'ok', pool: '16' });
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
