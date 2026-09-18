import { getSupabase, getSupabaseStorageBucket } from './supabase';

const normalizeEnv = (value: string | undefined) => value?.trim() ?? '';
const normalizeStoragePath = (value: string) => value.replace(/^\/+/, '').trim();

const sanitizePathSegment = (value: string) => {
  const normalized = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized;
};

const buildSafeStoragePath = (value: string) => {
  const raw = normalizeStoragePath(value);
  const parts = raw.split('/').filter(Boolean);

  if (!parts.length) {
    return `uploads/upload-${Date.now()}`;
  }

  const safeParts = parts.map((part, index) => {
    const safe = sanitizePathSegment(part);
    if (safe) {
      return safe;
    }

    return index === parts.length - 1 ? `upload-${Date.now()}` : 'uploads';
  });

  return safeParts.join('/');
};

const inferMimeFromPath = (path: string) => {
  const normalized = path.toLowerCase();
  if (normalized.endsWith('.pdf')) return 'application/pdf';
  if (normalized.endsWith('.txt')) return 'text/plain';
  if (normalized.endsWith('.doc')) return 'application/msword';
  if (normalized.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
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

const uploadToSupabaseStorage = async (uri: string, path: string) => {
  const objectPath = buildSafeStoragePath(path);
  const contentType = inferMimeFromPath(objectPath);
  const bucket = getSupabaseStorageBucket();

  const response = await fetch(uri);
  if (!response.ok) {
    throw Object.assign(
      new Error('Não foi possível ler o arquivo selecionado para enviar ao Supabase Storage.'),
      { code: 'supabase-storage-read-failed' },
    );
  }

  const data = await response.arrayBuffer();
  if (!data.byteLength) {
    throw Object.assign(
      new Error('O arquivo selecionado está vazio.'),
      { code: 'supabase-storage-empty-file' },
    );
  }

  const { error } = await getSupabase().storage.from(bucket).upload(objectPath, data, {
    contentType,
    upsert: true,
  });

  if (error) {
    throw Object.assign(
      new Error(`Falha no upload para Supabase Storage: ${error.message}`),
      { code: 'supabase-storage-upload-failed' },
    );
  }

  const { data: publicData } = getSupabase().storage.from(bucket).getPublicUrl(objectPath);
  const publicUrl = String(publicData?.publicUrl ?? '').trim();

  if (!publicUrl) {
    throw Object.assign(
      new Error('Não foi possível gerar URL pública do arquivo enviado.'),
      { code: 'supabase-storage-url-failed' },
    );
  }

  return publicUrl;
};

const uploadToCloudinary = async (uri: string, path: string) => {
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

  const objectPath = buildSafeStoragePath(path);
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

const uploadFile = async (uri: string, path: string) => {
  const cloudName = normalizeEnv(process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME);
  const uploadPreset = normalizeEnv(process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET);
  const cloudinaryConfigured = Boolean(cloudName && uploadPreset);

  if (cloudinaryConfigured) {
    try {
      return await uploadToCloudinary(uri, path);
    } catch (error) {
      console.warn('[storage] Cloudinary falhou; usando fallback Supabase Storage.', error);
    }
  }

  return uploadToSupabaseStorage(uri, path);
};

export const uploadImageAsync = async (uri: string, path: string) => uploadFile(uri, path);

export const uploadFileAsync = async (uri: string, path: string) => uploadFile(uri, path);
