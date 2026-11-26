// Das Symbol einer Datei in Listen ausserhalb des Baums (Datei-Tabs, „Recent Files“, „Go to File“): bei Java-Dateien das
// Symbol ihrer Art (Ticket 32), sonst das Dateisymbol. Angefragt wird die Art von der Liste (`JavaKindStore.ensure`);
// bis sie feststeht, gilt das allgemeine Java-Symbol.

import { FileIcon, JavaKindIcon } from '../icons';
import { isJavaFileName, useJavaKinds } from './javaKinds';

export function FileTypeIcon({ path }: { path: string }) {
  const javaKinds = useJavaKinds();
  if (!isJavaFileName(path)) return <FileIcon />;
  return <JavaKindIcon kind={javaKinds?.kindOf(path) ?? 'java'} />;
}
