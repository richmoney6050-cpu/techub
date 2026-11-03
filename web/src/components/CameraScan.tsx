'use client';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui';

/** Camera barcode scanner using the browser's built-in BarcodeDetector (Chrome / Edge / Android). Falls back to a clear message elsewhere. */
export function cameraScanSupported() { return typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia; }

export default function CameraScan({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null); const cb = useRef(onCode); cb.current = onCode; const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null; let stop = false; let timer: any;
    (async () => {
      try {
        if (!cameraScanSupported()) throw new Error('This browser cannot scan with the camera. Use a USB scanner, or try Chrome on Android.');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stop) return stream.getTracks().forEach((t) => t.stop());
        const v = video.current!; v.srcObject = stream; await v.play();
        const det = new (window as any).BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] });
        const tick = async () => {
          if (stop) return;
          try { const r = await det.detect(v); if (r.length && r[0].rawValue) { stop = true; cb.current(String(r[0].rawValue)); return; } } catch {}
          timer = setTimeout(tick, 250);
        };
        tick();
      } catch (e: any) { setErr(e?.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in the browser and try again.' : e.message || 'Could not open the camera'); }
    })();
    return () => { stop = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return (<Modal title="Scan a barcode" onClose={onClose}>{err ? <div className="alert err">{err}</div> : <><video ref={video} playsInline muted style={{ width: '100%', borderRadius: 10, background: '#000' }} /><p className="muted small">Point the camera at the barcode. It is added as soon as it is read.</p></>}</Modal>);
}
