import React from 'react';

import { AuthProvider } from './providers/AuthProvider';
import AppRouter from './routing/AppRouter';

const App = () => {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
};

export default App;
