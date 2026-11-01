import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import { resolveFile } from './files.ts';

/** Built-in PDF fonts cannot draw the cedi sign, so PDFs use "GHS " instead. */
export const pdfSymbol = (sym: string) => (/^[\x20-\x7e]*$/.test(sym) ? sym : sym.includes('₵') ? 'GHS ' : '');

export function money(n: number, symbol = 'GHS ') {
  return `${symbol}${Number(n).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const METHOD_LABEL: Record<string, string> = { cash: 'Cash', momo: 'Mobile Money (MoMo)', bank_transfer: 'Bank transfer', card: 'Card' };

/** Render a stored receipt snapshot to a PDF buffer (80mm-style narrow receipt). */
export function receiptPdf(r: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const width = 226; // ~80mm
    const doc = new PDFDocument({ size: [width, 800], margin: 14, autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const sym = pdfSymbol(r.business.currency_symbol || 'GH₵');
    const inner = width - 28;

    // Logo (only local, validated uploads)
    try {
      const m = /\/api\/files\/([0-9a-f-]{36})\/([0-9a-f-]{36}\.(?:jpg|png|webp))$/.exec(r.business.logo_url || '');
      if (m && r.business.receipt_show_logo !== false) {
        const file = resolveFile(m[1], m[2]);
        if (file && !file.endsWith('.webp')) { doc.image(fs.readFileSync(file), (width - 48) / 2, doc.y, { fit: [48, 48] }); doc.moveDown(3.6); }
      }
    } catch {}

    doc.font('Helvetica-Bold').fontSize(12).text(r.business.name, { align: 'center', width: inner });
    doc.font('Helvetica').fontSize(8);
    for (const line of [r.business.address, r.business.phone && `Tel: ${r.business.phone}`, r.business.email]) if (line) doc.text(line, { align: 'center', width: inner });
    doc.moveDown(0.5).text('-'.repeat(44), { align: 'center' });
    doc.fontSize(8.5);
    doc.text(`Receipt: ${r.receipt_no}`);
    doc.text(`Date: ${new Date(r.created_at).toLocaleString('en-GB', { timeZone: r.timezone || 'Africa/Accra' })}`);
    doc.text(`Served by: ${r.employee_name}`);
    if (r.customer_name) doc.text(`Customer: ${r.customer_name}`);
    doc.text('-'.repeat(44), { align: 'center' });

    for (const it of r.items) {
      doc.font('Helvetica-Bold').text(it.name, { width: inner });
      doc.font('Helvetica').text(`${it.quantity} x ${money(it.unit_price, sym)}`, { continued: true, width: inner }).text(money(it.line_total, sym), { align: 'right' });
    }
    doc.text('-'.repeat(44), { align: 'center' });
    const row = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(label, { continued: true, width: inner }).text(value, { align: 'right' });
    };
    row('Subtotal', money(r.subtotal, sym));
    if (r.discount > 0) row('Discount', '-' + money(r.discount, sym));
    row('TOTAL', money(r.total, sym), true);
    row('Payment', METHOD_LABEL[r.payment_method] || r.payment_method);
    row('Amount paid', money(r.amount_paid, sym));
    if (r.change_due > 0) row('Change', money(r.change_due, sym));
    if (r.balance_due > 0) row('Balance owing', money(r.balance_due, sym), true);
    doc.moveDown(0.8).font('Helvetica').fontSize(8).text(r.footer || 'Thank you for shopping with us!', { align: 'center', width: inner });
    doc.end();
  });
}
