
import { NativeModules, Platform } from "react-native";

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

const nativeModule = NativeModules.CctvTalkback as
  | TalkbackNativeModule
  | undefined;

export const talkbackAvailable =
  Platform.OS === "android" &&
  Boolean(nativeModule);

export async function checkTalkbackSupport(url: string) {
  if (!nativeModule) {
    return {
      reachable: false,
      supported: false,
      message: "Modul Talkback Android belum tersedia.",
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
    throw new Error("Modul Talkback Android belum tersedia.");
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
    throw new Error("Modul Talkback Android belum tersedia.");
  }

  return nativeModule.stopTalkback();
}
