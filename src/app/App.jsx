import React from 'react';

import { AuthProvider } from './providers/AuthProvider';
import AppRouter from './routing/AppRouter';
import CoreSpaceLinkGuard from './routing/CoreSpaceLinkGuard';
import { AppConfirmHost } from '../shared/components/feedback/AppConfirmDialog';

const App = () => {
  return (
    <AuthProvider>
      <AppRouter />
      {/* Akuto Core ポータルの「開く」リンク(?tenantId&spaceId&app)の拠点突き合わせ */}
      <CoreSpaceLinkGuard />
      <AppConfirmHost />
    </AuthProvider>
  );
};

export default App;
