import React, { Fragment } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  Switch,
  Transition,
} from "@headlessui/react";

export function MiniBall({ className = "" }: { className?: string }) {
  return <span className={`mini-ball ${className}`} aria-hidden="true" />;
}

export type RibbonTone = "red" | "orange" | "green" | "blue" | "purple" | "slate";

export function DsRibbon({
  title,
  tone = "red",
  right,
  className = "",
}: {
  title: string;
  tone?: RibbonTone;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`ds-ribbon ds-ribbon-${tone} ${className}`}>
      <div className="ds-ribbon-pill">
        <MiniBall />
        <span>{title}</span>
      </div>
      {right ? <div className="flex items-center gap-2 flex-wrap">{right}</div> : null}
    </div>
  );
}

export function DsTypeBadge({
  type,
  suffix,
  className = "",
}: {
  type: string;
  suffix?: string;
  className?: string;
}) {
  const upper = type.toUpperCase();
  return (
    <span className={`type-badge t-${upper} ${className}`}>
      {upper}
      {suffix ? ` ${suffix}` : ""}
    </span>
  );
}

export function DsBar({
  pct,
  tone = "hp",
  height = 8,
  className = "",
}: {
  pct: number;
  tone?: "hp" | "exp" | "gold";
  height?: number;
  className?: string;
}) {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 0));
  const fillClass =
    tone === "exp"
      ? "fill-exp"
      : tone === "gold"
      ? "fill-gold"
      : clamped > 50
      ? "fill-hp-high"
      : clamped > 25
      ? "fill-hp-mid"
      : "fill-hp-low";

  return (
    <div
      className={`ds-bar-track ${className}`}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="ds-bar-inner">
        <div className={`ds-bar-fill ${fillClass}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

export function DsDialog({
  open,
  onClose,
  maxWidthClass = "max-w-2xl",
  children,
}: {
  open: boolean;
  onClose: () => void;
  maxWidthClass?: string;
  children: React.ReactNode;
}) {
  return (
    <Transition show={open} as={Fragment}>
      <Dialog onClose={onClose} className="relative z-50">
        <DialogBackdrop
          transition
          className="fixed inset-0 bg-black/60 backdrop-blur-[2px] transition duration-200 ease-out data-[closed]:opacity-0"
        />
        <div className="fixed inset-0 flex w-screen items-center justify-center p-4 overflow-y-auto">
          <DialogPanel
            transition
            className={`w-full ${maxWidthClass} max-h-[92vh] overflow-y-auto transition duration-200 ease-out data-[closed]:scale-95 data-[closed]:opacity-0 data-[closed]:translate-y-2`}
          >
            {children}
          </DialogPanel>
        </div>
      </Dialog>
    </Transition>
  );
}

export function DsSwitch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <Switch
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full border-[1.5px] border-[var(--border-dark)] transition-colors duration-150 disabled:opacity-50 ${
          checked ? "bg-[#16a34a]" : "bg-[#94a3b8] dark:bg-[#3f4756]"
        }`}
      >
        <span className="sr-only">{label || "Alternar"}</span>
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full border border-[var(--border-dark)] bg-white shadow transition-transform duration-150 ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </Switch>
      {label ? <span className="text-xs font-semibold text-[var(--ink)]">{label}</span> : null}
    </div>
  );
}

export function DsConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  tone = "danger",
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const headerClass =
    tone === "danger"
      ? "bg-gradient-to-b from-[#e04338] to-[#c72d23]"
      : "bg-gradient-to-b from-[#2563eb] to-[#1d4ed8]";
  const confirmBtnClass = tone === "danger" ? "ds-btn-red" : "ds-btn-green";

  return (
    <DsDialog open={open} onClose={busy ? () => {} : onClose} maxWidthClass="max-w-md">
      <div className="px-box overflow-hidden text-[var(--ink)] shadow-2xl">
        <div
          className={`${headerClass} border-b-[1.5px] border-[#1b1f26] px-4 py-3 flex items-center gap-2`}
        >
          <MiniBall />
          <span className="font-bold text-sm text-white">{title}</span>
        </div>
        <div className="p-4 space-y-4 text-xs">
          <p className="text-[var(--ink)] leading-relaxed font-medium">{description}</p>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="ds-btn ds-btn-slate ds-btn-sm"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className={`ds-btn ${confirmBtnClass} ds-btn-sm`}
            >
              {busy ? "Processando..." : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </DsDialog>
  );
}

export function DsToast({ message }: { message: string | null }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 pointer-events-none max-w-sm">
      <Transition
        show={Boolean(message)}
        enter="transition duration-200 ease-out"
        enterFrom="opacity-0 translate-y-3 scale-95"
        enterTo="opacity-100 translate-y-0 scale-100"
        leave="transition duration-150 ease-in"
        leaveFrom="opacity-100 translate-y-0 scale-100"
        leaveTo="opacity-0 translate-y-2 scale-95"
      >
        <div className="poke-toast pointer-events-auto flex items-center gap-2.5">
          <MiniBall />
          <span>{message}</span>
        </div>
      </Transition>
    </div>
  );
}
