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

  it('beginnt ohne ganze Zeile am ersten ganzen Zeichen, nie mitten in einem UTF-8-Zeichen', () => {
    // Ohne Zeilenumbruch: 18 Bytes „€“ (je 3), die letzten 10 beginnen mit dem dritten Byte eines Zeichens.
    const noLine = new TailBuffer(10);
    noLine.push(Buffer.from('€'.repeat(6)));
    expect(noLine.read()).toEqual({ text: '€€€', truncated: true });
    // Nur eine Zeile, die am Ende aufhört: 17 Bytes, die letzten 10 beginnen mit dem zweiten Byte eines Zeichens.
    const oneLine = new TailBuffer(10);
    oneLine.push(Buffer.from(`${'€'.repeat(5)}x\n`));
    expect(oneLine.read()).toEqual({ text: '€€x\n', truncated: true });
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
    // „Show Log“ bekommt erst das ersetzte, dann das aktuelle Protokoll.
    expect(await log.readAll()).toBe(old + current);
  });

  it('hängt den Eintrag an, auch wenn sich das Protokoll nicht ersetzen lässt', async () => {
    // Ein nicht leerer Ordner, wo das ersetzte Protokoll hin soll: Das Umbenennen scheitert (wie unter Windows, wenn ein
    // anderes Programm die Datei offen hält).
    const dir = tempDir();
    const file = path.join(dir, 'language-servers.log');
    const messages: string[] = [];
    const log = new LanguageServerLog(file, { maxBytes: 1000, log: (m) => messages.push(m) });
    fs.mkdirSync(log.oldFile);
    fs.writeFileSync(path.join(log.oldFile, 'blockiert'), '');
    await log.append(entry({ outcome: 'Eintrag 1' }));
    await log.append(entry({ outcome: 'Eintrag 2', stderr: { text: `${'s'.repeat(700)}\n`, truncated: false } }));
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toContain('Then:    Eintrag 1');
    expect(text).toContain('Then:    Eintrag 2');
    expect(messages.join('\n')).toMatch(/Protokoll der Sprachserver nicht ersetzt, der Eintrag kommt trotzdem dazu/);
  });

  it('kürzt einen einzelnen Eintrag über der Grenze hinten, nie mitten in einem Zeichen', async () => {
    // Mit 0, 1 bzw. 2 ASCII-Zeichen vor lauter „€“ (3 Bytes) fällt die Grenze an jede Stelle eines Zeichens.
    for (const lead of ['', 'a', 'ab']) {
      const file = path.join(tempDir(), 'language-servers.log');
      const log = new LanguageServerLog(file, { maxBytes: 1000 });
      await log.append(entry({ stderr: { text: lead + '€'.repeat(1000), truncated: false } }));
      const text = fs.readFileSync(file, 'utf8');
      expect(fs.statSync(file).size, `Vorlauf „${lead}“`).toBeLessThanOrEqual(1000);
      expect(text).toContain('Exit:    code 2');
      expect(text).toContain('€\n… (cut to fit the log size)');
      expect(text.includes(String.fromCharCode(0xfffd)), `Vorlauf „${lead}“`).toBe(false);
    }
  });

  it('schreibt gleichzeitige Einträge nacheinander, auch wenn das Protokoll dabei ersetzt wird', async () => {
    // Je Datei passen zwei Einträge: Die Warteschlange muss Ersetzen und Anhängen nacheinander erledigen.
    const dir = tempDir();
    const file = path.join(dir, 'language-servers.log');
    const one = Buffer.byteLength(formatEntry(entry({ outcome: 'Eintrag 1' })));
    const log = new LanguageServerLog(file, { maxBytes: 2 * one + 10 });
    await Promise.all([1, 2, 3, 4, 5, 6, 7].map((i) => log.append(entry({ outcome: `Eintrag ${i}` }))));
    expect(fs.statSync(file).size).toBeLessThanOrEqual(2 * one + 10);
    expect(fs.statSync(log.oldFile).size).toBeLessThanOrEqual(2 * one + 10);
    const all = await log.readAll();
    // Ganze Einträge in der Reihenfolge des Anhängens, ohne Lücke und mit dem letzten zuletzt.
    const order = [...all.matchAll(/^Then:    Eintrag (\d)$/gm)].map((m) => Number(m[1]));
    expect(order.length).toBeGreaterThanOrEqual(3);
    expect(order).toEqual(order.map((_, i) => 8 - order.length + i));
    expect(all.split('=== ').length - 1).toBe(order.length);
    expect(all.split('--- end of stderr ---').length - 1).toBe(order.length);
  });

  it('meldet Fehler, statt zu werfen, und schreibt danach weiter, auch wenn die Meldung selbst scheitert', async () => {
    const dir = tempDir();
    // Ein Ordner, wo die Datei liegen soll: Der Fehler geht an `log`, nie als Ausnahme.
    const messages: string[] = [];
    const blocked = new LanguageServerLog(dir, { log: (m) => messages.push(m) });
    await expect(blocked.append(entry())).resolves.toBeUndefined();
    expect(messages.join('\n')).toMatch(/Protokoll der Sprachserver nicht geschrieben/);
    expect(await new LanguageServerLog(path.join(dir, 'fehlt.log')).read()).toBe('');
    // Wirft auch `log`, bleibt die Warteschlange benutzbar: Ist der Weg frei, kommt der nächste Eintrag an.
    const file = path.join(dir, 'später.log');
    fs.mkdirSync(file);
    const throwing = new LanguageServerLog(file, {
      log: () => {
        throw new Error('Meldung gescheitert');
      },
    });
    await expect(throwing.append(entry({ outcome: 'Eintrag 1' }))).resolves.toBeUndefined();
    fs.rmdirSync(file);
    await expect(throwing.append(entry({ outcome: 'Eintrag 2' }))).resolves.toBeUndefined();
    expect(fs.readFileSync(file, 'utf8')).toContain('Then:    Eintrag 2');
  });

  it('wartet beim Beenden auf vorbereitete Einträge, höchstens bis zur Frist', async () => {
    const file = path.join(tempDir(), 'language-servers.log');
    const log = new LanguageServerLog(file);
    // Ein Eintrag, der erst nach 300 ms geschrieben wird (wie einer, der auf den Rest von stderr wartet).
    log.track(new Promise<void>((resolve) => setTimeout(resolve, 300)).then(() => log.append(entry({ outcome: 'Eintrag spät' }))));
    await log.idle(5000);
    expect(fs.readFileSync(file, 'utf8')).toContain('Then:    Eintrag spät');
    // Einer, der nie fertig wird, hält das Beenden höchstens bis zur Frist auf.
    log.track(new Promise(() => {}));
    const started = Date.now();
    await log.idle(200);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
