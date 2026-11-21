// Rückfragen als Dialog in der Oberfläche statt als Dialog von Windows (Spezifikation, Präzisierung 29): Titel,
// Text, eine Liste von Einträgen (etwa betroffene Dateien) und Knöpfe. Alle Tickets fragen über `useAsk` nach; die
// Antwort ist die Kennung des gewählten Knopfs, `null` bei Escape. Mehrere Rückfragen kommen nacheinander.

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface AskButton {
  /** Was `ask` zurückgibt, wenn dieser Knopf gewählt wird. */
  id: string;
  label: string;
  /** Der vorgeschlagene Knopf: hervorgehoben, mit dem Fokus, Enter wählt ihn. */
  primary?: boolean;
}

export interface AskOptions {
  title: string;
  message: string;
  /** Betroffene Einträge, etwa Dateien oder Pfade; lange Listen lassen sich scrollen. */
  items?: string[];
  /** Knöpfe in der Reihenfolge der Anzeige, wie unter Windows der bestätigende zuerst, „Cancel“ zuletzt. */
  buttons: AskButton[];
}

/** Stellt eine Rückfrage; liefert die Kennung des gewählten Knopfs oder `null`, wenn sie mit Escape abgebrochen wurde. */
export type Ask = (options: AskOptions) => Promise<string | null>;

interface PendingQuestion {
  id: number;
  options: AskOptions;
  resolve: (choice: string | null) => void;
}

const AskContext = createContext<Ask | null>(null);
let nextQuestionId = 1;

/** Die Rückfragen eines Fensters; zeigt jeweils die älteste offene. */
export function DialogHost({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<PendingQuestion[]>([]);
  const ask = useCallback<Ask>(
    (options) =>
      new Promise((resolve) => {
        const question = { id: nextQuestionId++, options, resolve };
        setQueue((q) => [...q, question]);
      }),
    [],
  );
  const current = queue[0];
  const answer = useCallback(
    (choice: string | null) => {
      if (!current) return;
      setQueue((q) => q.filter((pending) => pending !== current));
      current.resolve(choice);
    },
    [current],
  );

  return (
    <AskContext value={ask}>
      {children}
      {current && <AskDialog key={current.id} options={current.options} onAnswer={answer} />}
    </AskContext>
  );
}

/** Die Funktion für Rückfragen; nur innerhalb von `DialogHost`. */
export function useAsk(): Ask {
  const ask = useContext(AskContext);
  if (!ask) throw new Error('useAsk braucht einen DialogHost.');
  return ask;
}

/** Ob gerade eine Rückfrage offen ist; Tastenkürzel der App ruhen dann. */
export function isDialogOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

/** Was sich in einem Dialog mit Tab erreichen lässt. */
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';

function AskDialog({ options, onAnswer }: { options: AskOptions; onAnswer: (choice: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const messageId = useId();
  const answerRef = useRef(onAnswer);
  answerRef.current = onAnswer;

  // Den Fokus auf den vorgeschlagenen Knopf, danach zurück, wo er vorher war.
  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = ref.current;
    (el?.querySelector<HTMLElement>('[data-primary]') ?? el?.querySelector<HTMLElement>('button'))?.focus();
    return () => previous?.focus({ preventScroll: true });
  }, []);

  // In der Capture-Phase, vor anderen Tastenbelegungen: Escape bricht ab, Tab bleibt im Dialog.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        answerRef.current(null);
      } else if (e.key === 'Tab' && ref.current) {
        keepFocusInside(e, ref.current);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const { title, message, items, buttons } = options;
  return createPortal(
    <div className="dialog-overlay">
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId}>
        <div className="dialog-title" id={titleId}>
          {title}
        </div>
        <div className="dialog-body">
          <p className="dialog-message" id={messageId}>
            {message}
          </p>
          {items && items.length > 0 && (
            <ul className="dialog-items" aria-label="Affected items">
              {items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="dialog-buttons">
          {buttons.map((button) => (
            <button
              key={button.id}
              type="button"
              className={button.primary ? 'button-primary' : undefined}
              data-primary={button.primary ? '' : undefined}
              onClick={() => onAnswer(button.id)}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Hält Tab und Shift + Tab im Dialog: Am Ende geht es zum Anfang und umgekehrt. */
function keepFocusInside(e: KeyboardEvent, container: HTMLElement): void {
  const focusable = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)];
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const inside = container.contains(document.activeElement);
  if (e.shiftKey && (document.activeElement === first || !inside)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
    e.preventDefault();
    first.focus();
  }
}
