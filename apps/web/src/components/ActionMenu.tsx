import { useEffect, useId, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';

export type MenuAction = {
  label: string;
  icon: IconName;
  onSelect?: () => void;
  href?: string;
};

/** Native dialog supplies focus containment and Escape; restore Safari's opener explicitly. */
export function ActionMenu({
  label,
  title,
  actions,
  icon = 'more',
}: {
  label: string;
  title: string;
  actions: MenuAction[];
  icon?: IconName;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        className="icon-button menu-trigger"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          setOpen(true);
        }}
      >
        <Icon name={icon} />
      </button>
      <dialog
        ref={dialog}
        className="action-menu"
        aria-labelledby={titleId}
        onClose={() => {
          setOpen(false);
          if (
            !document.querySelector('dialog[open]') &&
            (document.activeElement === document.body ||
              document.activeElement === trigger.current ||
              dialog.current?.contains(document.activeElement)) &&
            trigger.current?.getClientRects().length
          ) {
            trigger.current.focus({ preventScroll: true });
          }
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
      >
        <div className="action-menu-content">
          <header>
            <h2 id={titleId}>{title}</h2>
            <button
              className="icon-button"
              aria-label="Chiudi menu"
              onClick={() => setOpen(false)}
            >
              <Icon name="close" />
            </button>
          </header>
          <div className="menu-actions">
            {actions.map((action) =>
              action.href ? (
                <a
                  key={action.label}
                  href={action.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                >
                  <Icon name={action.icon} size={20} /> {action.label}
                </a>
              ) : (
                <button
                  key={action.label}
                  onClick={() => {
                    action.onSelect?.();
                    setOpen(false);
                  }}
                >
                  <Icon name={action.icon} size={20} /> {action.label}
                </button>
              ),
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
