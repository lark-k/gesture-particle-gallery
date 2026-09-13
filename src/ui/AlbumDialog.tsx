import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function AlbumDialog({ title, close, children, busy = false }: {
  title: string; close: () => void; children: ReactNode; busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => { ref.current?.close(); prior?.focus(); };
  }, []);
  return <dialog className="album-dialog" ref={ref} aria-label={title}
    onCancel={e => { e.preventDefault(); if (!busy) close(); }}
    onClick={e => { if (e.target === e.currentTarget && !busy) close(); }}>
    <div className="album-dialog-body">
      <button className="album-dialog-close" aria-label="关闭窗口" disabled={busy} onClick={close}><X size={20}/></button>
      <span className="album-eyebrow">A PLACE FOR YOUR MEMORIES</span>
      <h2>{title}</h2>
      {children}
    </div>
  </dialog>;
}
