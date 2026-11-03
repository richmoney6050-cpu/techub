'use client';
import { code128Svg } from '@/lib/code128';

export function BarcodeSvg({ code, height = 56 }: { code: string; height?: number }) {
  let g; try { g = code128Svg(code, height, 2); } catch { return <span className="muted small">Barcode has unsupported characters</span>; }
  return (<svg role="img" aria-label={`Barcode ${code}`} viewBox={`0 0 ${g.width} ${height + 16}`} style={{ maxWidth: 260, width: '100%', background: '#fff' }}>
    {g.bars.map((b, i) => <rect key={i} x={b.x} y={0} width={b.w} height={height} fill="#000" />)}
    <text x={g.width / 2} y={height + 13} fontSize="12" textAnchor="middle" fontFamily="monospace" fill="#000">{code}</text></svg>);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** Opens a print dialog with one label per copy (white background, black bars so any scanner can read it). */
export function printLabels(items: { code: string; name: string; price: string; copies?: number }[]) {
  const labels = items.flatMap((it) => {
    const g = code128Svg(it.code, 50, 2);
    const svg = `<svg viewBox="0 0 ${g.width} 66" width="100%">${g.bars.map((b) => `<rect x="${b.x}" y="0" width="${b.w}" height="50" fill="#000"/>`).join('')}<text x="${g.width / 2}" y="62" font-size="11" text-anchor="middle" font-family="monospace">${esc(it.code)}</text></svg>`;
    return Array.from({ length: Math.max(1, Math.min(it.copies || 1, 200)) }, () => `<div class="l"><div class="n">${esc(it.name)}</div>${svg}<div class="p">${esc(it.price)}</div></div>`);
  });
  const w = window.open('', '_blank', 'width=700,height=800'); if (!w) { alert('Allow pop-ups to print labels'); return; }
  w.document.write(`<!doctype html><title>Barcode labels</title><style>body{font-family:Arial,sans-serif;margin:8mm}.g{display:flex;flex-wrap:wrap;gap:4mm}.l{width:50mm;border:1px dashed #999;padding:2mm;text-align:center;break-inside:avoid}.n{font-size:10px;font-weight:700;height:24px;overflow:hidden}.p{font-size:12px;font-weight:700}</style><div class="g">${labels.join('')}</div><script>onload=function(){print()}<\/script>`);
  w.document.close();
}
