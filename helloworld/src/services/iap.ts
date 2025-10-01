import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as RNIap from 'react-native-iap';

const PRODUCT_ID = 'pro_unlock';
const STORAGE_KEY = 'maze:pro';

let connectionReady = false;
let mockMode = false;
let cachedPro = false;
const subscribers = new Set<(value: boolean) => void>();

const notify = (value: boolean) => {
  cachedPro = value;
  subscribers.forEach((listener) => listener(value));
};

const persist = async (value: boolean) => {
  cachedPro = value;
  await AsyncStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  notify(value);
};

const readPersisted = async (): Promise<boolean> => {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  cachedPro = stored === '1';
  return cachedPro;
};

export const initIAP = async () => {
  if (connectionReady || mockMode) {
    return;
  }
  try {
    await RNIap.initConnection();
    await RNIap.flushFailedPurchasesCachedAsPendingAndroid?.();
    connectionReady = true;
  } catch (error) {
    console.warn('IAP connection failed – falling back to mock mode', error);
    mockMode = true;
  }
};

export const getProStatus = async (): Promise<boolean> => {
  if (cachedPro) {
    return cachedPro;
  }
  return readPersisted();
};

export const buyProUnlock = async (): Promise<boolean> => {
  await initIAP();
  if (mockMode) {
    await persist(true);
    return true;
  }
  try {
    const sku = Platform.select({ ios: PRODUCT_ID, android: PRODUCT_ID });
    if (!sku) {
      return false;
    }
    const purchaseResult = await RNIap.requestPurchase({ sku });
    if (!purchaseResult) {
      return false;
    }
    const purchases = Array.isArray(purchaseResult) ? purchaseResult : [purchaseResult];
    if (purchases.length) {
      try {
        for (const item of purchases) {
          await RNIap.finishTransaction({ purchase: item, isConsumable: false });
        }
      } catch (finishError) {
        console.warn('Failed to finish transaction', finishError);
      }
      await persist(true);
      return true;
    }
  } catch (error) {
    console.warn('Purchase failed', error);
  }
  return false;
};

export const restorePurchases = async (): Promise<boolean> => {
  await initIAP();
  if (mockMode) {
    return cachedPro;
  }
  try {
    const purchases = await RNIap.getAvailablePurchases();
    const owned = purchases.some((item) => item.productId === PRODUCT_ID);
    if (owned) {
      await persist(true);
    }
    return owned;
  } catch (error) {
    console.warn('Restore failed', error);
    return false;
  }
};

export const useProStatus = (): boolean => {
  const [value, setValue] = useState<boolean>(cachedPro);

  useEffect(() => {
    let mounted = true;
    getProStatus().then((status) => {
      if (mounted) {
        setValue(status);
      }
    });
    const handler = (status: boolean) => {
      if (mounted) {
        setValue(status);
      }
    };
    subscribers.add(handler);
    return () => {
      mounted = false;
      subscribers.delete(handler);
    };
  }, []);

  return value;
};

export const clearProStatus = async () => {
  await persist(false);
};

export const iap = {
  init: initIAP,
  buyProUnlock,
  restorePurchases,
  getProStatus,
};
