import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'college.lumina.mobile',
  appName: 'Lumina',
  webDir: 'dist-mobile',
  loggingBehavior: 'debug',
  server: { hostname: 'localhost', androidScheme: 'https', errorPath: 'webview-error.html' },
  android: { path: 'mobile/android', backgroundColor: '#f7f5ef', allowMixedContent: false, minWebViewVersion: 111 },
  plugins: {
    SplashScreen: { launchAutoHide: true, launchShowDuration: 500, backgroundColor: '#f7f5ef', showSpinner: false },
    Keyboard: { resizeOnFullScreen: true },
  },
};

export default config;
