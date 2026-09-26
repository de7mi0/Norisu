import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Saloni as a native app.
 *
 * Capacitor does not rewrite anything: it puts this same React build inside a
 * native shell — a full-screen WebView with no address bar — and adds a bridge
 * to the things a web page cannot reach. The screens, the Arabic layout and
 * every migration behind them are unchanged.
 *
 * `appId` IS PERMANENT once the app is published to Google Play. It cannot be
 * changed afterwards: a different id is a different app, with a different
 * listing and no way to move existing installs across. Change it now if you
 * want something else; after the first release it is settled forever.
 *
 * `webDir` is the folder `npm run build` writes, so `npx cap sync` copies that
 * build into the native project. Note what this means day to day: the web
 * files are bundled INSIDE the app, so a change is only in people's hands
 * after a new release and a store review. The web version at
 * de7mi0.github.io keeps updating in forty seconds; the app does not.
 */
const config: CapacitorConfig = {
  appId: 'com.saloni.app',
  appName: 'Saloni',
  webDir: 'dist',
  android: {
    // The app's own background while the WebView starts, so the first frame is
    // Saloni's dark rather than a white flash.
    backgroundColor: '#1c1913',
  },
};

export default config;
