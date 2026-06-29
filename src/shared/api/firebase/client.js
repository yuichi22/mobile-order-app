import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithCustomToken
} from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

const requiredEnv = (key) => {
  const value = import.meta.env[key];
  if (!value) {
    throw new Error(`[firebase] Missing env: ${key}`);
  }
  return value;
};

const firebaseConfig = {
  apiKey: requiredEnv("VITE_FIREBASE_API_KEY"),
  authDomain: requiredEnv("VITE_FIREBASE_AUTH_DOMAIN"),
  projectId: requiredEnv("VITE_FIREBASE_PROJECT_ID"),
  storageBucket: requiredEnv("VITE_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: requiredEnv("VITE_FIREBASE_MESSAGING_SENDER_ID"),
  appId: requiredEnv("VITE_FIREBASE_APP_ID"),
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || undefined
};

const region = import.meta.env.VITE_FUNCTIONS_REGION || "asia-northeast1";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Firestore は永続ローカルキャッシュを有効化する。
// 2回目以降はキャッシュから即描画→裏で最新化。コールド接続/電波弱でも待たされにくい。
// IndexedDB が使えない環境(プライベートモード等)では既定(メモリ)へフォールバック。
const initFirestore = () => {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
  } catch (error) {
    console.warn("[firebase] persistent cache unavailable, falling back to memory cache", error);
    return getFirestore(app);
  }
};

export const db = initFirestore();
export const functionsApi = getFunctions(app, region);
export const storage = getStorage(app);

let persistencePromise = null;

const runtimeAppId =
  typeof globalThis !== "undefined" && typeof globalThis.__app_id !== "undefined"
    ? globalThis.__app_id
    : import.meta.env.VITE_APP_ID || firebaseConfig.projectId;

const initialAuthToken =
  typeof globalThis !== "undefined" && typeof globalThis.__initial_auth_token !== "undefined"
    ? globalThis.__initial_auth_token
    : null;

export const appId = runtimeAppId;
export const firebaseProjectId = firebaseConfig.projectId;

export const ensureSessionPersistence = async () => {
  if (!persistencePromise) {
    persistencePromise = setPersistence(auth, browserLocalPersistence).catch((error) => {
      persistencePromise = null;
      throw error;
    });
  }

  await persistencePromise;
};

export const waitForAuthReady = async () => {
  if (typeof auth.authStateReady === "function") {
    await auth.authStateReady();
    return;
  }

  await new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, () => {
      unsubscribe();
      resolve();
    });
  });
};

export const initializeAuth = async () => {
  await ensureSessionPersistence();
  await waitForAuthReady();

  if (auth.currentUser) return;

  try {
    if (initialAuthToken) {
      await signInWithCustomToken(auth, initialAuthToken);
    }
  } catch (e) {
    console.warn("Auth initialization warning:", e);
  }
};