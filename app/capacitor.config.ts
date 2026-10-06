import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.memoria.tracker',
  appName: 'Memoria',
  webDir: 'dist',
  android: {
    path: '../android',
    backgroundColor: '#0c0d0f',
  },
};

export default config;
