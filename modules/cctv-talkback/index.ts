import { NativeModules, Platform } from "react-native";

type TalkbackModule = {
  checkSupport(url: string): Promise<{
    reachable: boolean;
    statusCode?: number;
    supported: boolean;
    message: string;
  }>;
};

const nativeModule = NativeModules.CctvTalkback
  as TalkbackModule | undefined;

export const talkbackAvailable =
  Platform.OS === "android" && Boolean(nativeModule);

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