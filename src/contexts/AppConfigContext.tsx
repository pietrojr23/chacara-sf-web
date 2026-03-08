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

const defaultConfig: AppConfig = {
  propriedadeNome: 'Chácara São Francisco',
  chavePix: '',
  tarifaEnergia: 0,
  gateWebhookUrl: '',
  gateCloseWebhookUrl: '',
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

const AppConfigContext = createContext<AppConfigContextData | undefined>(undefined);

export const AppConfigProvider = ({ children }: { children: ReactNode }) => {
  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [loadingConfig, setLoadingConfig] = useState(true);

  const fetchRemoteConfig = async () => {
    const result = await getGlobalConfig();
    setConfig({ ...defaultConfig, ...result });
    await saveCache(cacheKeys.settings, result);
  };

  const refreshConfig = async () => {
    setLoadingConfig(true);

    try {
      await fetchRemoteConfig();
    } catch {
      const cached = await getCache<AppConfig>(cacheKeys.settings);
      if (cached) {
        setConfig({ ...defaultConfig, ...cached });
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
          setConfig({ ...defaultConfig, ...cached });
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
    const next = { ...config, ...payload };
    setConfig(next);
    await saveCache(cacheKeys.settings, next);
    await updateGlobalConfig(payload);
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
