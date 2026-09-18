import axios from 'axios';
import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc } from './firestoreLiteCompat';
import { getFirebaseDb } from './firebase';
import { AppConfig, GateStatus } from '../types/models';

const db = getFirebaseDb();

export const getGateConfig = async () => {
  const configRef = doc(db, 'configuracoes', 'global');
  const snapshot = await getDoc(configRef);

  return (snapshot.data() ?? null) as AppConfig | null;
};

export const updateGateStatus = async (
  status: GateStatus,
  userId: string,
  userName: string,
  source: 'manual' | 'visitor' = 'manual',
  context?: {
    houseId?: string;
    latitude?: number;
    longitude?: number;
    distanceMeters?: number;
  },
) => {
  const config = await getGateConfig();
  const url = String(config?.gateWebhookUrl ?? config?.gateCloseWebhookUrl ?? '').trim();

  if (url) {
    await axios.post(
      url,
      {
        action: status,
        userId,
        userName,
      },
      { timeout: 8000 },
    );
  }

  await setDoc(
    doc(db, 'configuracoes', 'gateStatus'),
    {
      status,
      updatedBy: userId,
      updatedByName: userName,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  await addDoc(collection(db, 'acessos'), {
    status,
    userId,
    userName,
    source,
    houseId: context?.houseId ?? null,
    latitude: typeof context?.latitude === 'number' ? context.latitude : null,
    longitude: typeof context?.longitude === 'number' ? context.longitude : null,
    distanceMeters: typeof context?.distanceMeters === 'number' ? context.distanceMeters : null,
    createdAt: serverTimestamp(),
  });
};
