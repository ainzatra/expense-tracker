import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';

export async function pickModel(): Promise<{ path: string; name: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (result.canceled) return null;
  const asset = result.assets[0], source = new File(asset.uri);
  try {
    if (!asset.name.toLowerCase().endsWith('.gguf')) throw new Error('Select a GGUF instruction model.');
    const handle = source.open();
    try {
      if (Array.from(handle.readBytes(4)).map(v => String.fromCharCode(v)).join('') !== 'GGUF') throw new Error('This file is not a GGUF model.');
    } finally { handle.close(); }
    const directory = new Directory(Paths.document, 'models');
    directory.create({ idempotent: true, intermediates: true });
    const destination = new File(directory, `model-${Date.now()}.gguf`);
    source.copy(destination);
    return { path: destination.uri, name: asset.name };
  } finally {
    // DocumentPicker supplied a private cache copy; keep only the persistent model.
    if (source.exists) source.delete();
  }
}
export function removeModel(path: string) {
  const directory = new Directory(Paths.document, 'models');
  if (!path.startsWith(`${directory.uri}/`) && !path.startsWith(directory.uri.endsWith('/') ? directory.uri : `${directory.uri}/`)) return;
  const file = new File(path);
  if (file.exists) file.delete();
}
