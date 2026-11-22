// Attachments picked on the phone: files (Files app) or photos; uploaded as raw
// bytes from disk right before sending, exactly like the Mac composer.
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

export type LocalAttachment = {
  key: string;
  uri: string;
  name: string;
  size?: number;
  mimeType?: string;
  /** Uploaded server record, kept so a retry does not upload twice. */
  uploaded?: { id: string; name: string };
};

let counter = 0;
const key = () => 'local-' + Date.now().toString(36) + '-' + ++counter;

/** Same rule as the Mac client (web/communication.js imageAttachment): by file extension. */
export const isImageName = (name: string | null | undefined) => /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(name || '');

export async function pickFiles(): Promise<LocalAttachment[]> {
  const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
  if (result.canceled) return [];
  return result.assets.map((asset) => ({ key: key(), uri: asset.uri, name: asset.name, size: asset.size ?? undefined, mimeType: asset.mimeType ?? undefined }));
}

/** Photos are re-encoded as JPEG (iPhone HEIC is not an image on the Mac side) and named .jpg. */
export async function pickImages(): Promise<LocalAttachment[]> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.9 });
  if (result.canceled) return [];
  return result.assets.map((asset, index) => {
    const base = (asset.fileName || 'image-' + (index + 1)).replace(/\.[^.]+$/, '');
    const extension = asset.mimeType === 'image/png' ? '.png' : asset.mimeType === 'image/gif' ? '.gif' : '.jpg';
    return { key: key(), uri: asset.uri, name: base + extension, size: asset.fileSize ?? undefined, mimeType: asset.mimeType ?? 'image/jpeg' };
  });
}

/** Mac attachment size wording: B / KB (rounded up) / MB (one decimal). */
export function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes)) return '';
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  if (bytes >= 1024) return Math.ceil(bytes / 1024) + ' KB';
  return bytes + ' B';
}

/** Uppercase extension shown on pending file chips (Mac: up to 12 characters, else 文件). */
export const fileExtension = (name: string) => (name.includes('.') ? name.split('.').pop()!.toUpperCase().slice(0, 12) : '');
