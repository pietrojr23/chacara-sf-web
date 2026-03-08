import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { getDataSyncVersion, subscribeDataSync } from '../services/dataSync';

interface DataSyncContextData {
  dataVersion: number;
}

const DataSyncContext = createContext<DataSyncContextData | undefined>(undefined);

export const DataSyncProvider = ({ children }: { children: ReactNode }) => {
  const [dataVersion, setDataVersion] = useState(getDataSyncVersion());

  useEffect(() => subscribeDataSync(() => setDataVersion(getDataSyncVersion())), []);

  const value = useMemo(
    () => ({
      dataVersion,
    }),
    [dataVersion],
  );

  return <DataSyncContext.Provider value={value}>{children}</DataSyncContext.Provider>;
};

export const useDataSync = () => {
  const context = useContext(DataSyncContext);
  if (!context) {
    throw new Error('useDataSync deve ser usado dentro de DataSyncProvider');
  }
  return context;
};

