// Rückfragen als Dialog in der Oberfläche statt als Dialog von Windows (Spezifikation, Präzisierung 29): Titel,
// Text, eine Liste von Einträgen (etwa betroffene Dateien) und Knöpfe. Alle Tickets fragen über `useAsk` nach; die
// Antwort ist die Kennung des gewählten Knopfs, `null` bei Escape. Mehrere Rückfragen kommen nacheinander.
//
// Eingaben (etwa ein neuer Dateiname) fragt `useAskText` ab: ein Textfeld mit laufender Prüfung und, wie in
// IntelliJ, einem Fehler direkt im Dialog, wenn die Ausführung scheitert.

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

export interface AskTextOptions {
  title: string;
  /** Beschriftung über dem Feld. */
  message?: string;
  /** Anfangswert des Felds. */
  value?: string;
  /** Markierung beim Öffnen als [Anfang, Ende); ohne Angabe ist alles markiert. */
  selection?: [number, number];
  /** Prüft die Eingabe laufend; eine Meldung heisst, dass sie nicht geht („OK“ ist dann inaktiv). */
  validate?: (value: string) => string | null;
  /** Hinweis unter dem Feld, etwa dass Verweise nicht angepasst werden. */
  hint?: string;
  /** Beschriftung des bestätigenden Knopfs, sonst „OK“. */
  okLabel?: string;
  /**
   * Führt die Eingabe aus, bevor sich der Dialog schliesst. Liefert sie eine Meldung, bleibt der Dialog offen und
   * zeigt sie (etwa „already exists“).
   */
  submit?: (value: string) => Promise<string | null | undefined | void>;
}

/** Fragt eine Eingabe ab; liefert sie nach „OK“ (und erfolgreichem `submit`) oder `null` nach „Cancel“ und Escape. */
export type AskText = (options: AskTextOptions) => Promise<string | null>;

type PendingQuestion =
  | { id: number; kind: 'buttons'; options: AskOptions; resolve: (choice: string | null) => void }
  | { id: number; kind: 'text'; options: AskTextOptions; resolve: (value: string | null) => void };

const AskContext = createContext<{ ask: Ask; askText: AskText } | null>(null);
let nextQuestionId = 1;

/** Die Rückfragen eines Fensters; zeigt jeweils die älteste offene. */
export function DialogHost({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<PendingQuestion[]>([]);
  const ask = useCallback<Ask>(
    (options) =>
      new Promise((resolve) => {
        const question: PendingQuestion = { id: nextQuestionId++, kind: 'buttons', options, resolve };
        setQueue((q) => [...q, question]);
      }),
    [],
  );
  const askText = useCallback<AskText>(
    (options) =>
      new Promise((resolve) => {
        const question: PendingQuestion = { id: nextQuestionId++, kind: 'text', options, resolve };
        setQueue((q) => [...q, question]);
      }),
    [],
  );
  const [value] = useState(() => ({ ask, askText }));
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
    <AskContext value={value}>
      {children}
      {current?.kind === 'buttons' && <AskDialog key={current.id} options={current.options} onAnswer={answer} />}
      {current?.kind === 'text' && <TextDialog key={current.id} options={current.options} onAnswer={answer} />}
    </AskContext>
  );
}

/** Die Funktion für Rückfragen; nur innerhalb von `DialogHost`. */
export function useAsk(): Ask {
  const context = useContext(AskContext);
  if (!context) throw new Error('useAsk braucht einen DialogHost.');
  return context.ask;
}

/** Die Funktion für Eingaben; nur innerhalb von `DialogHost`. */
export function useAskText(): AskText {
  const context = useContext(AskContext);
  if (!context) throw new Error('useAskText braucht einen DialogHost.');
  return context.askText;
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

function TextDialog({ options, onAnswer }: { options: AskTextOptions; onAnswer: (value: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const messageId = useId();
  const errorId = useId();
  const [value, setValue] = useState(options.value ?? '');
  /** Meldung einer gescheiterten Ausführung; gilt, bis der Nutzer weitertippt. */
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const state = useRef({ busy, onAnswer });
  state.current = { busy, onAnswer };

  // Fokus ins Feld mit der gewünschten Markierung, danach zurück, wo er vorher war.
  useLayoutEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const input = inputRef.current;
    if (input) {
      input.focus();
      const [start, end] = options.selection ?? [0, input.value.length];
      input.setSelectionRange(start, end);
    }
    return () => previous?.focus({ preventScroll: true });
    // Nur beim Öffnen.
  }, []);

  // Escape bricht ab (nicht während der Ausführung), Tab bleibt im Dialog.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!state.current.busy) state.current.onAnswer(null);
      } else if (e.key === 'Tab' && ref.current) {
        keepFocusInside(e, ref.current);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const problem = value === '' ? '' : (options.validate?.(value) ?? null);
  const shown = failure ?? (problem || null);
  const canSubmit = value !== '' && problem === null && !busy;

  const confirm = async () => {
    if (!canSubmit) return;
    if (!options.submit) {
      onAnswer(value);
      return;
    }
    setBusy(true);
    try {
      const error = await options.submit(value);
      if (error) {
        setFailure(error);
        setBusy(false);
        return;
      }
    } catch (err) {
      console.error(err);
      setFailure('Something went wrong. Please try again.');
      setBusy(false);
      return;
    }
    onAnswer(value);
  };

  // Nach einem Fehler wieder ins Feld, damit man gleich korrigieren kann.
  useEffect(() => {
    if (!busy) inputRef.current?.focus({ preventScroll: true });
  }, [busy]);

  return createPortal(
    <div className="dialog-overlay">
      <div
        ref={ref}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={options.message ? messageId : undefined}
      >
        <div className="dialog-title" id={titleId}>
          {options.title}
        </div>
        <form
          className="dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            void confirm();
          }}
        >
          {options.message && (
            <label className="dialog-label" id={messageId} htmlFor={`${titleId}-input`}>
              {options.message}
            </label>
          )}
          <input
            ref={inputRef}
            id={`${titleId}-input`}
            className={shown ? 'dialog-input invalid' : 'dialog-input'}
            type="text"
            spellCheck={false}
            autoComplete="off"
            value={value}
            disabled={busy}
            aria-label={options.message ? undefined : options.title}
            aria-invalid={shown ? true : undefined}
            aria-errormessage={shown ? errorId : undefined}
            onChange={(e) => {
              setValue(e.target.value);
              setFailure(null);
            }}
          />
          {shown && (
            <p className="dialog-error" id={errorId} role="alert">
              {shown}
            </p>
          )}
          {options.hint && <p className="dialog-hint">{options.hint}</p>}
        </form>
        <div className="dialog-buttons">
          <button type="button" className="button-primary" disabled={!canSubmit} onClick={() => void confirm()}>
            {options.okLabel ?? 'OK'}
          </button>
          <button type="button" disabled={busy} onClick={() => onAnswer(null)}>
            Cancel
          </button>
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
