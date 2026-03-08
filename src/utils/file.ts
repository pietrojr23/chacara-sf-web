import { Linking } from 'react-native';

export type FileKind = 'image' | 'video' | 'pdf' | 'other';

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'bmp'];
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'];

export const getFileExtension = (value?: string | null) => {
  if (!value) {
    return '';
  }

  const clean = value.split('?')[0].split('#')[0];
  const index = clean.lastIndexOf('.');
  if (index < 0 || index === clean.length - 1) {
    return '';
  }

  return clean.slice(index + 1).toLowerCase();
};

export const getFileNameFromPath = (path?: string | null, fallback = `arquivo-${Date.now()}`) => {
  if (!path) {
    return fallback;
  }

  const clean = path.split('?')[0].split('#')[0];
  const parts = clean.split('/').filter(Boolean);
  return parts[parts.length - 1] || fallback;
};

export const inferFileKind = (value?: string | null): FileKind => {
  const ext = getFileExtension(value);

  if (!ext) {
    return 'other';
  }

  if (IMAGE_EXTENSIONS.includes(ext)) {
    return 'image';
  }

  if (VIDEO_EXTENSIONS.includes(ext)) {
    return 'video';
  }

  if (ext === 'pdf') {
    return 'pdf';
  }

  return 'other';
};

export const openExternalFile = async (url: string) => {
  const canOpen = await Linking.canOpenURL(url);
  if (!canOpen) {
    throw new Error('Não foi possível abrir este arquivo neste dispositivo.');
  }

  await Linking.openURL(url);
};
