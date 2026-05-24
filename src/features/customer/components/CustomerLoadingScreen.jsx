import React from 'react';

import LoadingSpinner from '../../../shared/components/feedback/LoadingSpinner';

const CustomerLoadingScreen = ({ message }) => (
  <div className="flex h-screen flex-col items-center justify-center bg-white p-6 text-center">
    <LoadingSpinner size={28} colorClass="text-gray-300" />
    {message && (
      <p className="mt-4 text-sm font-bold text-gray-400">{message}</p>
    )}
  </div>
);

export default CustomerLoadingScreen;