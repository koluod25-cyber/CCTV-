const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const withRtspTcp = (config) =>
  withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;

      const filePath = path.join(
        projectRoot,
        "node_modules",
        "react-native-video",
        "android",
        "src",
        "main",
        "java",
        "com",
        "brentvatne",
        "exoplayer",
        "ReactExoplayerView.java"
      );

      if (!fs.existsSync(filePath)) {
        throw new Error(
          "[withRtspTcp] File ReactExoplayerView.java tidak ditemukan: " +
            filePath
        );
      }

      let source = fs.readFileSync(filePath, "utf8");

      if (source.includes(".setForceUseRtpTcp(true)")) {
        return config;
      }

      const original =
        "mediaSourceFactory = new RtspMediaSource.Factory();";

      const replacement =
        "mediaSourceFactory = new RtspMediaSource.Factory()" +
        ".setForceUseRtpTcp(true);";

      if (!source.includes(original)) {
        throw new Error(
          "[withRtspTcp] Blok RTSP ReactExoplayerView.java tidak ditemukan. " +
            "Build dihentikan agar file native tidak rusak."
        );
      }

      source = source.replace(original, replacement);

      fs.writeFileSync(filePath, source, "utf8");

      return config;
    },
  ]);

module.exports = withRtspTcp;
