import React from 'react';
import { Loader } from 'lucide-react';

const LoadingSpinner = ({ size = 24, className = '', colorClass = 'text-gray-300' }) => (
  <Loader size={size} className={`animate-spin ${colorClass} ${className}`.trim()} />
);

export default LoadingSpinner;
