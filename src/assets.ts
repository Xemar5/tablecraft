import { assetSchema, MAX_ASSET_BYTES, uid, type Component } from './domain';

export const GOOGLE_FONTS = [
  'DM Sans', 'Lora', 'Inter', 'Roboto', 'Open Sans', 'Noto Sans', 'Montserrat', 'Poppins', 'Nunito',
  'Raleway', 'Work Sans', 'Source Sans 3', 'Space Grotesk', 'Oswald', 'Bebas Neue', 'Barlow Condensed',
  'Playfair Display', 'Merriweather', 'Libre Baskerville', 'Crimson Text', 'EB Garamond', 'Cormorant Garamond',
  'Cinzel', 'Cinzel Decorative', 'Alegreya', 'Bitter', 'Roboto Slab', 'Arvo', 'Spectral',
  'Fira Code', 'JetBrains Mono', 'Space Mono', 'Caveat', 'Patrick Hand', 'Permanent Marker',
  'Kalam', 'Shadows Into Light', 'Amatic SC', 'Lobster', 'Pacifico', 'Special Elite', 'Uncial Antiqua',
];
export const TEXTURE_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif';
export const FONT_ACCEPT = '.ttf,.otf,.woff,.woff2';
export const ASSET_ACCEPT = `${TEXTURE_ACCEPT},${FONT_ACCEPT}`;
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export function base64ToBytes(data: string): Uint8Array {
  return Uint8Array.from(atob(data), character => character.charCodeAt(0));
}
export function assetMime(bytes: Uint8Array): NonNullable<Component['asset']>['mime'] {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  const text = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return 'image/png';
  if (starts(255, 216, 255)) return 'image/jpeg';
  if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') return 'image/webp';
  if (['GIF87a', 'GIF89a'].includes(text(0, 6))) return 'image/gif';
  if (starts(0, 1, 0, 0)) return 'font/ttf';
  if (text(0, 4) === 'OTTO') return 'font/otf';
  if (text(0, 4) === 'wOFF') return 'font/woff';
  if (text(0, 4) === 'wOF2') return 'font/woff2';
  throw new Error('Unsupported asset. Choose a PNG, JPEG, WebP, GIF, TTF, OTF, WOFF or WOFF2 file.');
}
/** Imports a texture or font file; pass the expected kind to reject the other kind of file. */
export async function importAsset(file: File, expected?: 'texture' | 'font'): Promise<Component> {
  if (file.size > MAX_ASSET_BYTES) throw new Error('Each imported asset must be at most 5 MiB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = assetMime(bytes), kind = mime.startsWith('image/') ? 'texture' : 'font';
  if (expected && kind !== expected) throw new Error(`"${file.name}" is a ${kind}. Choose ${expected === 'texture' ? 'a PNG, JPEG, WebP or GIF image' : 'a TTF, OTF, WOFF or WOFF2 font'}.`);
  const data = bytesToBase64(bytes);
  if (kind === 'texture' && typeof createImageBitmap === 'function') {
    try { (await createImageBitmap(file)).close(); }
    catch { throw new Error(`Texture "${file.name}" could not be decoded. Choose a valid image file.`); }
  }
  if (kind === 'font' && typeof FontFace !== 'undefined') {
    try { await new FontFace('tablecraft-import-check', `url("data:${mime};base64,${data}")`).load(); }
    catch { throw new Error(`Font "${file.name}" could not be loaded. Choose a valid font file.`); }
  }
  return {
    id: uid('asset'), name: file.name.replace(/\.[^.]+$/, '').slice(0, 100) || 'Imported asset', kind,
    width: 200, height: 200, color: 'transparent', front: [], back: [], csv: '', rows: [],
    flippable: false, hand: false, hideInHand: false, stackable: false, shufflable: false, stackTag: '',
    asset: assetSchema.parse({ name: file.name, mime, data }),
  };
}
