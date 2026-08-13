import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

type MenuWidth = 'normal' | 'picker';

interface MenuState {
  left: number;
  top: number;
  width: MenuWidth;
  content: ReactNode;
}

interface MenuApi {
  /** Anchors a popover under the clicked element. */
  open(e: MouseEvent, content: ReactNode, width?: MenuWidth): void;
  close(): void;
}

const MenuCtx = createContext<MenuApi>({ open: () => {}, close: () => {} });

export function useMenu(): MenuApi {
  return useContext(MenuCtx);
}

export function MenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  const open = useCallback((e: MouseEvent, content: ReactNode, width: MenuWidth = 'normal') => {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({
      left: Math.min(r.left, window.innerWidth - 300),
      top: r.bottom + window.scrollY + 6,
      width,
      content,
    });
  }, []);

  const close = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (!menu) return;
    const onDocClick = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  return (
    <MenuCtx.Provider value={{ open, close }}>
      {children}
      {menu &&
        createPortal(
          /*
           * **The scope class has to come with the portal.**
           *
           * This portals to `document.body`, which is outside the `.cw-reports` wrapper the
           * page mounts — and every rule in the prototype's stylesheet is scoped under that
           * class, because unscoped it restyles the whole app. So at body level the menu got
           * *no* styles: no `position: absolute`, no `z-index`, no background. It rendered as
           * unstyled text below the entire page, which looked exactly like nothing happening —
           * every Delete, every assumption dropdown, every field picker.
           *
           * `cw-portal` makes this wrapper `display: contents`, so it carries the class into
           * the subtree without boxing: `.cw-reports`'s own `height: 100%` and background would
           * otherwise paint a full-height sheet over the page, and a positioned wrapper would
           * change the containing block the `left`/`top` above are computed against.
           */
          <div className="cw-reports cw-portal">
            <div
              className={'menu' + (menu.width === 'picker' ? ' picker' : '')}
              style={{ left: menu.left, top: menu.top }}
              onClick={(e) => e.stopPropagation()}
            >
              {menu.content}
            </div>
          </div>,
          document.body,
        )}
    </MenuCtx.Provider>
  );
}

/* ------------------------------------------------------------ menu parts */

export interface MenuItem {
  label: string;
  d?: string;
  sel?: boolean;
  danger?: boolean;
  onPick(): void;
}

export function OptionList({ title, items }: { title?: string; items: MenuItem[] }) {
  const { close } = useMenu();
  return (
    <>
      {title && <div className="mq">{title}</div>}
      {items.map((it, i) => (
        <button
          key={i}
          className={'opt' + (it.sel ? ' sel' : '') + (it.danger ? ' danger' : '')}
          onClick={() => {
            close();
            it.onPick();
          }}
        >
          {it.label}
          {it.d && <span className="d">{it.d}</span>}
        </button>
      ))}
    </>
  );
}
