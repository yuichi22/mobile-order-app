import React from 'react';

import KitchenApp from '../KitchenApp';

const KitchenPage = ({ storeId, onBack, onSwitchToRegister, onSwitchToSettings }) => (
  <KitchenApp
    storeId={storeId}
    onBack={onBack}
    onSwitchToRegister={onSwitchToRegister}
    onSwitchToSettings={onSwitchToSettings}
  />
);

export default KitchenPage;