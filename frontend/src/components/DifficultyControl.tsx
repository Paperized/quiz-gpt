import { getDifficultyBand } from '../difficulty';

export function DifficultyControl({
  value,
  onChange,
  id = 'difficulty'
}: {
  value: number;
  onChange: (value: number) => void;
  id?: string;
}) {
  const currentBand = getDifficultyBand(value);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <label className="text-[12px] font-medium text-on-surface block font-geist" htmlFor={id}>Difficulty</label>
        <div className="text-right">
          <div className="text-[13px] font-semibold text-secondary">{value}/10</div>
          <div className="text-[11px] text-text-muted">{currentBand.label}</div>
        </div>
      </div>

      <input
        id={id}
        className="w-full h-1 bg-surface-variant rounded-lg appearance-none cursor-pointer accent-accent-teal"
        type="range"
        min={1}
        max={10}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />

      <p className="text-[12px] text-on-surface">{currentBand.summary}</p>
    </div>
  );
}
