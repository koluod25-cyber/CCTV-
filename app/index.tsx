import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CCTV_VENDORS, makeRtspUrl } from "@/cctv";
import {
  getEndpointDetails,
  testCameraConnection,
  type CameraNetworkConfig,
} from "@/camera-connection";
import { discoverOnvifCameras, type DiscoveredCamera } from "@/onvif-discovery";

export default function HomeScreen() {
  const [cameras, setCameras] = useState<DiscoveredCamera[]>([]);
  const [manualUrl, setManualUrl] = useState("rtsp://192.168.1.20:554/stream1");
  const [vendor, setVendor] = useState<(typeof CCTV_VENDORS)[number]>("Generic / ONVIF");
  const [searching, setSearching] = useState(false);
  const [testing, setTesting] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);

  const suggestedUrl = useMemo(
    () => makeRtspUrl(vendor, "192.168.1.20", 554, 1, false),
    [vendor]
  );

  const searchCameras = async () => {
    if (searching) return;

    setSearching(true);
    setCameras([]);
    setStatusText(null);

    try {
      const found = await discoverOnvifCameras(7000);
      setCameras(found);

      if (found.length === 0) {
        Alert.alert(
          "CCTV tidak ditemukan",
          "Pastikan HP dan kamera berada pada Wi‑Fi/LAN yang sama dan ONVIF/WS‑Discovery aktif pada kamera."
        );
      }
    } catch (error) {
      Alert.alert(
        "Pencarian gagal",
        error instanceof Error ? error.message : "Terjadi kesalahan saat mencari CCTV."
      );
    } finally {
      setSearching(false);
    }
  };

  const runManualCheck = async () => {
    const trimmedUrl = manualUrl.trim();
    if (!trimmedUrl) {
      Alert.alert("URL kosong", "Masukkan URL kamera terlebih dahulu.");
      return;
    }

    const endpoint = getEndpointDetails(trimmedUrl);
    if (!endpoint) {
      Alert.alert(
        "URL tidak valid",
        "Format URL kamera tidak valid. Gunakan contoh rtsp://ip:port/stream1"
      );
      return;
    }

    setTesting(true);
    setStatusText(null);

    try {
      const result = await testCameraConnection({
        id: "manual-camera",
        name: "Camera manual",
        url: trimmedUrl,
        vendor,
      } as CameraNetworkConfig);

      setStatusText(
        `${result.status.toUpperCase()} · ${result.message}${result.latencyMs ? ` · ${result.latencyMs}ms` : ""}`
      );
    } catch (error) {
      Alert.alert(
        "Tes gagal",
        error instanceof Error ? error.message : "Tes koneksi gagal."
      );
    } finally {
      setTesting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>CCTV Universal Monitor</Text>
        <Text style={styles.subtitle}>
          Temukan dan uji kamera ONVIF serta RTSP di jaringan lokal.
        </Text>

        <Pressable
          accessibilityRole="button"
          disabled={searching}
          onPress={searchCameras}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            searching && styles.buttonDisabled,
          ]}
        >
          {searching ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Cari CCTV</Text>
          )}
        </Pressable>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Uji koneksi manual</Text>
          <TextInput
            value={manualUrl}
            onChangeText={setManualUrl}
            placeholder="rtsp://192.168.1.20:554/stream1"
            placeholderTextColor="#6b7280"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />

          <Text style={styles.label}>Vendor</Text>
          <View style={styles.pillRow}>
            {CCTV_VENDORS.map((item) => (
              <Pressable
                key={item}
                onPress={() => setVendor(item)}
                style={[styles.pill, vendor === item && styles.pillActive]}
              >
                <Text style={[styles.pillText, vendor === item && styles.pillTextActive]}>
                  {item}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.helper}>URL contoh: {suggestedUrl}</Text>

          <Pressable
            accessibilityRole="button"
            disabled={testing}
            onPress={runManualCheck}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.buttonPressed,
              testing && styles.buttonDisabled,
            ]}
          >
            {testing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Tes Koneksi</Text>
            )}
          </Pressable>

          {statusText ? <Text style={styles.status}>{statusText}</Text> : null}
        </View>

        <Text style={styles.sectionTitle}>Kamera ditemukan: {cameras.length}</Text>

        {cameras.length === 0 && !searching ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Belum ada kamera</Text>
            <Text style={styles.emptyText}>
              Tekan “Cari CCTV” untuk menjalankan ONVIF WS-Discovery.
            </Text>
          </View>
        ) : null}

        {cameras.map((camera, index) => (
          <View key={`${camera.host}:${camera.port}:${index}`} style={styles.card}>
            <Text style={styles.cameraTitle}>CCTV {index + 1} — {camera.host}</Text>
            <Text style={styles.detail}>Port: {camera.port}</Text>
            {camera.xaddrs.length > 0 ? (
              <>
                <Text style={styles.label}>XAddrs:</Text>
                {camera.xaddrs.map((url) => (
                  <Text key={url} style={styles.url}>{url}</Text>
                ))}
              </>
            ) : null}
            {camera.types ? <Text style={styles.detail}>Types: {camera.types}</Text> : null}
            {camera.scopes ? <Text style={styles.detail}>Scopes: {camera.scopes}</Text> : null}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#0b1220",
  },
  container: {
    padding: 20,
    gap: 14,
    paddingBottom: 48,
  },
  title: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "800",
  },
  subtitle: {
    color: "#aab4c5",
    fontSize: 15,
    lineHeight: 22,
  },
  button: {
    minHeight: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563eb",
    marginTop: 8,
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f766e",
    marginTop: 10,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "700",
  },
  panel: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#263247",
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  panelTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  input: {
    backgroundColor: "#0f172a",
    color: "#fff",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  label: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
  },
  helper: {
    color: "#cbd5e1",
    fontSize: 12,
    lineHeight: 18,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0f172a",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pillActive: {
    backgroundColor: "#1d4ed8",
    borderColor: "#60a5fa",
  },
  pillText: {
    color: "#e2e8f0",
    fontSize: 11,
  },
  pillTextActive: {
    color: "#fff",
    fontWeight: "700",
  },
  status: {
    color: "#bfdbfe",
    fontSize: 12,
    lineHeight: 18,
  },
  sectionTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
    marginTop: 10,
  },
  empty: {
    borderWidth: 1,
    borderColor: "#263247",
    borderRadius: 12,
    padding: 18,
  },
  emptyTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  emptyText: {
    color: "#aab4c5",
    marginTop: 6,
    lineHeight: 20,
  },
  card: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    padding: 16,
    backgroundColor: "#111827",
    gap: 6,
  },
  cameraTitle: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "700",
  },
  detail: {
    color: "#cbd5e1",
    fontSize: 13,
    lineHeight: 19,
  },
  url: {
    color: "#60a5fa",
    fontSize: 12,
    lineHeight: 18,
  },
});