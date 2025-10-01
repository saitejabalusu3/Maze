const { withAndroidManifest, AndroidConfig, withInfoPlist, createRunOncePlugin } = require('@expo/config-plugins');

const META_APP_ID = 'com.google.android.gms.ads.APPLICATION_ID';

function setAndroidAppId(androidManifest, appId) {
  if (!appId) {
    return androidManifest;
  }
  const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  if (!mainApplication['meta-data']) {
    mainApplication['meta-data'] = [];
  }

  const existing = mainApplication['meta-data'].find((item) => item.$['android:name'] === META_APP_ID);
  if (existing) {
    existing.$['android:value'] = appId;
  } else {
    mainApplication['meta-data'].push({
      $: {
        'android:name': META_APP_ID,
        'android:value': appId,
      },
    });
  }

  return androidManifest;
}

const withGoogleMobileAds = (config, props = {}) => {
  const { androidAppId, iosAppId } = props;

  config = withInfoPlist(config, (config) => {
    if (iosAppId) {
      config.modResults.GADApplicationIdentifier = iosAppId;
    }
    return config;
  });

  config = withAndroidManifest(config, (config) => {
    config.modResults = setAndroidAppId(config.modResults, androidAppId);
    return config;
  });

  return config;
};

module.exports = createRunOncePlugin(withGoogleMobileAds, 'mazemin-google-mobile-ads', '1.0.0');
