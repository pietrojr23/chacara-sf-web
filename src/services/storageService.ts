const normalizeEnv = (value: string | undefined) => value?.trim() ?? '';
const normalizeStoragePath = (value: string) => value.replace(/^\/+/, '').trim();

const inferMimeFromPath = (path: string) => {
  const normalized = path.toLowerCase();
  if (normalized.endsWith('.pdf')) return 'application/pdf';
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.heic')) return 'image/heic';
  if (normalized.endsWith('.gif')) return 'image/gif';
  if (normalized.endsWith('.mp4')) return 'video/mp4';
  if (normalized.endsWith('.mov')) return 'video/quicktime';
  if (normalized.endsWith('.m4v')) return 'video/x-m4v';
  if (normalized.endsWith('.webm')) return 'video/webm';
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
};

const uploadFile = async (uri: string, path: string) => {
  const cloudName = normalizeEnv(process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME);
  const uploadPreset = normalizeEnv(process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET);

  if (!cloudName || !uploadPreset) {
    throw Object.assign(
      new Error(
        'Cloudinary não configurado. Preencha EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME e EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET no .env.',
      ),
      { code: 'cloudinary-config-missing' },
    );
  }

  const objectPath = normalizeStoragePath(path);
  const filename = objectPath.split('/').pop() || `upload-${Date.now()}`;
  const folder = objectPath.includes('/') ? objectPath.slice(0, objectPath.lastIndexOf('/')) : '';

  const formData = new FormData();
  formData.append('upload_preset', uploadPreset);
  if (folder) {
    formData.append('folder', folder);
  }

  formData.append('public_id', filename.replace(/\.[^/.]+$/, ''));
  formData.append('file', {
    uri,
    name: filename,
    type: inferMimeFromPath(filename),
  } as any);

  const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`;
  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData,
  });

  const payload = (await response.json()) as {
    secure_url?: string;
    error?: { message?: string };
  };

  if (!response.ok || !payload.secure_url) {
    const message = payload?.error?.message || 'Falha no upload para Cloudinary.';
    throw Object.assign(new Error(message), { code: 'cloudinary-upload-failed' });
  }

  return payload.secure_url;
};

export const uploadImageAsync = async (uri: string, path: string) => uploadFile(uri, path);

export const uploadFileAsync = async (uri: string, path: string) => uploadFile(uri, path);
