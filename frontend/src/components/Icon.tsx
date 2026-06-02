// ─── Icon ─────────────────────────────────────────────────────────────────────

export function Icon({ name, fill, size = 20, className = '' }: { name: string; fill?: boolean; size?: number; className?: string }) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={{ fontSize: size, fontVariationSettings: fill ? "'FILL' 1" : "'FILL' 0" }}
    >
      {name}
    </span>
  );
}
