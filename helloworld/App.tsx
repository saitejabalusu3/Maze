// Runtime guard: some dev builds (Expo dev client / simulator) may not have
// the RNGoogleMobileAds native module registered in the binary. When that
// happens, calls into TurboModuleRegistry.getEnforcing('RNGoogleMobileAdsModule')
// throw an invariant which prevents the JS app from registering "main".
// We add a narrow shim here that intercepts that specific lookup and returns
// a harmless stub so the app can continue running. This only affects the
// missing RNGoogleMobileAds case and preserves normal TurboModule behavior
// for other modules.
try {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globalAny: any = globalThis as any;
  if (globalAny.TurboModuleRegistry && typeof globalAny.TurboModuleRegistry.getEnforcing === 'function') {
    const original = globalAny.TurboModuleRegistry.getEnforcing.bind(globalAny.TurboModuleRegistry);
    globalAny.TurboModuleRegistry.getEnforcing = (name: string) => {
      if (name === 'RNGoogleMobileAdsModule') {
        // Return a minimal stub object rather than throwing. The ads service
        // does a runtime require and guards for missing methods, so return an
        // empty object.
        return {};
      }
      return original(name);
    };
  }
} catch (e) {
  // If anything goes wrong here, don't block app startup.
}

import React, { useEffect } from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import GameScreen from './src/screens/GameScreen';
import { theme } from './src/theme';
import { initIAP } from './src/services/iap';

const App: React.FC = () => {
  useEffect(() => {
    // Lazy-require ads to avoid evaluating native-dependent modules during
    // module initialization. Some native modules throw if the native
    // counterpart isn't present in the binary (TurboModuleRegistry errors).
    // We catch and ignore any errors so the app can run in dev without the
    // native ads module linked.
    try {
      // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
      const adsService = require('./src/services/ads').ads as { init: () => Promise<void> } | undefined;
      if (adsService && typeof adsService.init === 'function') {
        adsService.init().catch((error: any) => console.warn('Ads init failed', error));
      }
    } catch (e) {
      // Ignore require errors; this means the ads package or its native
      // module isn't available in this build.
      console.warn('Ads service not available at runtime', e);
    }

    initIAP().catch((error) => console.warn('IAP init failed', error));
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.safeArea}>
        <GameScreen />
      </SafeAreaView>
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
});

export default App;
