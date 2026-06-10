import { ReactNode } from "react";

export function GoldFrame({
  children,
  className = "",
  glow = false,
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div
      className={`relative rounded-xl border border-gold-soft/40 bg-card/70 backdrop-blur-sm ${glow ? "shadow-gold" : ""} ${className}`}
    >
      {/* corner accents */}
      <span className="absolute -top-px -left-px h-3 w-3 border-t-2 border-l-2 border-gold-soft" />
      <span className="absolute -top-px -right-px h-3 w-3 border-t-2 border-r-2 border-gold-soft" />
      <span className="absolute -bottom-px -left-px h-3 w-3 border-b-2 border-l-2 border-gold-soft" />
      <span className="absolute -bottom-px -right-px h-3 w-3 border-b-2 border-r-2 border-gold-soft" />
      {children}
    </div>
  );
}

export function GoldButton({
  children,
  onClick,
  disabled,
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit" | "reset";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`gold-sweep relative inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-gold-flat px-6 py-3 font-display font-bold uppercase tracking-widest text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed shadow-gold ${className}`}
    >
      {children}
    </button>
  );
}
