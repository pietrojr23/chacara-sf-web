import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { AppConfig } from '../types/models';
import { getGlobalConfig, updateGlobalConfig } from '../services/firestoreService';
import { cacheKeys, getCache, saveCache } from '../services/cacheService';

interface AppConfigContextData {
  config: AppConfig;
  loadingConfig: boolean;
  saveConfig: (payload: Partial<AppConfig>) => Promise<void>;
  refreshConfig: () => Promise<void>;
}

const defaultTenantGateAccess = {
  enabled: true,
  defaultWindowStart: '06:00',
  defaultWindowEnd: '23:00',
  defaultCooldownSeconds: 30,
  defaultMaxOpensPerDay: 10,
  defaultRequireProximity: true,
  defaultMaxDistanceMeters: 200,
  defaultRequireBiometric: true,
  houseRules: [],
};

const defaultConfig: AppConfig = {
  propriedadeNome: 'Chácara São Francisco',
  chavePix: '',
  tarifaEnergia: 0,
  gateWebhookUrl: '',
  gateCloseWebhookUrl: '',
  tenantGateAccess: defaultTenantGateAccess,
  headlights: [],
  latitude: -23.55052,
  longitude: -46.633308,
  temaEscuroAtivo: false,
  notificacoes: {
    avisos: true,
    chamados: true,
    financeiro: true,
    chat: true,
    visitantes: true,
  },
};

const normalizeAppConfig = (raw?: Partial<AppConfig> | null): AppConfig => ({
  ...defaultConfig,
  ...raw,
  tenantGateAccess: {
    ...defaultTenantGateAccess,
    ...(raw?.tenantGateAccess ?? {}),
    houseRules: Array.isArray(raw?.tenantGateAccess?.houseRules) ? raw?.tenantGateAccess?.houseRules : [],
  },
  notificacoes: {
    ...defaultConfig.notificacoes,
    ...(raw?.notificacoes ?? {}),
  },
  temaEscuroAtivo: false,
});

const AppConfigContext = createContext<AppConfigContextData | undefined>(undefined);

export const AppConfigProvider = ({ children }: { children: ReactNode }) => {
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [loadingConfig, setLoadingConfig] = useState(true);

  const fetchRemoteConfig = async () => {
    const result = await getGlobalConfig();
    const normalizedConfig = normalizeAppConfig(result);
    setConfig(normalizedConfig);
    await saveCache(cacheKeys.settings, normalizedConfig);
  };

  const refreshConfig = async () => {
    setLoadingConfig(true);

    try {
      await fetchRemoteConfig();
    } catch {
      const cached = await getCache<AppConfig>(cacheKeys.settings);
      if (cached) {
        setConfig(normalizeAppConfig(cached));
      }
    } finally {
      setLoadingConfig(false);
    }
  };

  useEffect(() => {
    const startupGuard = setTimeout(() => {
      setLoadingConfig(false);
    }, 4000);

    const bootstrap = async () => {
      try {
        const cached = await getCache<AppConfig>(cacheKeys.settings);
        if (cached) {
          setConfig(normalizeAppConfig(cached));
        }
      } finally {
        clearTimeout(startupGuard);
        setLoadingConfig(false);
      }

      void fetchRemoteConfig().catch(() => undefined);
    };

    bootstrap();

    return () => {
      clearTimeout(startupGuard);
    };
  }, []);

  const saveConfigHandler = async (payload: Partial<AppConfig>) => {
    const next = normalizeAppConfig({
      ...config,
      ...payload,
      tenantGateAccess: {
        ...defaultTenantGateAccess,
        ...(config.tenantGateAccess ?? {}),
        ...(payload.tenantGateAccess ?? {}),
        houseRules: payload.tenantGateAccess?.houseRules ?? config.tenantGateAccess?.houseRules ?? [],
      },
      notificacoes: {
        ...config.notificacoes,
        ...(payload.notificacoes ?? {}),
      },
    });
    setConfig(next);
    await saveCache(cacheKeys.settings, next);
    await updateGlobalConfig({ ...payload, temaEscuroAtivo: false });
  };

  const value = useMemo(
    () => ({
      config,
      loadingConfig,
      saveConfig: saveConfigHandler,
      refreshConfig,
    }),
    [config, loadingConfig],
  );

  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>;
};

export const useAppConfig = () => {
  const context = useContext(AppConfigContext);

  if (!context) {
    throw new Error('useAppConfig deve ser usado dentro de AppConfigProvider');
  }

  return context;
};
