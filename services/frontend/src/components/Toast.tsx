import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";
import { cn } from "../lib/utils";

export interface ToastItem {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
}

let _id = 0;
const listeners = new Set<(t: ToastItem) => void>();

export function toast(kind: ToastItem["kind"], message: string) {
  const t = { id: ++_id, kind, message };
  listeners.forEach((l) => l(t));
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onAdd = (t: ToastItem) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 4000);
    };
    listeners.add(onAdd);
    return () => { listeners.delete(onAdd); };
  }, []);

  return (
    <div className="fixed bottom-6 right-6 z-50 space-y-2 max-w-sm">
      {items.map((t) => {
        const Icon = t.kind === "success" ? CheckCircle2 : AlertCircle;
        return (
          <div
            key={t.id}
            className={cn(
              "flex items-start gap-3 rounded-[10px] border bg-panel px-4 py-3 text-text",
              "animate-in slide-in-from-right-5",
              t.kind === "success" && "border-accentGreen/40",
              t.kind === "error" && "border-err/40",
              t.kind === "info" && "border-border",
            )}
          >
            <Icon
              size={18}
              className={cn(
                "flex-shrink-0 mt-0.5",
                t.kind === "success" && "text-accentGreen",
                t.kind === "error"   && "text-err",
                t.kind === "info" && "text-accentBlue",
              )}
            />
            <div className="text-sm leading-snug text-text">{t.message}</div>
            <button
              onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
              className="ml-2 text-muted hover:text-text"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
