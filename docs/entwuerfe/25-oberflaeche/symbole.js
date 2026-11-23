// Erzeugt; Quelle der neuen Symbole ist symbole/icons-neu.tsx (gleiche Pfade). Die bestehenden stammen aus
// src/renderer/icons.tsx und dienen nur den Bildern.
window.CODIUM_SYMBOLE = {
 "fetch": {
  "name": "FetchIcon",
  "size": 16,
  "neu": true,
  "filled": false,
  "title": "Fetch",
  "use": "Symbolknopf rechts in der Titelzeile des Branch-Dropdowns (Tooltip „Fetch“).",
  "inner": "<path d=\"M4.6 10.5H4a2.5 2.5 0 0 1-.3-4.98 4.2 4.2 0 0 1 8.1-.9A2.9 2.9 0 0 1 12 10.5h-.6\"/><path d=\"M8 7.5v7M5.9 12.4 8 14.5l2.1-2.1\"/>"
 },
 "pull": {
  "name": "PullIcon",
  "size": 16,
  "neu": true,
  "filled": false,
  "title": "Pull",
  "use": "Aktionszeile „Pull“ (Ctrl+T). Pfeil in der Farbe für Eingehendes (blau), wie die Pfeile „zurück“.",
  "inner": "<path class=\"icon-incoming\" d=\"M8 2.5v8M4.8 7.3 8 10.5l3.2-3.2\"/><path d=\"M3 13.5h10\"/>"
 },
 "push": {
  "name": "PushIcon",
  "size": 16,
  "neu": true,
  "filled": false,
  "title": "Push…",
  "use": "Aktionszeile „Push…“ (Ctrl+Shift+K). Pfeil in der Farbe für Ausgehendes (grün), wie die Pfeile „voraus“.",
  "inner": "<path class=\"icon-outgoing\" d=\"M8 13.5v-8M4.8 8.7 8 5.5l3.2 3.2\"/><path d=\"M3 2.5h10\"/>"
 },
 "branch-current": {
  "name": "BranchCurrentIcon",
  "size": 16,
  "neu": true,
  "filled": false,
  "title": "Aktueller Branch",
  "use": "Statt des Texts „current“: gefülltes Etikett in der HEAD-Farbe des Git-Logs (gelb).",
  "inner": "<path class=\"icon-head\" fill-rule=\"evenodd\" d=\"M3.5 3.5h6.8l3.7 4.5-3.7 4.5H3.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM7.3 8a1.3 1.3 0 1 1-2.6 0 1.3 1.3 0 1 1 2.6 0z\"/>"
 },
 "incoming": {
  "name": "IncomingIcon",
  "size": 12,
  "neu": true,
  "filled": false,
  "title": "Zurück (eingehend)",
  "use": "Kleiner Pfeil vor der Zahl der Commits, die der Branch hinter seinem Remote liegt (blau). Auch in der Kopfzeile.",
  "inner": "<path class=\"icon-incoming\" d=\"M8 2.5v11M3.8 9.3 8 13.5l4.2-4.2\"/>"
 },
 "outgoing": {
  "name": "OutgoingIcon",
  "size": 12,
  "neu": true,
  "filled": false,
  "title": "Voraus (ausgehend)",
  "use": "Kleiner Pfeil vor der Zahl der Commits, die noch nicht gepusht sind (grün). Auch in der Kopfzeile.",
  "inner": "<path class=\"icon-outgoing\" d=\"M8 13.5v-11M3.8 6.7 8 2.5l4.2 4.2\"/>"
 },
 "checkout": {
  "name": "CheckoutIcon",
  "size": 16,
  "neu": true,
  "filled": false,
  "title": "Checkout",
  "use": "Untermenü eines Branches: „Checkout“ (Pfeil zum Commit).",
  "inner": "<path d=\"M1.5 8h7M5.8 5.3 8.5 8l-2.7 2.7\"/><circle cx=\"12\" cy=\"8\" r=\"2.3\"/>"
 },
 "trash": {
  "name": "DeleteIcon",
  "size": 16,
  "neu": true,
  "filled": false,
  "title": "Delete",
  "use": "Untermenü eines Branches: „Delete“; Rechtsklick-Menü im Baum: „Delete…“.",
  "inner": "<path d=\"M2.5 4.5h11M6 4.5V3a.8.8 0 0 1 .8-.8h2.4a.8.8 0 0 1 .8.8v1.5M4 4.5l.6 8.6a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.6M6.6 7v4.5M9.4 7v4.5\"/>"
 },
 "copy": {
  "name": "CopyIcon",
  "size": 16,
  "neu": true,
  "filled": false,
  "title": "Copy",
  "use": "Rechtsklick-Menü im Baum: „Copy“.",
  "inner": "<rect x=\"5.5\" y=\"5.5\" width=\"8\" height=\"8.5\" rx=\"1.2\"/><path d=\"M3.5 10.5H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h6.5a1 1 0 0 1 1 1v.5\"/>"
 },
 "paste": {
  "name": "PasteIcon",
  "size": 16,
  "neu": true,
  "filled": false,
  "title": "Paste",
  "use": "Rechtsklick-Menü im Baum: „Paste“.",
  "inner": "<path d=\"M5.5 3H4a1 1 0 0 0-1 1v9.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-1.5\"/><rect x=\"5.5\" y=\"1.8\" width=\"5\" height=\"2.4\" rx=\"0.8\"/>"
 },
 "edit": {
  "name": "RenameIcon",
  "size": 16,
  "neu": true,
  "filled": false,
  "title": "Rename… (zur Wahl)",
  "use": "Nur falls gewünscht: „Rename…“ im Branch-Untermenü und im Baum. Im Vorschlag bleibt der Platz frei.",
  "inner": "<path d=\"M10.6 2.6a1.4 1.4 0 0 1 2 0l.8.8a1.4 1.4 0 0 1 0 2L6 12.8l-3.3.7.7-3.3zM9.4 3.8l2.8 2.8\"/>"
 },
 "gear": {
  "name": "SettingsIcon",
  "size": 16,
  "neu": true,
  "filled": false,
  "title": "Settings…",
  "use": "Projektmenü: „Settings…“.",
  "inner": "<path d=\"M6.37 3.27L6.72 1.42A6.7 6.7 0 0 1 9.28 1.42L9.63 3.27A5 5 0 0 1 11.28 4.23L13.06 3.6A6.7 6.7 0 0 1 14.33 5.82L12.91 7.05A5 5 0 0 1 12.91 8.95L14.33 10.18A6.7 6.7 0 0 1 13.06 12.4L11.28 11.77A5 5 0 0 1 9.63 12.73L9.28 14.58A6.7 6.7 0 0 1 6.72 14.58L6.37 12.73A5 5 0 0 1 4.72 11.77L2.94 12.4A6.7 6.7 0 0 1 1.67 10.18L3.09 8.95A5 5 0 0 1 3.09 7.05L1.67 5.82A6.7 6.7 0 0 1 2.94 3.6L4.72 4.23A5 5 0 0 1 6.37 3.27Z\"/><circle cx=\"8\" cy=\"8\" r=\"2\"/>"
 },
 "project": {
  "name": "ProjectIcon",
  "size": 18,
  "neu": false,
  "filled": false,
  "title": "",
  "use": "",
  "inner": "<path d=\"M1.5 3.5a1 1 0 0 1 1-1h3.6l1.6 1.6h5.8a1 1 0 0 1 1 1v7.4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z\"/>"
 },
 "commit": {
  "name": "CommitIcon",
  "size": 18,
  "neu": false,
  "filled": false,
  "title": "",
  "use": "",
  "inner": "<circle cx=\"8\" cy=\"8\" r=\"2.6\"/><path d=\"M0.8 8h4.6M10.6 8h4.6\"/>"
 },
 "terminal": {
  "name": "TerminalIcon",
  "size": 18,
  "neu": false,
  "filled": false,
  "title": "",
  "use": "",
  "inner": "<rect x=\"1.5\" y=\"2.5\" width=\"13\" height=\"11\" rx=\"1.5\"/><path d=\"M4.5 6l2 2-2 2M8.5 10.5h3\"/>"
 },
 "git": {
  "name": "GitIcon",
  "size": 18,
  "neu": false,
  "filled": false,
  "title": "",
  "use": "",
  "inner": "<circle cx=\"4.5\" cy=\"3.5\" r=\"1.6\"/><circle cx=\"4.5\" cy=\"12.5\" r=\"1.6\"/><circle cx=\"11.5\" cy=\"5.5\" r=\"1.6\"/><path d=\"M4.5 5.1v5.8M11.5 7.1c0 2.4-3 2.2-6.4 4\"/>"
 },
 "find": {
  "name": "FindIcon",
  "size": 18,
  "neu": false,
  "filled": false,
  "title": "",
  "use": "",
  "inner": "<circle cx=\"7\" cy=\"7\" r=\"4.5\"/><path d=\"M10.4 10.4l4 4\"/>"
 },
 "database": {
  "name": "DatabaseIcon",
  "size": 18,
  "neu": false,
  "filled": false,
  "title": "",
  "use": "",
  "inner": "<ellipse cx=\"8\" cy=\"3.8\" rx=\"5.5\" ry=\"2\"/><path d=\"M2.5 3.8v8.4c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V3.8M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2\"/>"
 },
 "chevron-down": {
  "name": "ChevronDownIcon",
  "size": 12,
  "neu": false,
  "filled": false,
  "title": "",
  "use": "",
  "inner": "<path d=\"M4 6l4 4 4-4\"/>"
 },
 "chevron-right": {
  "name": "ChevronRightIcon",
  "size": 12,
  "neu": false,
  "filled": false,
  "title": "",
  "use": "",
  "inner": "<path d=\"M6 4l4 4-4 4\"/>"
 },
 "folder": {
  "name": "FolderIcon",
  "size": 16,
  "neu": false,
  "filled": true,
  "title": "",
  "use": "",
  "inner": "<path d=\"M1.5 3.5a1 1 0 0 1 1-1h3.6l1.6 1.6h5.8a1 1 0 0 1 1 1v7.4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z\"/>"
 },
 "file": {
  "name": "FileIcon",
  "size": 16,
  "neu": false,
  "filled": false,
  "title": "",
  "use": "",
  "inner": "<path d=\"M4 1.5h5.2L12.5 4.8v9.2a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5z\"/><path d=\"M9 1.7V5h3.3\"/>"
 },
 "locate": {
  "name": "LocateIcon",
  "size": 16,
  "neu": false,
  "filled": false,
  "title": "",
  "use": "",
  "inner": "<circle cx=\"8\" cy=\"8\" r=\"4.5\"/><circle cx=\"8\" cy=\"8\" r=\"1.2\"/><path d=\"M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15\"/>"
 },
 "collapse": {
  "name": "CollapseAllIcon",
  "size": 16,
  "neu": false,
  "filled": false,
  "title": "",
  "use": "",
  "inner": "<path d=\"M4.5 6.5L8 3l3.5 3.5M4.5 13L8 9.5l3.5 3.5\"/>"
 },
 "hide": {
  "name": "HideIcon",
  "size": 16,
  "neu": false,
  "filled": false,
  "title": "",
  "use": "",
  "inner": "<path d=\"M4 8h8\"/>"
 },
 "plus": {
  "name": "PlusIcon",
  "size": 16,
  "neu": false,
  "filled": false,
  "title": "",
  "use": "",
  "inner": "<path d=\"M8 3v10M3 8h10\"/>"
 },
 "branch": {
  "name": "BranchIcon",
  "size": 16,
  "neu": false,
  "filled": false,
  "title": "",
  "use": "",
  "inner": "<path d=\"M5 3v10M5 9c0-3 6-2 6-5M5 13a1.5 1.5 0 1 0 0-.01M11 4a1.5 1.5 0 1 0 0-.01M5 3a1.5 1.5 0 1 0 0-.01\"/>"
 },
 "close": {
  "name": "CloseIcon",
  "size": 12,
  "neu": false,
  "filled": false,
  "title": "",
  "use": "",
  "inner": "<path d=\"M4 4l8 8M12 4l-8 8\"/>"
 }
};
