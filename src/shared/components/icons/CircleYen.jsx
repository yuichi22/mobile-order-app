import React from 'react';

const CircleYen = ({ size = 24, className = "" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="M8 7l4 5 4-5" />
    <path d="M12 17v-5" />
    <path d="M8 12h8" />
    <path d="M8 15h8" />
  </svg>
);

export default CircleYen;
