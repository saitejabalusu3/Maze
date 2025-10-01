// We import react-native-google-mobile-ads at runtime using require so the
// app can still run when the native module isn't linked (for example when
// running an Expo dev build that doesn't include the native package).
// If the module is missing we provide safe no-op behaviour.
let mobileAdsLib: any = null;
let AdEventType: any = null;
let MaxAdContentRating: any = null;
let RewardedAd: any = null;
let RewardedAdEventType: any = null;
let InterstitialAd: any = null;
let TestIds: any = null;

const ensureLib = () => {
  if (mobileAdsLib !== null) return mobileAdsLib;
  try {
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    mobileAdsLib = require('react-native-google-mobile-ads');
    // pull helpers we use
    AdEventType = mobileAdsLib.AdEventType;
    MaxAdContentRating = mobileAdsLib.MaxAdContentRating;
    RewardedAd = mobileAdsLib.RewardedAd;
    RewardedAdEventType = mobileAdsLib.RewardedAdEventType;
    InterstitialAd = mobileAdsLib.InterstitialAd;
    TestIds = mobileAdsLib.TestIds;
    return mobileAdsLib;
  } catch (e) {
    // Module not available; mark as missing and return null
    mobileAdsLib = null;
    return null;
  }
};

const REWARDED_ID = () => (TestIds ? TestIds.REWARDED : '');
const INTERSTITIAL_ID = () => (TestIds ? TestIds.INTERSTITIAL : '');

let rewardedAd: any = null;
let interstitialAd: any = null;
let rewardedLoaded = false;
let interstitialLoaded = false;

const loadRewarded = () => {
  const lib = ensureLib();
  if (!lib || !RewardedAd) return;

  if (!rewardedAd) {
    rewardedAd = RewardedAd.createForAdRequest(REWARDED_ID(), {
      requestNonPersonalizedAdsOnly: true,
    });
  }

  // If the ad object exposes listeners, wire them up. If not, bail quietly.
  if (typeof rewardedAd.removeAllListeners === 'function') {
    rewardedAd.removeAllListeners();
  }

  if (typeof rewardedAd.addAdEventListener === 'function') {
    rewardedAd.addAdEventListener(RewardedAdEventType.LOADED, () => {
      rewardedLoaded = true;
    });
    rewardedAd.addAdEventListener(AdEventType.ERROR, () => {
      rewardedLoaded = false;
    });
    rewardedAd.addAdEventListener(AdEventType.CLOSED, () => {
      rewardedLoaded = false;
      rewardedAd?.load();
    });
  }

  if (typeof rewardedAd.load === 'function') rewardedAd.load();
};

const loadInterstitial = () => {
  const lib = ensureLib();
  if (!lib || !InterstitialAd) return;

  if (!interstitialAd) {
    interstitialAd = InterstitialAd.createForAdRequest(INTERSTITIAL_ID(), {
      requestNonPersonalizedAdsOnly: true,
    });
  }

  if (typeof interstitialAd.removeAllListeners === 'function') {
    interstitialAd.removeAllListeners();
  }

  if (typeof interstitialAd.addAdEventListener === 'function') {
    interstitialAd.addAdEventListener(AdEventType.LOADED, () => {
      interstitialLoaded = true;
    });
    interstitialAd.addAdEventListener(AdEventType.ERROR, () => {
      interstitialLoaded = false;
    });
    interstitialAd.addAdEventListener(AdEventType.CLOSED, () => {
      interstitialLoaded = false;
      interstitialAd?.load();
    });
  }

  if (typeof interstitialAd.load === 'function') interstitialAd.load();
};

const ensureMobileAds = async () => {
  const lib = ensureLib();
  if (!lib || typeof lib !== 'function' && typeof lib.default === 'undefined') return;

  try {
    // mobileAds is a function default export; call it to get the API
    const mobileAds = typeof lib === 'function' ? lib : lib.default || lib;
    if (typeof mobileAds().setRequestConfiguration === 'function') {
      await mobileAds().setRequestConfiguration({
        maxAdContentRating: MaxAdContentRating.PG,
        tagForChildDirectedTreatment: false,
        tagForUnderAgeOfConsent: false,
      });
    }
    if (typeof mobileAds().initialize === 'function') {
      await mobileAds().initialize();
    }
  } catch (e) {
    // Ignore initialization errors in dev where native module may be absent
  }
};

