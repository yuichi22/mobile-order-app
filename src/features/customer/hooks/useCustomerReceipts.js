import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '../../../shared/api/firebase/client';

const normalizeId = (value) => String(value || '').trim();

const includesId = (values, targetId) => {
  const normalizedTargetId = normalizeId(targetId);
  if (!normalizedTargetId) return false;

  if (!Array.isArray(values)) return false;

  return values.some((value) => normalizeId(value) === normalizedTargetId);
};

const isReceiptForCustomer = (receipt, { participantId, userId }) => {
  const normalizedParticipantId = normalizeId(participantId);
  const normalizedUserId = normalizeId(userId);

  if (!receipt) return false;

  if (
    normalizedParticipantId
    && (
      normalizeId(receipt.participantId) === normalizedParticipantId
      || normalizeId(receipt.customerId) === normalizedParticipantId
      || includesId(receipt.participantIds, normalizedParticipantId)
      || includesId(receipt.customerIds, normalizedParticipantId)
    )
  ) {
    return true;
  }

  if (
    normalizedUserId
    && (
      normalizeId(receipt.userId) === normalizedUserId
      || normalizeId(receipt.customerUid) === normalizedUserId
      || includesId(receipt.userIds, normalizedUserId)
      || includesId(receipt.customerIds, normalizedUserId)
    )
  ) {
    return true;
  }

  return false;
};

export const useCustomerReceipts = ({
  sessionId,
  storeId,
  participantId,
  userId = ''
}) => {
  const [receipts, setReceipts] = useState([]);
  const [receiptsLoading, setReceiptsLoading] = useState(Boolean(sessionId && storeId));

  useEffect(() => {
    const normalizedSessionId = normalizeId(sessionId);
    const normalizedStoreId = normalizeId(storeId);
    const normalizedParticipantId = normalizeId(participantId);
    const normalizedUserId = normalizeId(userId);

    if (!normalizedSessionId || !normalizedStoreId || !normalizedUserId) {
      setReceipts([]);
      setReceiptsLoading(false);
      return undefined;
    }

    setReceiptsLoading(true);

    const receiptConstraints = [
      where('sessionId', '==', normalizedSessionId)
    ];

    if (normalizedParticipantId) {
      receiptConstraints.push(where('customerIds', 'array-contains', normalizedParticipantId));
    } else if (normalizedUserId) {
      receiptConstraints.push(where('customerIds', 'array-contains', normalizedUserId));
    }

    const receiptsQuery = query(
      collection(db, 'stores', normalizedStoreId, 'receipts'),
      ...receiptConstraints
    );

    return onSnapshot(
      receiptsQuery,
      (snapshot) => {
        const fetchedReceipts = snapshot.docs
          .map((snapshotDoc) => {
            const data = snapshotDoc.data();

            return {
              id: snapshotDoc.id,
              ...data,
              issuedAt: data.issuedAt?.toDate ? data.issuedAt.toDate() : null,
              createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : null
            };
          })
          .filter((receipt) => (
            isReceiptForCustomer(receipt, {
              participantId: normalizedParticipantId,
              userId: normalizedUserId
            })
          ))
          .sort((left, right) => {
            const leftTime = left.issuedAt?.getTime?.() || left.createdAt?.getTime?.() || 0;
            const rightTime = right.issuedAt?.getTime?.() || right.createdAt?.getTime?.() || 0;
            return rightTime - leftTime;
          });

        setReceipts(fetchedReceipts);
        setReceiptsLoading(false);
      },
      (error) => {
        console.warn('[useCustomerReceipts] failed', {
          error,
          sessionId: normalizedSessionId,
          storeId: normalizedStoreId,
          participantId: normalizedParticipantId,
          userId: normalizedUserId
        });

        setReceipts([]);
        setReceiptsLoading(false);
      }
    );
  }, [sessionId, storeId, participantId, userId]);

  return {
    receipts,
    latestReceipt: receipts[0] || null,
    receiptsLoading
  };
};