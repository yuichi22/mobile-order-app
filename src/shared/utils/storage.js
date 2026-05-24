export const safeStorage = {
  getItem: (key) => {
    try {
      return window.localStorage ? window.localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      if (window.localStorage) window.localStorage.setItem(key, value);
    } catch {
      return undefined;
    }
  },
  removeItem: (key) => {
    try {
      if (window.localStorage) window.localStorage.removeItem(key);
    } catch {
      return undefined;
    }
  }
};
