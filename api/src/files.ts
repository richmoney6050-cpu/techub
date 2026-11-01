import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from './config.ts';
import { bad } from './errors.ts';

// Storage abstraction: swap these two functions for S3/GCS/R2 in production if desired.
export const uploadRoot = path.resolve(config.uploadDir);
fs.mkdirSync(uploadRoot, { recursive: true });

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 1 } });

function sniff(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  return null;
}

/** Validates the real file signature (not the client-supplied type) and stores under the business folder. */
export function saveImage(businessId: string, file: Express.Multer.File | undefined): string {
  if (!file) throw bad('Please choose an image file');
  const kind = sniff(file.buffer);
  if (!kind) throw bad('Only JPG, PNG or WEBP images up to 3MB are allowed');
  const dir = path.join(uploadRoot, businessId);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomUUID()}.${kind.ext}`;
  fs.writeFileSync(path.join(dir, name), file.buffer, { mode: 0o640 });
  return `/api/files/${businessId}/${name}`;
}

export function resolveFile(businessId: string, name: string): string | null {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(name)) return null;
  const p = path.join(uploadRoot, businessId, name);
  return fs.existsSync(p) ? p : null;
}
