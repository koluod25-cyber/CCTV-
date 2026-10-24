import { Platform } from "react-native";
import { requireNativeModule } from "expo-modules-core";

export type TalkbackResult = {
  success: boolean;
  message: string;
};

type TalkbackNativeModule = {
  checkSupport(
    url: string,
  ): Promise<{
    reachable: boolean;
    statusCode?: number;
    supported: boolean;
    message: string;
  }>;

  startTalkback(
    host: string,
    port: number,
    username: string,
    password: string,
  ): Promise<TalkbackResult>;

  stopTalkback(): Promise<TalkbackResult>;
};

export type CctvDvripRecording = {
  fileName: string;
  startTime: string;
  endTime: string;
  channel: number;
  fileLength: string;
};

type CctvPlaybackNativeModule = {
  searchRecordings(
    host: string,
    username: string,
    password: string,
    startTime: string,
    endTime: string,
    channel: number,
  ): Promise<{
    success: boolean;
    count: number;
    recordings: string;
  }>;

  downloadRecordingToPhone(
    host: string,
    username: string,
    password: string,
    fileName: string,
    startTime: string,
    endTime: string,
  ): Promise<{
    success: boolean;
    uri: string;
    size: number;
    fileName: string;
  }>;

  prepareRecordingPlayback(
    host: string,
    username: string,
    password: string,
    fileName: string,
    startTime: string,
    endTime: string,
  ): Promise<{
    success: boolean;
    uri: string;
    size: number;
  }>;
};

let nativeModule: TalkbackNativeModule | null = null;
let playbackNativeModule: CctvPlaybackNativeModule | null = null;

let nativeModuleError = "";
let playbackNativeModuleError = "";

if (Platform.OS === "android") {
  try {
    nativeModule =
      requireNativeModule<TalkbackNativeModule>(
        "CctvTalkback",
      );
  } catch (error) {
    nativeModuleError =
      error instanceof Error
        ? error.message
        : String(error);
  }

  try {
    playbackNativeModule =
      requireNativeModule<CctvPlaybackNativeModule>(
        "CctvPlayback",
      );
  } catch (error) {
    playbackNativeModuleError =
      error instanceof Error
        ? error.message
        : String(error);
  }
}

export const talkbackAvailable =
  Platform.OS === "android" &&
  nativeModule !== null;

export async function checkTalkbackSupport(
  url: string,
) {
  if (!nativeModule) {
    return {
      reachable: false,
      supported: false,
      message:
        "Modul Talkback Android tidak berhasil dimuat. " +
        nativeModuleError,
    };
  }

  return nativeModule.checkSupport(url);
}

export async function startTalkback(
  host: string,
  port: number,
  username: string,
  password: string,
): Promise<TalkbackResult> {
  if (!nativeModule) {
    throw new Error(
      "Modul Talkback Android tidak berhasil dimuat. " +
        nativeModuleError,
    );
  }

  return nativeModule.startTalkback(
    host,
    port,
    username,
    password,
  );
}

export async function stopTalkback(): Promise<TalkbackResult> {
  if (!nativeModule) {
    throw new Error(
      "Modul Talkback Android tidak berhasil dimuat. " +
        nativeModuleError,
    );
  }

  return nativeModule.stopTalkback();
}

export async function searchDvripRecordings(
  host: string,
  username: string,
  password: string,
  startTime: string,
  endTime: string,
  channel: number,
): Promise<{
  success: boolean;
  count: number;
  recordings: CctvDvripRecording[];
}> {
  if (!playbackNativeModule) {
    throw new Error(
      "Modul DVRIP belum tersedia. " +
        playbackNativeModuleError +
        " Pastikan modul CctvPlayback terdaftar di Android.",
    );
  }

  const result =
    await playbackNativeModule.searchRecordings(
      host,
      username,
      password,
      startTime,
      endTime,
      channel,
    );

  let recordings: CctvDvripRecording[];

  try {
    const parsed: unknown = JSON.parse(
      result.recordings || "[]",
    );

    if (!Array.isArray(parsed)) {
      throw new Error(
        "Format daftar rekaman DVRIP bukan array.",
      );
    }

    recordings = parsed as CctvDvripRecording[];
  } catch (error) {
    throw new Error(
      "Gagal membaca daftar rekaman DVRIP: " +
        (error instanceof Error
          ? error.message
          : String(error)),
    );
  }

  return {
    success: result.success,
    count: result.count,
    recordings,
  };
}

export async function downloadDvripRecordingToPhone(
  host: string,
  username: string,
  password: string,
  fileName: string,
  startTime: string,
  endTime: string,
): Promise<{
  success: boolean;
  uri: string;
  size: number;
  fileName: string;
}> {
  if (!playbackNativeModule) {
    throw new Error(
      "Modul DVRIP belum tersedia. " +
        playbackNativeModuleError +
        " Pastikan modul CctvPlayback terdaftar di Android.",
    );
  }

  return playbackNativeModule.downloadRecordingToPhone(
    host,
    username,
    password,
    fileName,
    startTime,
    endTime,
  );
}

export async function prepareDvripRecordingPlayback(
  host: string,
  username: string,
  password: string,
  fileName: string,
  startTime: string,
  endTime: string,
): Promise<{
  success: boolean;
  uri: string;
  size: number;
}> {
  if (!playbackNativeModule) {
    throw new Error(
      "Modul DVRIP belum tersedia. " +
        playbackNativeModuleError +
        " Pastikan modul CctvPlayback terdaftar di Android.",
    );
  }

  return playbackNativeModule.prepareRecordingPlayback(
    host,
    username,
    password,
    fileName,
    startTime,
    endTime,
  );
}


import { requireNativeModule as requireGo2rtcNativeModule } from "expo-modules-core";

type Go2rtcNativeModule = {
  startGo2rtc(
    host: string,
    username: string,
    password: string,
  ): Promise<{
    success: boolean;
    running: boolean;
    apiReady: boolean;
    message: string;
    rtspUrl: string;
    logPath: string;
  }>;

  getGo2rtcStatus(): Promise<{
    running: boolean;
    apiReady: boolean;
    rtspReady: boolean;
    message: string;
    logPath: string;
  }>;

  stopGo2rtc(): Promise<{
    success: boolean;
    running: boolean;
    message: string;
  }>;
};

let go2rtcModule: Go2rtcNativeModule | null = null;
let go2rtcLoadError = "";

if (Platform.OS === "android") {
  try {
    go2rtcModule =
      requireGo2rtcNativeModule<Go2rtcNativeModule>(
        "CctvGo2rtc",
      );
  } catch (error) {
    go2rtcLoadError =
      error instanceof Error
        ? error.message
        : String(error);
  }
}

export async function startGo2rtc(
  host: string,
  username = "",
  password = "",
) {
  if (!go2rtcModule) {
    throw new Error(
      "Modul go2rtc belum dimuat: " + go2rtcLoadError,
    );
  }

  return go2rtcModule.startGo2rtc(
    host,
    username,
    password,
  );
}

export async function getGo2rtcStatus() {
  if (!go2rtcModule) {
    throw new Error(
      "Modul go2rtc belum dimuat: " + go2rtcLoadError,
    );
  }

  return go2rtcModule.getGo2rtcStatus();
}

export async function stopGo2rtc() {
  if (!go2rtcModule) {
    throw new Error(
      "Modul go2rtc belum dimuat: " + go2rtcLoadError,
    );
  }

  return go2rtcModule.stopGo2rtc();
}
