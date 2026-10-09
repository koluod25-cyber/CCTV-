import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Video from "react-native-video";

import {
  discoverOnvifReplayServices,
  getOnvifReplayUri,
  searchOnvifRecordings,
  type OnvifRecording,
  type OnvifReplayServices,
} from "@/onvif-replay";

type PlaybackCamera = {
  slot: number;
  deviceServiceUrl: string;
  credentials: {
    username?: string;
    password?: string;
  };
  connected?: boolean;
};

type Props = {
  cameras: PlaybackCamera[];
  muted?: boolean;
  onHistory?: (url: string, message: string) => void;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Terjadi kesalahan yang tidak diketahui.";
}

export default function OnvifPlaybackPanel({
  cameras,
  muted = false,
  onHistory,
}: Props) {
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [services, setServices] = useState<OnvifReplayServices | null>(null);
  const [recordings, setRecordings] = useState<OnvifRecording[]>([]);
  const [selectedToken, setSelectedToken] = useState("");
  const [playbackUri, setPlaybackUri] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    "Pilih kamera ONVIF atau decoder/NVR yang mendukung pencarian rekaman.",
  );

  const selectedCamera =
    cameras.find((camera) => camera.slot === selectedSlot) ?? null;

  async function searchRecordings() {
    if (!selectedCamera?.deviceServiceUrl) {
      setStatus(
        "Pilih kamera ONVIF yang sudah terhubung. Stream RTSP manual tidak cukup untuk menemukan rekaman tersimpan.",
      );
      return;
    }

    setBusy(true);
    setServices(null);
    setRecordings([]);
    setSelectedToken("");
    setPlaybackUri("");
    setStatus("Memeriksa layanan ONVIF Playback dan Search...");

    try {
      const discovered = await discoverOnvifReplayServices(
        selectedCamera.deviceServiceUrl,
        selectedCamera.credentials,
      );
      setServices(discovered);

      if (!discovered.searchUrl) {
        setStatus(
          "Perangkat tidak mengumumkan layanan ONVIF Search. Periksa dukungan Profile G atau API khusus pabrikan.",
        );
        return;
      }

      const results = await searchOnvifRecordings(
        discovered.searchUrl,
        selectedCamera.credentials,
      );
      setRecordings(results);
      setStatus(
        results.length
          ? "Ditemukan " + results.length + " rekaman tersimpan."
          : "Pencarian selesai, tetapi perangkat tidak mengembalikan rekaman. Periksa media penyimpanan, jadwal rekam, atau dukungan ONVIF perangkat.",
      );
    } catch (error) {
      setStatus("Pencarian Playback gagal: " + errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function playRecording(recording: OnvifRecording) {
    if (!selectedCamera || !services?.replayUrl) {
      setStatus("Layanan Replay ONVIF belum tersedia untuk kamera ini.");
      return;
    }

    setBusy(true);
    setStatus("Meminta URI rekaman dari kamera/decoder...");
    setPlaybackUri("");

    try {
      const uri = await getOnvifReplayUri(
        services.replayUrl,
        recording.token,
        selectedCamera.credentials,
      );
      setSelectedToken(recording.token);
      setPlaybackUri(uri);
      setStatus(
        "URI rekaman diterima. Pemutaran dimulai langsung dari perangkat jika stream dan autentikasi didukung.",
      );
      onHistory?.(uri, "Memutar rekaman tersimpan ONVIF");
    } catch (error) {
      setStatus("Tidak dapat memutar rekaman: " + errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={styles.content}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.title}>Playback Rekaman</Text>
        <Text style={styles.subtitle}>
          Cari rekaman yang disimpan pada kamera atau decoder/NVR dan putar
          melalui URI RTSP Playback, tanpa mengunduh file terlebih dahulu.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Pilih Kamera / Decoder</Text>
        {cameras.length === 0 ? (
          <Text style={styles.muted}>
            Belum ada kamera ONVIF terhubung. Buka tab CCTV dan hubungkan
            perangkat melalui ONVIF terlebih dahulu.
          </Text>
        ) : (
          cameras.map((camera) => (
            <Pressable
              key={camera.slot + "-" + camera.deviceServiceUrl}
              style={[
                styles.cameraButton,
                selectedSlot === camera.slot && styles.cameraButtonSelected,
              ]}
              onPress={() => {
                setSelectedSlot(camera.slot);
                setServices(null);
                setRecordings([]);
                setSelectedToken("");
                setPlaybackUri("");
                setStatus(
                  "Kamera " + (camera.slot + 1) + " dipilih. Tekan Cari Rekaman.",
                );
              }}
            >
              <Text style={styles.buttonText}>
                {"Kamera " + (camera.slot + 1)}
                {camera.connected ? " • Terhubung" : ""}
              </Text>
            </Pressable>
          ))
        )}

        <Pressable
          style={[styles.primaryButton, busy && styles.disabled]}
          onPress={searchRecordings}
          disabled={busy || cameras.length === 0}
        >
          {busy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.buttonText}>Cari Rekaman ONVIF</Text>
          )}
        </Pressable>
      </View>

      <View style={styles.statusBox}>
        <Text style={styles.statusText}>{status}</Text>
      </View>

      {recordings.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Rekaman Tersedia</Text>
          {recordings.map((recording, index) => (
            <View
              key={recording.token + "-" + index}
              style={styles.recording}
            >
              <Text style={styles.recordingTitle}>
                {recording.source ||
                  recording.content ||
                  "Rekaman " + (index + 1)}
              </Text>
              {recording.startTime ? (
                <Text style={styles.muted}>Mulai: {recording.startTime}</Text>
              ) : null}
              {recording.endTime ? (
                <Text style={styles.muted}>Selesai: {recording.endTime}</Text>
              ) : null}
              <Pressable
                style={[styles.primaryButton, busy && styles.disabled]}
                onPress={() => playRecording(recording)}
                disabled={busy}
              >
                <Text style={styles.buttonText}>
                  {selectedToken === recording.token && playbackUri
                    ? "Putar Ulang"
                    : "Putar Rekaman"}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {playbackUri ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Pemutar Rekaman</Text>
          <View style={styles.videoBox}>
            <Video
              key={playbackUri}
              source={{ uri: playbackUri, type: "rtsp" }}
              style={styles.video}
              controls
              resizeMode="contain"
              paused={false}
              muted={muted}
              onError={(event) => {
                const details =
                  event?.error?.errorString ||
                  event?.error?.errorException ||
                  "ExoPlayer gagal membuka stream rekaman.";
                setStatus(
                  "Perangkat memberikan URI, tetapi pemutar gagal membuka stream: " +
                    details,
                );
              }}
            />
          </View>
          <Text style={styles.muted}>
            Jika perangkat tidak mendukung ONVIF Profile G, atau URI/codec
            rekamannya tidak kompatibel dengan ExoPlayer, diperlukan API atau
            pemutar khusus pabrikan.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, backgroundColor: "#0b1117" },
  contentContainer: { padding: 12, paddingBottom: 24, gap: 12 },
  header: { marginBottom: 4 },
  title: { color: "#ffffff", fontSize: 20, fontWeight: "700" },
  subtitle: { color: "#8d9aaa", fontSize: 12, lineHeight: 18, marginTop: 4 },
  card: {
    backgroundColor: "#141d27",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#263341",
  },
  cardTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 8,
  },
  muted: { color: "#8d9aaa", fontSize: 12, lineHeight: 18, marginTop: 4 },
  cameraButton: {
    minHeight: 42,
    borderRadius: 9,
    backgroundColor: "#263442",
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  cameraButtonSelected: {
    backgroundColor: "#1b3044",
    borderWidth: 1,
    borderColor: "#1976d2",
  },
  primaryButton: {
    minHeight: 44,
    borderRadius: 9,
    backgroundColor: "#1976d2",
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  disabled: { opacity: 0.5 },
  buttonText: { color: "#ffffff", fontSize: 12, fontWeight: "700" },
  statusBox: {
    backgroundColor: "#172432",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#2c4053",
  },
  statusText: { color: "#b9c9d9", fontSize: 12, lineHeight: 18 },
  recording: {
    marginTop: 8,
    padding: 10,
    borderRadius: 9,
    backgroundColor: "#0e151d",
    borderWidth: 1,
    borderColor: "#344352",
  },
  recordingTitle: { color: "#ffffff", fontSize: 13, fontWeight: "600" },
  videoBox: {
    height: 230,
    backgroundColor: "#000000",
    borderRadius: 10,
    overflow: "hidden",
    marginBottom: 8,
  },
  video: { flex: 1 },
});
