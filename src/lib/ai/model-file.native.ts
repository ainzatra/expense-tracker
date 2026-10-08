import { Directory, File, Paths } from 'expo-file-system';

export function removeModel(path: string) {
  const directory = new Directory(Paths.document, 'models');
  const prefix = directory.uri.replace(/\/+$/, '') + '/';
  // Only delete a single file inside this app's private model folder.
  if (!path.startsWith(prefix) || !/^model-\d+\.gguf$/.test(path.slice(prefix.length))) {
    throw new Error('This file is outside the app model folder. Delete the original download with your file manager.');
  }
  const file = new File(path);
  if (file.exists) file.delete();
}
