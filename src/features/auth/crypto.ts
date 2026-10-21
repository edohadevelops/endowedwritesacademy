// Password hashing for the local prototype only (PBKDF2-SHA256, 310k rounds,
// per-user salt) using the browser's Web Crypto. In production Supabase Auth
// owns passwords and this file is not used.

const enc = new TextEncoder();
const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string) => new Uint8Array(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));

export async function hashPassword(password: string, saltHex?: string): Promise<{ salt: string; hash: string }> {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 310_000 }, key, 256);
  return { salt: toHex(salt.buffer), hash: toHex(bits) };
}

/** Constant-time comparison of two hex strings. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function passwordProblems(pw: string): string | null {
  if (pw.length < 12) return 'Use at least 12 characters.';
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return 'Use a mix of letters and numbers.';
  return null;
}
