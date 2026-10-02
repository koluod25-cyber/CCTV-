import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

export async function configureLocalNotifications() {
  if (Platform.OS === "web") return false;
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("cctv-events", { name: "CCTV Events", importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 150, 250], lightColor: "#B8F553" });
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted") { const requested = await Notifications.requestPermissionsAsync(); return requested.status === "granted"; }
  return true;
}

export async function notifyCameraOffline(cameraName: string) {
  if (Platform.OS === "web") return;
  await Notifications.scheduleNotificationAsync({ content: { title: "Kamera offline", body: `${cameraName} tidak merespons. Periksa jaringan atau power kamera.`, data: { type: "camera-offline", cameraName } }, trigger: null });
}

export async function notifyFaceDetection(cameraName: string, count = 1) {
  if (Platform.OS === "web") return;
  await Notifications.scheduleNotificationAsync({ content: { title: "Smart detector wajah", body: `${count} wajah terdeteksi pada ${cameraName}.`, data: { type: "face-detection", cameraName, count } }, trigger: null });
}
