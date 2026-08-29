import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import '../native-fonts.css';

export async function initializeNativeApp() {
  if (!Capacitor.isNativePlatform()) return;
  document.documentElement.classList.add('native-app');
  if (Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4) {
    document.documentElement.classList.add('constrained-device');
  }
  await Promise.allSettled([
    StatusBar.setStyle({ style: Style.Light }),
    App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        document.querySelectorAll<HTMLMediaElement>('audio, video').forEach((media) => media.pause());
        window.dispatchEvent(new Event('lumina:pause'));
      } else {
        window.dispatchEvent(new Event('lumina:resume'));
      }
    }),
    App.addListener('backButton', () => {
      const element = document.activeElement;
      if (element instanceof HTMLElement && element.matches('input,textarea,[contenteditable="true"]')) {
        element.blur();
        void Keyboard.hide();
      } else if (Number(window.history.state?.idx ?? 0) > 0) {
        window.history.back();
      } else if (location.pathname !== '/app/home' && location.pathname !== '/auth') {
        window.history.pushState({}, '', '/app/home');
        window.dispatchEvent(new PopStateEvent('popstate'));
      } else {
        void App.minimizeApp();
      }
    }),
  ]);
  await SplashScreen.hide();
}
