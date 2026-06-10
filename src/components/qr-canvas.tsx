import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QrCanvas({ value, size = 200 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      color: { dark: "#000000", light: "#F2D27A" },
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [value, size]);
  if (!dataUrl) return <div style={{ width: size, height: size }} className="animate-pulse bg-card" />;
  return (
    <img
      src={dataUrl}
      width={size}
      height={size}
      alt="Deposit QR"
      className="rounded-lg border-2 border-gold-soft shadow-gold"
    />
  );
}
