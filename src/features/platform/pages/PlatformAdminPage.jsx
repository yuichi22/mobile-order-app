import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import {
  Building2,
  ChevronRight,
  Layers3,
  ShieldCheck,
  Store,
  TriangleAlert
} from 'lucide-react';

import { useAuth } from '../../../app/providers/useAuth';
import { db } from '../../../shared/api/firebase/client';
import LoadingSpinner from '../../../shared/components/feedback/LoadingSpinner';
import { USER_ROLES, normalizeUserRole } from '../../../shared/utils/roles';

const getStoreId = (storeDoc) => {
  const data = storeDoc.data() || {};
  return data.id || storeDoc.id;
};

const PlatformAdminPage = ({ onOpenOwnStoreAdmin }) => {
  const { role, storeId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [organizations, setOrganizations] = useState([]);
  const [stores, setStores] = useState([]);
  const [error, setError] = useState('');

  const isSuperAdmin = normalizeUserRole(role) === USER_ROLES.SUPER_ADMIN;

  useEffect(() => {
    let cancelled = false;

    const loadPlatformData = async () => {
      if (!isSuperAdmin) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');

      try {
        const [organizationSnapshot, storeSnapshot] = await Promise.all([
          getDocs(collection(db, 'platformOrganizations')),
          getDocs(collection(db, 'stores'))
        ]);

        const organizationRows = organizationSnapshot.docs.map((organizationDoc) => {
          const data = organizationDoc.data() || {};
          return {
            id: data.id || organizationDoc.id,
            name: data.name || organizationDoc.id,
            type: data.type || 'single',
            status: data.status || 'active',
            ownerEmail: data.ownerEmail || ''
          };
        });

        const storeRows = await Promise.all(
          storeSnapshot.docs.map(async (storeDoc) => {
            const storeData = storeDoc.data() || {};
            const id = getStoreId(storeDoc);
            let basic = {};

            try {
              const basicSnapshot = await getDoc(doc(db, 'stores', id, 'settings', 'basic'));
              if (basicSnapshot.exists()) {
                basic = basicSnapshot.data() || {};
              }
            } catch (basicError) {
              console.warn('[PlatformAdminPage] basic settings load failed', id, basicError);
            }

            return {
              id,
              organizationId: storeData.organizationId || '',
              organizationName: storeData.organizationName || '',
              organizationType: storeData.organizationType || '',
              name: basic.name || id,
              address: basic.address || '',
              tel: basic.tel || '',
              logoUrl: basic.customerLogoUrl || '',
              status: storeData.status || 'active'
            };
          })
        );

        if (!cancelled) {
          setOrganizations(organizationRows.sort((a, b) => a.name.localeCompare(b.name, 'ja')));
          setStores(storeRows.sort((a, b) => a.name.localeCompare(b.name, 'ja')));
        }
      } catch (loadError) {
        console.error('[PlatformAdminPage] load failed', loadError);
        if (!cancelled) {
          setError('プラットフォーム情報の読み込みに失敗しました。');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadPlatformData();

    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin]);

  const organizationCards = useMemo(() => {
    const knownOrganizationIds = new Set(organizations.map((organization) => organization.id));
    const orphanStores = stores.filter((store) => !store.organizationId || !knownOrganizationIds.has(store.organizationId));

    const cards = organizations.map((organization) => ({
      ...organization,
      stores: stores.filter((store) => store.organizationId === organization.id)
    }));

    if (orphanStores.length) {
      cards.push({
        id: 'unassigned',
        name: '未所属の店舗',
        type: 'unassigned',
        status: 'attention',
        ownerEmail: '',
        stores: orphanStores
      });
    }

    return cards;
  }, [organizations, stores]);

  if (!isSuperAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-3xl bg-white p-8 text-center shadow-sm">
          <TriangleAlert className="mx-auto mb-4 h-12 w-12 text-orange-400" />
          <h1 className="text-xl font-black text-slate-900">アクセス権限がありません</h1>
          <p className="mt-3 text-sm font-bold leading-6 text-slate-500">
            この画面はスーパーアドミン専用です。
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-8 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 rounded-3xl bg-white p-6 shadow-sm">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-xs font-black text-white">
            <ShieldCheck size={15} strokeWidth={3} />
            SUPER ADMIN
          </div>

          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-2xl font-black tracking-tight md:text-3xl">
                Akuto プラットフォーム管理
              </h1>
              <p className="mt-2 text-sm font-bold text-slate-500">
                チェーン・運営組織ごとに店舗を管理します。
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-slate-50 px-5 py-4 text-right">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                  Organizations
                </div>
                <div className="mt-1 text-2xl font-black text-slate-900">
                  {organizations.length}
                </div>
              </div>
              <div className="rounded-2xl bg-slate-50 px-5 py-4 text-right">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                  Stores
                </div>
                <div className="mt-1 text-2xl font-black text-slate-900">
                  {stores.length}
                </div>
              </div>
            </div>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm font-bold text-red-600">
            {error}
          </div>
        )}

        <div className="space-y-5">
          {organizationCards.map((organization) => (
            <section key={organization.id} className="rounded-3xl bg-white p-5 shadow-sm">
              <div className="mb-5 flex flex-col gap-3 border-b border-slate-100 pb-5 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100">
                    <Layers3 className="h-6 w-6 text-slate-500" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-black text-slate-900">
                      {organization.name}
                    </h2>
                    <p className="mt-1 text-xs font-bold text-slate-400">
                      {organization.id} / {organization.type} / {organization.status}
                    </p>
                    {organization.ownerEmail && (
                      <p className="mt-1 text-xs font-bold text-slate-400">
                        {organization.ownerEmail}
                      </p>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-black text-slate-600">
                  {organization.stores.length}店舗
                </div>
              </div>

              <div className="grid gap-3">
                {organization.stores.map((store) => (
                  <article
                    key={store.id}
                    className="flex flex-col gap-4 rounded-2xl border border-slate-100 p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-100">
                        {store.logoUrl ? (
                          <img src={store.logoUrl} alt={store.name} className="h-full w-full object-contain p-2" />
                        ) : (
                          <Building2 className="h-6 w-6 text-slate-400" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <h3 className="truncate text-base font-black text-slate-900">
                          {store.name}
                        </h3>
                        <p className="mt-1 text-xs font-bold text-slate-400">
                          {store.id}
                        </p>
                        {(store.address || store.tel) && (
                          <p className="mt-1 text-sm font-semibold text-slate-500">
                            {[store.address, store.tel].filter(Boolean).join(' / ')}
                          </p>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenOwnStoreAdmin?.(store.id)}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 text-sm font-black text-white shadow-sm transition-all hover:bg-slate-800 active:scale-95"
                    >
                      <Store size={16} strokeWidth={3} />
                      店舗管理を開く
                      <ChevronRight size={16} strokeWidth={3} />
                    </button>
                  </article>
                ))}

                {!organization.stores.length && (
                  <div className="rounded-2xl bg-slate-50 p-5 text-center text-sm font-bold text-slate-400">
                    この組織に紐づく店舗はまだありません。
                  </div>
                )}
              </div>
            </section>
          ))}

          {!organizationCards.length && !error && (
            <div className="rounded-3xl bg-white p-10 text-center shadow-sm">
              <p className="text-sm font-bold text-slate-500">
                組織・店舗がまだ登録されていません。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlatformAdminPage;
