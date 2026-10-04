import {
  ConfigPlugin,
  withDangerousMod,
} from "@expo/config-plugins";
import fs from "fs";
import path from "path";

const withRtspTcp: ConfigPlugin = (config) => {
  return withDangerousMod(config, [
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
        "ReactExoplayerView.java",
      );

      if (!fs.existsSync(filePath)) {
        throw new Error(
          `[withRtspTcp] File ReactExoplayerView.java tidak ditemukan:\n${filePath}`,
        );
      }

      let source = fs.readFileSync(
        filePath,
        "utf8",
      );

      const original =
        "mediaSourceFactory = new RtspMediaSource.Factory();";

      const replacement =
        "mediaSourceFactory = new RtspMediaSource.Factory()"
        + ".setForceUseRtpTcp(true);";

      if (
        source.includes(
          ".setForceUseRtpTcp(true)",
        )
      ) {
        return config;
      }

      if (!source.includes(original)) {
        throw new Error(
          "[withRtspTcp] Blok RTSP ReactExoplayerView.java tidak ditemukan. "
          + "Jangan lanjutkan build agar file native tidak rusak.",
        );
      }

      source = source.replace(
        original,
        replacement,
      );

      fs.writeFileSync(
        filePath,
        source,
        "utf8",
      );

      return config;
    },
  ]);
};

export default withRtspTcp;
