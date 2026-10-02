import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  discoverOnvifCameras,
  type DiscoveredCamera,
} from "@/lib/onvif-discovery";

export default function HomeScreen() {
  const [cameras, setCameras] = useState<DiscoveredCamera[]>([]);
  const [searching, setSearching] = useState(false);

  const searchCameras = async () => {
    if (searching) return;

    setSearching(true);
    setCameras([]);

    try {
      const found = await discoverOnvifCameras(7000);
      setCameras(found);

      if (found.length === 0) {
        Alert.alert(
          "CCTV tidak ditemukan",
          "Pastikan HP dan kamera berada pada Wi-Fi/LAN yang sama dan ONVIF/WS-Discovery aktif pada kamera."
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

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>CCTV Universal Monitor</Text>
        <Text style={styles.subtitle}>
          Temukan kamera ONVIF otomatis pada jaringan lokal.
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

        <Text style={styles.sectionTitle}>
          Kamera ditemukan: {cameras.length}
        </Text>

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
            <Text style={styles.cameraTitle}>
              CCTV {index + 1} — {camera.host}
            </Text>
            <Text style={styles.detail}>Port: {camera.port}</Text>
            {camera.xaddrs.length > 0 ? (
              <>
                <Text style={styles.label}>XAddrs:</Text>
                {camera.xaddrs.map((url) => (
                  <Text key={url} style={styles.url}>
                    {url}
                  </Text>
                ))}
              </>
            ) : null}
            {camera.types ? (
              <Text style={styles.detail}>Types: {camera.types}</Text>
            ) : null}
            {camera.scopes ? (
              <Text style={styles.detail}>Scopes: {camera.scopes}</Text>
            ) : null}
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
  },
  title: {
    color: "#ffffff",
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
  label: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
  },
  url: {
    color: "#60a5fa",
    fontSize: 12,
    lineHeight: 18,
  },
});
