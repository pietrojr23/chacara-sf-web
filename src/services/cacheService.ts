import AsyncStorage from '@react-native-async-storage/async-storage';

const prefix = '@chacara_sf';

export const cacheKeys = {
  home: `${prefix}/home`,
  notices: `${prefix}/notices`,
  tickets: `${prefix}/tickets`,
  finance: `${prefix}/finance`,
  settings: `${prefix}/settings`,
  profile: `${prefix}/profile`,
};

export const saveCache = async <T>(key: string, value: T) => {
  await AsyncStorage.setItem(key, JSON.stringify(value));
};

export const getCache = async <T>(key: string): Promise<T | null> => {
  const raw = await AsyncStorage.getItem(key);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};
