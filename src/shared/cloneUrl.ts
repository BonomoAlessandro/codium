// Der Ordnername für einen Klon aus der Adresse des Repositorys, wie Git ihn wählt: der letzte Teil des Pfads ohne
// „.git“ und ohne abschliessende Schrägstriche. Für HTTPS, SSH in Kurzform (`git@host:pfad/name.git`) und lokale Pfade.
// Ohne Node und ohne DOM: Kern und Oberfläche nutzen sie.

export function folderNameFromUrl(url: string): string {
  let rest = url.trim().replace(/[\\/]+$/, '');
  // Query und Fragment gehören nicht zum Namen.
  rest = rest.replace(/[?#].*$/, '');
  rest = rest.replace(/\.git$/i, '').replace(/[\\/]+$/, '');
  // Nach dem letzten „/“, „\“ oder (SSH-Kurzform) „:“.
  const cut = Math.max(rest.lastIndexOf('/'), rest.lastIndexOf('\\'), rest.lastIndexOf(':'));
  const name = rest.slice(cut + 1);
  // Unter Windows verbotene Zeichen fallen weg.
  return name.replace(/[<>:"|?*]/g, '').trim();
}
