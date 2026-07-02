import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  indexedDBLocalPersistence,
  inMemoryPersistence,
  initializeAuth as firebaseInitializeAuth,
  onAuthStateChanged,
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

// アプリ内ブラウザ(LINE等)やプライベートモードでは IndexedDB / localStorage が
// 使えず、単一の persistence だと認証初期化や匿名サインインが失敗/ハングして
// QR読み込み後に真っ白/ローディングのまま止まる。永続化はフォールバック配列で
// 初期化し、利用可能なストレージ(最終的にメモリ)へ自動で降格させる。
export const auth = firebaseInitializeAuth(app, {
  persistence: [
    indexedDBLocalPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
    inMemoryPersistence
  ]
});

// Firestore は永続ローカルキャッシュを有効化する。
// 2回目以降はキャッシュから即描画→裏で最新化。コールド接続/電波弱でも待たされにくい。
// IndexedDB が使えない環境(プライベートモード等)では既定(メモリ)へフォールバック。
// ★ 名前付きDB 'main'(asia-northeast1) を使用。(default) は旧 nam5(米国)で放置。
const FIRESTORE_DATABASE_ID = "main";
const initFirestore = () => {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    }, FIRESTORE_DATABASE_ID);
  } catch (error) {
    console.warn("[firebase] persistent cache unavailable, falling back to memory cache", error);
    return getFirestore(app, FIRESTORE_DATABASE_ID);
  }
};

export const db = initFirestore();
export const functionsApi = getFunctions(app, region);
export const storage = getStorage(app);

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

// persistence は initializeAuth 時にフォールバック配列で確定済みのため、ここでは何もしない。
// 呼び出し側の互換性維持のため関数は残す（await しても即座に解決する）。
export const ensureSessionPersistence = async () => {};

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