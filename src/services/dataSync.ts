type DataChangeListener = () => void;

let version = 0;
const listeners = new Set<DataChangeListener>();

export const getDataSyncVersion = () => version;

export const subscribeDataSync = (listener: DataChangeListener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const notifyDataChanged = () => {
  version += 1;
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.warn('[dataSync] listener error:', error);
    }
  });
};

