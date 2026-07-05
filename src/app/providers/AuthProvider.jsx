import React, { useEffect, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut
} from 'firebase/auth';
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc
} from 'firebase/firestore';

import { auth, db, ensureSessionPersistence } from '../../shared/api/firebase/client';
import { createAppAuthError } from '../../shared/utils/authErrorMessages';
import { createInvitedMember } from '../../features/auth/services/inviteRegistrationService';
import {
  sendCurrentUserVerificationMail,
  sendVerificationMailForCredentials
} from '../../features/auth/services/emailVerificationService';
import { createOwnerAccount } from '../../features/auth/services/ownerRegistrationService';
import { AuthContext } from './AuthContext';
import { normalizeUserRole, USER_ROLES } from '../../shared/utils/roles';
import { normalizeStoreAccessStatus } from '../../shared/utils/storeAccess';
import AppLoading from '../../shared/components/feedback/AppLoading';

// 認証初期化(persistence / onAuthStateChanged / プロフィール取得)が何らかの理由で
// 完了しなくても、この時間で必ず描画に進ませる保険。アプリ内ブラウザ(LINE等)や
// プライベートモードで IndexedDB が刺さると loading が永久 true になり画面が
// 真っ白のまま固まる事象への対策。
const AUTH_INIT_WATCHDOG_MS = 5000;

const createOwnerSeed = () => ({
  role: USER_ROLES.OWNER,
  storeId: `store_${Math.random().toString(36).substring(2, 7)}`
});

