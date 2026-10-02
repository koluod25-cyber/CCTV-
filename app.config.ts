import type { ExpoConfig } from "expo/config";

const rawBundleId = "space.manus.cctv.universal.monitor.t20260903114227";
const bundleId = rawBundleId.toLowerCase();

const config: ExpoConfig = {
  name: "CCTV Universal Monitor",
  slug: "cctv-universal-monitor",
  version: "1.0.0",
  orientation: "default",

  icon: "./assets/images/anton-service-logo.png",

  scheme: "manus20260903114227",

  userInterfaceStyle: "automatic",
  newArchEnabled: true,

  ios: {
    supportsTablet: true,
    bundleIdentifier: bundleId,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },

  android: {
    adaptiveIcon: {
      backgroundColor: "#071017",
      foregroundImage: "./assets/images/anton-service-logo.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/anton-service-logo.png",
    },

    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,

    package: bundleId,

    permissions: [
      "POST_NOTIFICATIONS",
      "INTERNET",
      "ACCESS_NETWORK_STATE",
      "ACCESS_WIFI_STATE",
      "CHANGE_WIFI_MULTICAST_STATE",
    ],
  },

  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/favicon.png",
  },

  plugins: [
    "expo-router",

    [
      "@isvend/expo-udp",
      {
        multicast: true,
        localNetworkUsageDescription:
          "Aplikasi menggunakan jaringan lokal untuk menemukan dan terhubung ke kamera CCTV.",
      },
    ],

    [
      "expo-splash-screen",
      {
        image: "./assets/images/anton-service-logo.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#071017",
        dark: {
          backgroundColor: "#071017",
        },
      },
    ],

    [
      "expo-build-properties",
      {
        android: {
          buildArchs: ["armeabi-v7a", "arm64-v8a"],
          minSdkVersion: 24,
        },
      },
    ],
  ],

  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
