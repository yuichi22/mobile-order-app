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
    let unsubscribe = () => {};
    let isMounted = true;

    const setupAuthListener = async () => {
      try {
        await ensureSessionPersistence();
      } catch (error) {
        console.error('Auth persistence setup error:', error);
      }

      if (!isMounted) return;

      unsubscribe = onAuthStateChanged(auth, async (user) => {
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
                setLoading(false);
                return;
              }
            }

            if (userDoc.exists()) {
              const userData = userDoc.data();
              detectedStoreId = userData.storeId;
              detectedRole = normalizeUserRole(userData.role);
              setProfileName(userData.name || '');

              if (detectedStoreId) {
                const accessSnapshot = await getDoc(doc(db, 'stores', detectedStoreId, 'settings', 'platformAccess'));
                if (accessSnapshot.exists()) {
                  detectedStoreAccessStatus = normalizeStoreAccessStatus(accessSnapshot.data()?.storeStatus);
                }
              }
            }
          } catch (error) {
            console.error('User data fetch error:', error);
          }
        } else if (!user) {
          setProfileName('');
        }

        setStoreId(detectedStoreId);
        setRole(detectedRole);
        setStoreAccessStatus(detectedStoreAccessStatus);
        setLoading(false);
      });
    };

    setupAuthListener();

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const value = { currentUser, storeId, role, profileName, storeAccessStatus, login, signup, logout, loading };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
