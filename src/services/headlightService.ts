import axios from 'axios';
import { getGateConfig } from './gateService';

const DEFAULT_HEADLIGHTS_VIRTUAL_ID = 'bf34982d74bfeccf87av8b';
const HEADLIGHTS_VIRTUAL_ID = String(process.env.EXPO_PUBLIC_HEADLIGHTS_VIRTUAL_ID ?? DEFAULT_HEADLIGHTS_VIRTUAL_ID).trim();
const HEADLIGHTS_CATALOG_ENV = String(process.env.EXPO_PUBLIC_HEADLIGHTS_CATALOG ?? '').trim();

export interface HeadlightDevice {
  id: string;
  name: string;
  description?: string;
  active: boolean;
  allowedHouseIds: string[];
}

type HeadlightConfigInput = {
  id?: unknown;
  virtual_id?: unknown;
  virtualId?: unknown;
  nome?: unknown;
  name?: unknown;
  descricao?: unknown;
  description?: unknown;
  casasPermitidas?: unknown;
  allowedHouses?: unknown;
  houseIds?: unknown;
  ativo?: unknown;
  active?: unknown;
};

const resolveHeadlightsWebhookUrl = (baseUrl: string) => {
  const trimmed = String(baseUrl ?? '').trim();
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = new URL(trimmed);
    const originalPath = parsed.pathname;

    if (/\/headlights\/(on|off|toggle)\/?$/i.test(originalPath)) {
      parsed.pathname = originalPath.replace(/\/headlights\/(on|off|toggle)\/?$/i, '/headlights/toggle');
      return parsed.toString();
    }

    if (/\/gate\/(open|close)\/?$/i.test(originalPath)) {
      parsed.pathname = originalPath.replace(/\/gate\/(open|close)\/?$/i, '/headlights/toggle');
      return parsed.toString();
    }

    if (/\/gate\/?$/i.test(originalPath)) {
      parsed.pathname = originalPath.replace(/\/gate\/?$/i, '/headlights/toggle');
      return parsed.toString();
    }

    return '';
  } catch {
    return '';
  }
};

const isTruthyFlag = (value: unknown) => {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return ['1', 'true', 'yes', 'sim', 'ativo'].includes(normalized);
};

const toDevice = (raw: HeadlightConfigInput): HeadlightDevice | null => {
  const id = String(raw.virtual_id ?? raw.virtualId ?? raw.id ?? '').trim();
  if (!id) {
    return null;
  }

  const name = String(raw.nome ?? raw.name ?? '').trim() || `Farol ${id.slice(0, 6)}`;
  const description = String(raw.descricao ?? raw.description ?? '').trim() || undefined;
  const allowedRaw = raw.casasPermitidas ?? raw.allowedHouses ?? raw.houseIds;
  const allowedHouseIds = Array.isArray(allowedRaw)
    ? allowedRaw.map((houseId) => String(houseId ?? '').trim()).filter(Boolean)
    : [];

  return {
    id,
    name,
    description,
    active: isTruthyFlag(raw.ativo ?? raw.active),
    allowedHouseIds,
  };
};

const normalizeCatalog = (items: unknown[]): HeadlightDevice[] => {
  const mapped = items
    .map((item) => (item && typeof item === 'object' ? toDevice(item as HeadlightConfigInput) : null))
    .filter((item): item is HeadlightDevice => Boolean(item));

  const unique = new Map<string, HeadlightDevice>();
  mapped.forEach((item) => {
    if (!unique.has(item.id)) {
      unique.set(item.id, item);
    }
  });

  return Array.from(unique.values());
};

const parseCatalogFromEnv = (): HeadlightDevice[] => {
  if (!HEADLIGHTS_CATALOG_ENV) {
    return [];
  }

  try {
    const parsed = JSON.parse(HEADLIGHTS_CATALOG_ENV);
    if (Array.isArray(parsed)) {
      return normalizeCatalog(parsed);
    }
  } catch {
    // ignora catálogo inválido no env
  }

  return [];
};

export const getHeadlightsCatalog = (configHeadlights?: unknown): HeadlightDevice[] => {
  const configItems = Array.isArray(configHeadlights) ? normalizeCatalog(configHeadlights) : [];
  if (configItems.length) {
    return configItems;
  }

  const envItems = parseCatalogFromEnv();
  if (envItems.length) {
    return envItems;
  }

  if (HEADLIGHTS_VIRTUAL_ID) {
    return [
      {
        id: HEADLIGHTS_VIRTUAL_ID,
        name: 'Farol principal',
        description: 'Entrada da chácara',
        active: true,
        allowedHouseIds: [],
      },
    ];
  }

  return [];
};

export const toggleHeadlight = async (virtualId: string, userId: string, userName: string) => {
  const safeVirtualId = String(virtualId ?? '').trim();
  if (!safeVirtualId) {
    throw { code: 'headlights-virtual-id-missing' };
  }

  const config = await getGateConfig();
  const gateWebhookUrl = String(config?.gateWebhookUrl ?? config?.gateCloseWebhookUrl ?? '').trim();
  const url = resolveHeadlightsWebhookUrl(gateWebhookUrl);

  if (!url) {
    throw { code: gateWebhookUrl ? 'headlights-webhook-invalid' : 'headlights-webhook-missing' };
  }

  const response = await axios.post(
    url,
    {
      action: 'toggle',
      target: 'headlights_toggle',
      virtual_id: safeVirtualId,
      virtualId: safeVirtualId,
      userId,
      userName,
    },
    { timeout: 8000 },
  );

  return response.data as { state?: boolean; previousState?: boolean };
};

export const toggleHeadlights = async (userId: string, userName: string) => {
  return toggleHeadlight(HEADLIGHTS_VIRTUAL_ID, userId, userName);
};
