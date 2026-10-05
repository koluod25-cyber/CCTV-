import type { ExpoConfig } from "expo/config";

const bundleId = "space.manus.cctv.universal.monitor.t20260903114227";
const appLogo = "./assets/images/anton-service-logo.png";

const config: ExpoConfig = {
  name: "CCTV Universal Monitor",
  slug: "cctv-universal-monitor",
  version: "1.0.0",
  orientation: "portrait",
  scheme: "cctvuniversalmonitor",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,

  // Logo utama aplikasi.
  // Logo ini menjadi icon launcher APK Android saat build.
  icon: appLogo,

  ios: {
    supportsTablet: true,
    bundleIdentifier: bundleId,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },

  android: {
    package: bundleId,

    // Icon launcher Android menggunakan logo yang sama.
    icon: appLogo,

    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,

    permissions: [
      "INTERNET",
      "ACCESS_NETWORK_STATE",
      "ACCESS_WIFI_STATE",
      "CHANGE_WIFI_MULTICAST_STATE",
      "POST_NOTIFICATIONS",
    ],
  },

  plugins: [
    "expo-router",
    [
      "react-native-video",
      {
        androidExtensions: {
          useExoplayerRtsp: true,
          useExoplayerSmoothStreaming: false,
          useExoplayerHls: false,
          useExoplayerDash: false,
        },
      },
    ],
    "./plugins/withRtspTcp.js",
    [
      "@isvend/expo-udp",
      {
        multicast: true,
        localNetworkUsageDescription:
          "Aplikasi menggunakan jaringan lokal untuk menemukan dan terhubung ke kamera CCTV.",
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          minSdkVersion: 24,
          usesCleartextTraffic: true,
          buildArchs: [
            "armeabi-v7a",
            "arm64-v8a",
          ],
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
