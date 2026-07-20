export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3" aria-label="BitPix">
      <span className="relative grid h-9 w-9 place-items-center rounded-[11px] bg-[var(--primary)] text-white shadow-[0_8px_18px_color-mix(in_srgb,var(--primary)_20%,transparent)]" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M5.2 4.6h5.35a3.1 3.1 0 0 1 0 6.2H5.2V4.6Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M5.2 10.8h6.15a3.1 3.1 0 0 1 0 6.2H5.2v-6.2Z" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </span>
      {!compact && <span className="font-[var(--font-display)] text-xl font-semibold tracking-[-0.035em]">BitPix</span>}
    </div>
  );
}