const buildUserProfile = (user, profile) => ({
  uid: user.uid,
  email: user.email,
  name: profile.name || '',
  role: profile.role,
  storeId: profile.storeId,
  createdAt: serverTimestamp()
});

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [storeId, setStoreId] = useState(null);
  const [role, setRole] = useState(null);
  const [profileName, setProfileName] = useState('');
  const [storeAccessStatus, setStoreAccessStatus] = useState('active');
  const [loading, setLoading] = useState(true);
  const pendingProfileRef = useRef(null);

  const login = async (email, password) => {
    await ensureSessionPersistence();
    const result = await signInWithEmailAndPassword(auth, email, password);

    const userDoc = await getDoc(doc(db, 'users', result.user.uid));
    if (!userDoc.exists()) {
      await firebaseSignOut(auth);
      throw createAppAuthError('app/account-removed');
    }

    return result;
  };

  const provisionUserProfile = async (user, profile) => {
    const userDocRef = doc(db, 'users', user.uid);

    if (!profile?.inviteCode) {
      await setDoc(userDocRef, buildUserProfile(user, profile), { merge: true });
      return;
    }

    const inviteRef = doc(db, 'stores', profile.storeId, 'staffInvites', profile.inviteCode);

    await runTransaction(db, async (transaction) => {
      const inviteSnapshot = await transaction.get(inviteRef);
      if (!inviteSnapshot.exists()) {
        throw createAppAuthError('app/invite-not-found');
      }

      const inviteData = inviteSnapshot.data();
      const inviteRole = normalizeUserRole(inviteData.role);
      const isExpired = inviteData.expiresAt?.toDate && inviteData.expiresAt.toDate() <= new Date();
      const alreadyUsedByCurrentUser = inviteData.status === 'used' && inviteData.usedBy === user.uid;

      if ((!alreadyUsedByCurrentUser && inviteData.status !== 'active') || isExpired) {
        throw createAppAuthError('app/invite-unavailable');
      }

      if (inviteRole !== profile.role || inviteData.storeId !== profile.storeId) {
        throw createAppAuthError('app/invite-mismatch');
      }

      transaction.set(userDocRef, {
        ...buildUserProfile(user, profile),
        inviteCode: profile.inviteCode
      }, { merge: true });

      if (!alreadyUsedByCurrentUser) {
        transaction.update(inviteRef, {
          status: 'used',
          usedBy: user.uid,
          usedAt: serverTimestamp()
        });
      }
    });
  };

  const signup = async (email, password, options = {}) => {
    let createdUser = null;

    try {
      await ensureSessionPersistence();
      const normalizedName = String(options.name || '').trim();

      if (options.inviteCode) {
        await createInvitedMember({
          email,
          password,
          name: normalizedName,
          inviteCode: options.inviteCode,
          storeId: options.inviteStoreId
        });
        await sendVerificationMailForCredentials(email, password);
        pendingProfileRef.current = null;
        return { invited: true, verificationSent: true };
      }

      const profile = createOwnerSeed();
      if (normalizedName) {
        profile.name = normalizedName;
      }
      pendingProfileRef.current = profile;

      const result = await createUserWithEmailAndPassword(auth, email, password);
      createdUser = result.user;

      await provisionUserProfile(createdUser, profile);
      await sendCurrentUserVerificationMail();
      pendingProfileRef.current = null;

      return result.user;
    } catch (error) {
      if (!options.inviteCode && error?.code === 'auth/email-already-in-use') {
        pendingProfileRef.current = null;
        await createOwnerAccount({
          email,
          password,
          name: String(options.name || '').trim()
        });
        await sendVerificationMailForCredentials(email, password);
        return { ownerRegistered: true, verificationSent: true };
      }

      pendingProfileRef.current = null;
      if (createdUser) {
        try {
          await deleteUser(createdUser);
        } catch (deleteError) {
          console.warn('User cleanup warning:', deleteError);
        }
      }
      throw error;
    }
  };

  const logout = async () => {
    setStoreId(null);
    setRole(null);
    setProfileName('');
    setStoreAccessStatus('active');
    await firebaseSignOut(auth);
  };

  useEffect(() => {
    let isMounted = true;
    let settled = false;

    const finishLoading = () => {
      if (!isMounted || settled) return;
      settled = true;
      setLoading(false);
    };

    // persistence はベストエフォート。ここで await してブロックすると、IndexedDB が
    // 使えない環境(アプリ内ブラウザ/プライベートモード)で認証リスナー登録前に固まり、
    // loading が永久 true → 画面が真っ白のままになる。await せず並行実行する。
    // sign-in 側(initializeAuth)は別途 ensureSessionPersistence を await するため、
    // 永続化の適用タイミングは担保される。
    ensureSessionPersistence().catch((error) => {
      console.error('Auth persistence setup error:', error);
    });

    // 認証初期化が完了しなくても一定時間で必ず描画に進ませる保険。
    const watchdog = window.setTimeout(finishLoading, AUTH_INIT_WATCHDOG_MS);

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
        setCurrentUser(user);

        const params = new URLSearchParams(window.location.search);
        const urlStoreId = params.get('store_id');
        let detectedStoreId = user?.isAnonymous ? urlStoreId : null;
        let detectedRole = null;
        let detectedStoreAccessStatus = 'active';

        if (user && !user.isAnonymous) {
          try {
            const userDocRef = doc(db, 'users', user.uid);
            let userDoc = await getDoc(userDocRef);

            if (!userDoc.exists()) {
              const pendingProfile = pendingProfileRef.current;

              if (pendingProfile) {
                await provisionUserProfile(user, pendingProfile);
                userDoc = await getDoc(userDocRef);
                pendingProfileRef.current = null;
              } else {
                await firebaseSignOut(auth);
                setCurrentUser(null);
                setStoreId(null);
                setRole(null);
                setProfileName('');
                finishLoading();
                return;
              }
            }

            if (userDoc.exists()) {
              const userData = userDoc.data();
              detectedStoreId = userData.storeId;
              detectedRole = normalizeUserRole(userData.role);
              setProfileName(userData.name || '');

              const platformAdminSnapshot = await getDoc(doc(db, 'platformAdmins', user.uid));
              if (
                platformAdminSnapshot.exists() &&
                normalizeUserRole(platformAdminSnapshot.data()?.role) === USER_ROLES.SUPER_ADMIN
              ) {
                detectedRole = USER_ROLES.SUPER_ADMIN;
              }

              if (detectedStoreId) {
                const accessSnapshot = await getDoc(doc(db, 'stores', detectedStoreId, 'settings', 'platformAccess'));
                if (accessSnapshot.exists()) {
                  detectedStoreAccessStatus = normalizeStoreAccessStatus(accessSnapshot.data()?.storeStatus);
                }
              }
            }
          } catch (error) {
            console.error('User data fetch error:', error);
            // トークン更新やネットワーク瞬断で users/{uid} の取得が一時的に失敗した際に、
            // ログイン中ユーザーの店舗コンテキスト(storeId/role/access)を null に落とすと、
            // 全 Firestore 購読が `if (!storeId) return` で一斉に detach され、
            // お気に入り/ロゴ/テーブル等が画面から突然消える。既知の状態は維持し、
            // 描画だけ進めて次回の認証再解決に復帰を委ねる(データ側は無事)。
            finishLoading();
            return;
          }
        } else if (!user) {
          setProfileName('');
          // 一過性の null(トークン更新中/永続化レース/タブ間同期)で店舗コンテキストを
          // クリアすると activeStoreId が一瞬 null になり、お気に入り/ロゴ/テーブル/
          // カテゴリー等の全購読が同時に detach され画面から消える。明示ログアウトは
          // logout() が state をクリア済みなので、ここでは保持して次の再解決に委ねる。
          finishLoading();
          return;
        }

        setStoreId(detectedStoreId);
        setRole(detectedRole);
        setStoreAccessStatus(detectedStoreAccessStatus);
        finishLoading();
      });

    return () => {
      isMounted = false;
      window.clearTimeout(watchdog);
      unsubscribe();
    };
  }, []);

  const value = { currentUser, storeId, role, profileName, storeAccessStatus, login, signup, logout, loading };

  return (
    <AuthContext.Provider value={value}>
      {loading ? <AppLoading /> : children}
    </AuthContext.Provider>
  );
};
