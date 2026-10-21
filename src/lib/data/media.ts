import { AppError } from './errors';

export const MEDIA_RULES = {
  maxBytes: 8 * 1024 * 1024,
  maxDimension: 2400,
  accepted: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
} as const;

/** Check the file's first bytes, not just its claimed type or extension. */
export async function sniffImageType(file: Blob): Promise<string | null> {
  const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 3) === 'GIF') return 'image/gif';
  if (ascii(4, 8) === 'ftyp' && /avi[fs]/.test(ascii(8, 12))) return 'image/avif';
  return null;
}

export interface ProcessedImage {
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
}

/**
 * Validates and re-encodes an uploaded image. Re-encoding through a canvas
 * strips metadata (including GPS) and anything that isn't pixel data, and
 * caps the size so pages don't download huge originals. GIFs are kept as-is
 * so animation survives.
 */
export async function processImage(file: File): Promise<ProcessedImage> {
  if (file.size > MEDIA_RULES.maxBytes) {
    throw new AppError('validation', `Images must be ${MEDIA_RULES.maxBytes / 1024 / 1024} MB or smaller.`);
  }
  const sniffed = await sniffImageType(file);
  if (!sniffed || !(MEDIA_RULES.accepted as readonly string[]).includes(sniffed)) {
    throw new AppError('validation', 'Upload a JPG, PNG, WebP, AVIF or GIF image.');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new AppError('validation', 'This image file looks damaged. Try exporting it again.');
  }
  const { width, height } = bitmap;
  if (sniffed === 'image/gif') {
    bitmap.close();
    return { blob: file, width, height, mimeType: sniffed };
  }
  const scale = Math.min(1, MEDIA_RULES.maxDimension / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new AppError('storage', 'This browser could not process the image.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.86));
  if (!blob) throw new AppError('storage', 'This browser could not process the image.');
  return { blob, width: w, height: h, mimeType: 'image/webp' };
}

export function safeFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').slice(0, 60);
  return base.replace(/^-|-$/g, '') || 'image';
}
