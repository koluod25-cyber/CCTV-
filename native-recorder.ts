import { NativeModules, Platform } from "react-native";

export type NativeRecordingResult = { available: boolean; fileUri?: string };
type RecorderBridge = { startRecording: (options: { cameraId: string; sourceUrl: string; username?: string; password?: string }) => Promise<{ fileUri: string }>; stopRecording: () => Promise<{ fileUri?: string }> };

const bridge = NativeModules.CCTVRecorder as RecorderBridge | undefined;
export const nativeRecorderAvailable = Platform.OS === "android" && Boolean(bridge);

export async function startNativeRecording(options: { cameraId: string; sourceUrl: string; username?: string; password?: string }): Promise<NativeRecordingResult> {
  if (!nativeRecorderAvailable || !bridge) return { available: false };
  const result = await bridge.startRecording(options);
  return { available: true, fileUri: result.fileUri };
}

export async function stopNativeRecording(): Promise<NativeRecordingResult> {
  if (!nativeRecorderAvailable || !bridge) return { available: false };
  const result = await bridge.stopRecording();
  return { available: true, fileUri: result.fileUri };
}
