// Protokoll der Sprachserver (Ticket 30): Ringpuffer für stderr und die Grössengrenze der Protokolldatei.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatEntry, LanguageServerLog, TailBuffer, type ServerStopEntry } from '../../src/main/core/language/serverLog';
import { useTempDirs } from '../support/tempDir';

function entry(over: Partial<ServerStopEntry> = {}): ServerStopEntry {
  return {
    time: new Date(2026, 10, 24, 14, 35, 2, 7),
    project: 'C:\\Projekte\\Shapes',
    server: 'TypeScript',
    kind: 'bundled-native',
    command: 'C:\\Codium\\tsc.exe',
    args: ['--lsp', '--stdio'],
    code: 2,
    signal: null,
    outcome: 'Restarting (restart 1 of 3 within three minutes).',
    stderr: { text: 'panic: boom\n\ngoroutine 1 [running]:\nmain.main()\n', truncated: false },
    ...over,
  };
}

describe('Ringpuffer für stderr', () => {
  it('behält alles, solange die Grenze nicht erreicht ist', () => {
    const tail = new TailBuffer(100);
    tail.push(Buffer.from('eins\n'));
    tail.push(Buffer.from('zwei\n'));
    expect(tail.read()).toEqual({ text: 'eins\nzwei\n', truncated: false });
  });

  it('behält nur die letzten Bytes und beginnt dann an einer ganzen Zeile', () => {
    const tail = new TailBuffer(64);
    for (let i = 1; i <= 50; i++) tail.push(Buffer.from(`line ${String(i).padStart(3, '0')}\n`));
    const { text, truncated } = tail.read();
    expect(truncated).toBe(true);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(64);
    expect(text.startsWith('line ')).toBe(true);
    expect(text.endsWith('line 050\n')).toBe(true);
    expect(text).not.toContain('line 001');
  });

  it('kommt mit einem einzelnen Stück über der Grenze zurecht', () => {
    const tail = new TailBuffer(16);
    tail.push(Buffer.from('a'.repeat(40) + '\nende\n'));
    expect(tail.read()).toEqual({ text: 'ende\n', truncated: true });
  });
});

describe('Protokolldatei', () => {
  const tempDir = useTempDirs();

  it('schreibt einen lesbaren Eintrag mit Server, Art, Programm, Exit-Code und stderr', async () => {
    const file = path.join(tempDir(), 'logs', 'language-servers.log');
    const log = new LanguageServerLog(file);
    await log.append(entry());
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toContain('=== 2026-11-24 14:35:02.007 – TypeScript language server stopped unexpectedly ===');
    expect(text).toContain('Project: C:\\Projekte\\Shapes');
    expect(text).toContain('Server:  TypeScript (bundled-native)');
    expect(text).toContain('Program: C:\\Codium\\tsc.exe --lsp --stdio');
    expect(text).toContain('Exit:    code 2');
    expect(text).toContain('Then:    Restarting (restart 1 of 3 within three minutes).');
    expect(text).toContain('--- stderr ---\npanic: boom\n\ngoroutine 1 [running]:\nmain.main()\n--- end of stderr ---');
    expect(await log.read()).toBe(text);
  });

  it('nennt ein Signal, eine Notiz, gekürztes und leeres stderr', () => {
    const killed = formatEntry(entry({ code: null, signal: 'SIGTERM', note: 'Stopped by Codium while starting: no answer', stderr: { text: 'x\n', truncated: true } }));
    expect(killed).toContain('Exit:    signal SIGTERM');
    expect(killed).toContain('Note:    Stopped by Codium while starting: no answer');
    expect(killed).toContain('--- stderr (last 64 KB) ---');
    expect(formatEntry(entry({ stderr: { text: '', truncated: false } }))).toContain('--- stderr: (empty) ---');
  });

  it('ersetzt das Protokoll, bevor es die Grenze überschreitet; das alte bleibt als .old.log', async () => {
    const dir = tempDir();
    const file = path.join(dir, 'language-servers.log');
    const log = new LanguageServerLog(file, { maxBytes: 2000 });
    for (let i = 1; i <= 12; i++) {
      await log.append(entry({ outcome: `Eintrag ${i}`, stderr: { text: `${'s'.repeat(300)}\n`, truncated: false } }));
      expect(fs.statSync(file).size).toBeLessThanOrEqual(2000);
    }
    const current = fs.readFileSync(file, 'utf8');
    const old = fs.readFileSync(log.oldFile, 'utf8');
    expect(path.basename(log.oldFile)).toBe('language-servers.old.log');
    expect(current).toContain('Then:    Eintrag 12');
    expect(current.startsWith('=== ')).toBe(true);
    expect(old).toContain('Then:    Eintrag');
    expect(old).not.toContain('Then:    Eintrag 12');
    // Mehr als zwei Dateien gibt es nie.
    expect(fs.readdirSync(dir).sort()).toEqual(['language-servers.log', 'language-servers.old.log']);
  });

  it('kürzt einen einzelnen Eintrag über der Grenze hinten', async () => {
    const file = path.join(tempDir(), 'language-servers.log');
    const log = new LanguageServerLog(file, { maxBytes: 1000 });
    await log.append(entry({ stderr: { text: 'ü'.repeat(3000), truncated: false } }));
    const text = fs.readFileSync(file, 'utf8');
    expect(fs.statSync(file).size).toBeLessThanOrEqual(1000);
    expect(text).toContain('Exit:    code 2');
    expect(text).toContain('… (cut to fit the log size)');
    expect(text).not.toContain('\uFFFD');
  });

  it('schreibt gleichzeitige Einträge nacheinander und meldet Fehler, statt zu werfen', async () => {
    const dir = tempDir();
    const file = path.join(dir, 'language-servers.log');
    const log = new LanguageServerLog(file);
    await Promise.all([1, 2, 3, 4, 5].map((i) => log.append(entry({ outcome: `Eintrag ${i}` }))));
    const text = fs.readFileSync(file, 'utf8');
    for (let i = 1; i <= 5; i++) expect(text.split(`Then:    Eintrag ${i}\n`)).toHaveLength(2);
    // Ein Ordner, wo die Datei liegen soll: Der Fehler landet im Protokoll von Codium.
    const messages: string[] = [];
    const blocked = new LanguageServerLog(dir, { log: (m) => messages.push(m) });
    await expect(blocked.append(entry())).resolves.toBeUndefined();
    expect(messages.join('\n')).toMatch(/Protokoll der Sprachserver nicht geschrieben/);
    expect(await new LanguageServerLog(path.join(dir, 'fehlt.log')).read()).toBe('');
  });
});
