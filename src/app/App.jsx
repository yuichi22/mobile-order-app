import React from 'react';

import { AuthProvider } from './providers/AuthProvider';
import AppRouter from './routing/AppRouter';
import { AppConfirmHost } from '../shared/components/feedback/AppConfirmDialog';

const App = () => {
  return (
    <AuthProvider>
      <AppRouter />
      <AppConfirmHost />
    </AuthProvider>
  );
};

export default App;
