import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

const ToastCtx = createContext<(msg: string) => void>(() => {});

export function useToast(): (msg: string) => void {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('');
  const [on, setOn] = useState(false);
  const timer = useRef<number>();

  const toast = useCallback((text: string) => {
    setMsg(text);
    setOn(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOn(false), 2600);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className={'toast' + (on ? ' on' : '')}>
        <span className="tk">✓</span>
        <span>{msg}</span>
      </div>
    </ToastCtx.Provider>
  );
}

/** The “◇ source” affordance under a figure — proves the number is traceable. */
export function SourceTag({ text, className = 'src' }: { text: string; className?: string }) {
  const toast = useToast();
  return (
    <div
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        toast(text);
      }}
    >
      ◇ source
    </div>
  );
}