const ensureRewardedReady = async (): Promise<boolean> => {
  const lib = ensureLib();
  if (!lib || !RewardedAd) return false;

  if (!rewardedAd) {
    loadRewarded();
  }
  if (rewardedLoaded) {
    return true;
  }

  return new Promise((resolve) => {
    if (!rewardedAd || typeof rewardedAd.addAdEventListener !== 'function') {
      resolve(false);
      return;
    }
    const onLoaded = rewardedAd.addAdEventListener(RewardedAdEventType.LOADED, () => {
      rewardedLoaded = true;
      try { onLoaded(); } catch {}
      try { onError(); } catch {}
      resolve(true);
    });
    const onError = rewardedAd.addAdEventListener(AdEventType.ERROR, () => {
      rewardedLoaded = false;
      try { onLoaded(); } catch {}
      try { onError(); } catch {}
      resolve(false);
    });

    if (typeof rewardedAd.load === 'function') rewardedAd.load();
  });
};

const ensureInterstitialReady = async (): Promise<boolean> => {
  const lib = ensureLib();
  if (!lib || !InterstitialAd) return false;

  if (!interstitialAd) {
    loadInterstitial();
  }
  if (interstitialLoaded) {
    return true;
  }

  return new Promise((resolve) => {
    if (!interstitialAd || typeof interstitialAd.addAdEventListener !== 'function') {
      resolve(false);
      return;
    }
    const onLoaded = interstitialAd.addAdEventListener(AdEventType.LOADED, () => {
      interstitialLoaded = true;
      try { onLoaded(); } catch {}
      try { onError(); } catch {}
      resolve(true);
    });
    const onError = interstitialAd.addAdEventListener(AdEventType.ERROR, () => {
      interstitialLoaded = false;
      try { onLoaded(); } catch {}
      try { onError(); } catch {}
      resolve(false);
    });

    if (typeof interstitialAd.load === 'function') interstitialAd.load();
  });
};

const showRewarded = async (_type: 'hint' | 'slice'): Promise<boolean> => {
  const lib = ensureLib();
  if (!lib || !RewardedAd) return false;
  await ensureMobileAds();
  const ready = await ensureRewardedReady();
  const ad = rewardedAd;
  if (!ready || !ad) {
    return false;
  }

  return new Promise((resolve) => {
    let rewarded = false;
    const rewardSub = typeof ad.addAdEventListener === 'function'
      ? ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => { rewarded = true; })
      : () => {};
    const closedSub = typeof ad.addAdEventListener === 'function'
      ? ad.addAdEventListener(AdEventType.CLOSED, () => { try { rewardSub(); } catch {} try { closedSub(); } catch {}; resolve(rewarded); })
      : () => { resolve(rewarded); };

    if (typeof ad.show === 'function') {
      ad.show().catch(() => {
        try { rewardSub(); } catch {}
        try { closedSub(); } catch {}
        resolve(false);
      });
    } else {
      resolve(false);
    }
  });
};

const showInterstitial = async (): Promise<void> => {
  const lib = ensureLib();
  if (!lib || !InterstitialAd) return;
  await ensureMobileAds();
  const ready = await ensureInterstitialReady();
  if (!ready || !interstitialAd) {
    return;
  }

  if (typeof interstitialAd.show === 'function') {
    await interstitialAd.show().catch(() => {});
  }
};

const init = async () => {
  const lib = ensureLib();
  if (!lib) return;
  await ensureMobileAds();
  loadRewarded();
  loadInterstitial();
};

export const ads = {
  init,
  showRewarded,
  showInterstitial,
};

export type AdsService = typeof ads;
