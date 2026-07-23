import Image from "next/image";

export function BrandMark({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <span className={`brand-mark-anim inline-flex items-center ${light ? "brand-logo-light" : ""}`} aria-label="BitPix">
      {compact ? (
        <Image src="/bitpix-mark.png" alt="BitPix" width={476} height={648} priority style={{ height: 34, width: "auto" }} />
      ) : (
        <Image src="/bitpix-full.png" alt="BitPix" width={1160} height={363} priority style={{ height: 30, width: "auto" }} />
      )}
    </span>
  );
}
