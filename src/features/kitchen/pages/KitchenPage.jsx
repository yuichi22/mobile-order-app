import React from 'react';

import KitchenApp from '../KitchenApp';

const KitchenPage = ({ storeId, onBack, onSwitchToRegister }) => (
  <KitchenApp
    storeId={storeId}
    onBack={onBack}
    onSwitchToRegister={onSwitchToRegister}
  />
);

export default KitchenPage;