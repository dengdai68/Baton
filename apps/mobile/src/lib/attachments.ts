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
  image: boolean;
  /** Server record once uploaded (kept so a retry does not upload twice). */
  uploaded?: { id: string; name: string };
};

let counter = 0;
const key = () => 'local-' + Date.now().toString(36) + '-' + ++counter;
const isImage = (name: string, mimeType?: string | null) => /^image\//.test(mimeType || '') || /\.(png|jpe?g|gif|webp|heic|avif|bmp)$/i.test(name);

export async function pickFiles(): Promise<LocalAttachment[]> {
  const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
  if (result.canceled) return [];
  return result.assets.map((asset) => ({ key: key(), uri: asset.uri, name: asset.name, size: asset.size ?? undefined, mimeType: asset.mimeType ?? undefined, image: isImage(asset.name, asset.mimeType) }));
}

export async function pickImages(): Promise<LocalAttachment[]> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 1 });
  if (result.canceled) return [];
  return result.assets.map((asset, index) => {
    const name = asset.fileName || 'image-' + (index + 1) + '.' + ((asset.mimeType || 'image/jpeg').split('/')[1] || 'jpg');
    return { key: key(), uri: asset.uri, name, size: asset.fileSize ?? undefined, mimeType: asset.mimeType ?? undefined, image: true };
  });
}

export function formatBytes(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
