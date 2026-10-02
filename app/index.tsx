import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";

import { CCTV_VENDORS, makeRtspUrl } from "@/cctv";
import {
  getEndpointDetails,
  testCameraConnection,
  type CameraNetworkConfig,
} from "@/camera-connection";
import {
  discoverOnvifCameras,
  type DiscoveredCamera,
} from "@/onvif-discovery";
import {
  getOnvifStreamUri,
  type OnvifMediaProfile,
} from "@/onvif-media";

type TabName = "live" | "cctv" | "history" | "settings";

type HistoryItem = {
  id: string;
  url: string;
  action: "connected" | "disconnected" | "error";
  message: string;
  time: string;
};

function isCameraUrl(value: string) {
  return /^(rtsp|rtsps|http|https):\/\/\S+$/i.test(value.trim());
}

function hideCredentials(value: string) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return value;
  }
}

function addCredentials(value: string, username: string, password: string) {
  if (!username && !password) return value.trim();
  try {
    const url = new URL(value.trim());
    if (username) url.username = username;
    if (password) url.password = password;
    return url.toString();
  } catch {
    return value.trim();
  }
}

function CameraVideo({ url, nativeControls }: { url: string; nativeControls: boolean }) {
  const player = useVideoPlayer(null, (instance) => {
    instance.loop = false;
  });

  useEffect(() => {
    if (!url) return;
    try {
      player.replace(url);
      player.play();
    } catch {
      // Playback errors are exposed by expo-video through player.error.
    }
  }, [player, url]);

  if (!url) {
    return (
      <View style={styles.emptyVideo}>
        <Text style={styles.bigIcon}>📹</Text>
        <Text style={styles.emptyTitle}>Belum ada kamera aktif</Text>
        <Text style={styles.centerText}>
          Pilih kamera dari daftar atau masukkan URL RTSP/HTTP/HTTPS.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.videoBox}>
      <VideoView
        player={player}
        style={styles.video}
        nativeControls={nativeControls}
        contentFit="contain"
        allowsFullscreen
        allowsPictureInPicture
      />
      {player.status === "loading" || player.status === "idle" ? (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.overlayText}>Menghubungkan ke CCTV...</Text>
        </View>
      ) : null}
      {player.status === "error" ? (
        <View style={styles.overlay}>
          <Text style={styles.errorIcon}>⚠</Text>
          <Text style={styles.overlayTitle}>Video tidak dapat diputar</Text>
          <Text style={styles.overlayText}>
            {player.error?.message || "Periksa URL, codec dan jaringan kamera."}
          </Text>
        </View>
      ) : null}
      {player.status === "readyToPlay" ? (
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      ) : null}
    </View>
  );
}

function TabButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: string;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.tab, active && styles.tabActive]}>
      <Text style={styles.tabIcon}>{icon}</Text>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

export default function HomeScreen() {
  const [activeTab, setActiveTab] = useState<TabName>("live");
  const [cameras, setCameras] = useState<DiscoveredCamera[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<DiscoveredCamera | null>(null);
  const [activeStream, setActiveStream] = useState("");
  const [manualUrl, setManualUrl] = useState("rtsp://192.168.1.20:554/stream1");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [vendor, setVendor] = useState<(typeof CCTV_VENDORS)[number]>("Generic / ONVIF");
  const [searching, setSearching] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [profile, setProfile] = useState<OnvifMediaProfile | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showInfo, setShowInfo] = useState(true);
  const [nativeControls, setNativeControls] = useState(true);

  const suggestedUrl = useMemo(() => makeRtspUrl(vendor, "192.168.1.20"), [vendor]);

  const addHistory = (
    action: HistoryItem["action"],
    url: string,
    message: string,
  ) => {
    setHistory((items) => [
      {
        id: `${Date.now()}-${Math.random()}`,
        url: hideCredentials(url),
        action,
        message,
        time: new Date().toLocaleTimeString("id-ID"),
      },
      ...items,
    ].slice(0, 100));
  };

  const searchCameras = async () => {
    if (searching) return;
    setSearching(true);
    setStatusText("");
    try {
      const found = await discoverOnvifCameras(7000);
      setCameras(found);
      const message = found.length
        ? `${found.length} kamera ditemukan melalui ONVIF.`
        : "Tidak ada kamera ONVIF yang ditemukan.";
      setStatusText(message);
      setActiveTab("cctv");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Pencarian CCTV gagal.";
      setStatusText(message);
      Alert.alert("Pencarian gagal", message);
    } finally {
      setSearching(false);
    }
  };

  const connectOnvif = async (camera: DiscoveredCamera) => {
    const endpoint = camera.xaddrs?.find((item) => /^https?:\/\//i.test(item)) ?? "";
    const key = `${camera.host}:${camera.port}`;

    if (!endpoint) {
      Alert.alert("Endpoint tidak tersedia", "Kamera tidak memberikan endpoint ONVIF.");
      return;
    }

    setConnecting(key);
    setSelectedCamera(camera);
    setStatusText(`Menghubungkan ke ${camera.host}...`);

    try {
      const result = await getOnvifStreamUri(endpoint, {
        username: username.trim() || undefined,
        password: password || undefined,
      });

      if (!result.ok || !result.streamUri) {
        setStatusText(result.message);
        addHistory("error", endpoint, result.message);
        Alert.alert("Gagal mengambil stream", result.message);
        return;
      }

      setActiveStream(result.streamUri);
      setManualUrl(hideCredentials(result.streamUri));
      setProfile(result.profile ?? null);
      setStatusText("URI RTSP berhasil diperoleh dari ONVIF.");
      addHistory("connected", result.streamUri, result.message);
      setActiveTab("live");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Koneksi ONVIF gagal.";
      setStatusText(message);
      addHistory("error", endpoint, message);
      Alert.alert("Koneksi gagal", message);
    } finally {
      setConnecting(null);
    }
  };

  const connectManual = () => {
    const value = manualUrl.trim();
    if (!isCameraUrl(value)) {
      Alert.alert("URL tidak valid", "Gunakan rtsp://, rtsps://, http:// atau https://.");
      return;
    }

    const target = addCredentials(value, username.trim(), password);
    setSelectedCamera(null);
    setProfile(null);
    setActiveStream(target);
    setStatusText("Mencoba membuka stream CCTV...");
    addHistory("connected", value, "Stream manual dibuka.");
    setActiveTab("live");
  };

  const testConnection = async () => {
    const value = manualUrl.trim();
    if (!isCameraUrl(value) || !getEndpointDetails(value)) {
      Alert.alert("URL tidak valid", "Masukkan URL kamera yang benar.");
      return;
    }

    setTesting(true);
    try {
      const camera: CameraNetworkConfig = {
        id: "manual-camera",
        name: "Camera manual",
        url: value,
        vendor,
        username: username.trim() || undefined,
        password: password || undefined,
      };
      const result = await testCameraConnection(camera);
      const message = `${result.status.toUpperCase()} • ${result.message}${
        result.latencyMs ? ` • ${result.latencyMs}ms` : ""
      }`;
      setStatusText(message);
      addHistory(result.ok ? "connected" : "error", value, result.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tes koneksi gagal.";
      setStatusText(message);
      addHistory("error", value, message);
    } finally {
      setTesting(false);
    }
  };

  const disconnect = () => {
    if (activeStream) {
      addHistory("disconnected", activeStream, "Stream CCTV dihentikan.");
    }
    setActiveStream("");
    setSelectedCamera(null);
    setProfile(null);
    setStatusText("CCTV telah diputus.");
  };

  const renderLive = () => (
    <>
      <View style={styles.rowHeader}>
        <View style={styles.flex}>
          <Text style={styles.heading}>Live CCTV</Text>
          <Text style={styles.subheading}>Pantau kamera secara langsung</Text>
        </View>
        {activeStream ? (
          <Pressable onPress={disconnect} style={styles.danger}>
            <Text style={styles.dangerText}>Putus</Text>
          </Pressable>
        ) : null}
      </View>

      <CameraVideo url={activeStream} nativeControls={nativeControls} />

      {showInfo && selectedCamera ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Kamera Aktif</Text>
          <Text style={styles.muted}>Host: {selectedCamera.host}</Text>
          <Text style={styles.muted}>Port: {selectedCamera.port}</Text>
          {profile ? <Text style={styles.muted}>Profile: {profile.name}</Text> : null}
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Hubungkan CCTV Manual</Text>
        <Text style={styles.label}>Merek / Profil</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {CCTV_VENDORS.map((item) => (
            <Pressable
              key={item}
              onPress={() => setVendor(item)}
              style={[styles.chip, vendor === item && styles.chipActive]}
            >
              <Text style={[styles.chipText, vendor === item && styles.chipTextActive]}>
                {item}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <Text style={styles.label}>URL RTSP / HTTP / HTTPS</Text>
        <TextInput
          value={manualUrl}
          onChangeText={setManualUrl}
          placeholder="rtsp://192.168.1.20:554/stream1"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={styles.input}
        />
        <Text style={styles.helper}>Contoh: {suggestedUrl}</Text>

        <Text style={styles.label}>Username CCTV</Text>
        <TextInput
          value={username}
          onChangeText={setUsername}
          placeholder="admin"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />

        <Text style={styles.label}>Password CCTV</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password kamera"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={styles.input}
        />

        <Pressable onPress={connectManual} style={styles.primary}>
          <Text style={styles.primaryText}>▶ Hubungkan & Tampilkan</Text>
        </Pressable>
        <Pressable
          onPress={testConnection}
          disabled={testing}
          style={[styles.secondary, testing && styles.disabled]}
        >
          {testing ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Uji Koneksi</Text>}
        </Pressable>

        {statusText ? (
          <View style={styles.status}>
            <Text style={styles.muted}>{statusText}</Text>
          </View>
        ) : null}
      </View>
    </>
  );

  const renderCctv = () => (
    <>
      <View style={styles.rowHeader}>
        <View style={styles.flex}>
          <Text style={styles.heading}>Daftar CCTV</Text>
          <Text style={styles.subheading}>Kamera yang ditemukan melalui ONVIF</Text>
        </View>
        <Pressable
          onPress={searchCameras}
          disabled={searching}
          style={[styles.smallPrimary, searching && styles.disabled]}
        >
          {searching ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.smallText}>Cari CCTV</Text>}
        </Pressable>
      </View>

      {cameras.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.bigIcon}>📡</Text>
          <Text style={styles.emptyTitle}>Belum ada kamera</Text>
          <Text style={styles.centerText}>Tekan Cari CCTV untuk menjalankan ONVIF/WS-Discovery.</Text>
        </View>
      ) : (
        cameras.map((camera) => {
          const key = `${camera.host}:${camera.port}`;
          const endpoint = camera.xaddrs?.find((item) => /^https?:\/\//i.test(item)) ?? "";
          const busy = connecting === key;
          return (
            <View key={key} style={styles.card}>
              <Text style={styles.cardTitle}>📷 {camera.host}</Text>
              <Text style={styles.muted}>Port {camera.port}</Text>
              <Text style={styles.endpoint}>{endpoint || "Endpoint ONVIF tidak diketahui"}</Text>
              <Pressable
                onPress={() => connectOnvif(camera)}
                disabled={busy}
                style={[styles.primary, busy && styles.disabled]}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>▶ Hubungkan & Live</Text>}
              </Pressable>
            </View>
          );
        })
      )}
    </>
  );

  const renderHistory = () => (
    <>
      <View style={styles.rowHeader}>
        <View style={styles.flex}>
          <Text style={styles.heading}>Riwayat</Text>
          <Text style={styles.subheading}>Aktivitas koneksi CCTV</Text>
        </View>
        {history.length ? (
          <Pressable onPress={() => setHistory([])} style={styles.danger}>
            <Text style={styles.dangerText}>Hapus</Text>
          </Pressable>
        ) : null}
      </View>

      {!history.length ? (
        <View style={styles.emptyCard}>
          <Text style={styles.bigIcon}>🕘</Text>
          <Text style={styles.emptyTitle}>Belum ada riwayat</Text>
        </View>
      ) : (
        history.map((item) => (
          <View key={item.id} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.action}>{item.action.toUpperCase()}</Text>
              <Text style={styles.time}>{item.time}</Text>
            </View>
            <Text style={styles.endpoint}>{item.url}</Text>
            <Text style={styles.muted}>{item.message}</Text>
          </View>
        ))
      )}
    </>
  );

  const renderSettings = () => (
    <>
      <Text style={styles.heading}>Pengaturan</Text>
      <Text style={styles.subheading}>Tampilan dan kontrol live video</Text>
      <View style={styles.card}>
        <View style={styles.setting}>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>Info kamera</Text>
            <Text style={styles.muted}>Tampilkan informasi kamera aktif.</Text>
          </View>
          <Switch value={showInfo} onValueChange={setShowInfo} />
        </View>
        <View style={styles.setting}>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>Kontrol video</Text>
            <Text style={styles.muted}>Tampilkan kontrol native pemutar.</Text>
          </View>
          <Switch value={nativeControls} onValueChange={setNativeControls} />
        </View>
      </View>
    </>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.logo}><Text style={styles.logoText}>C</Text></View>
          <View style={styles.flex}>
            <Text style={styles.title}>CCTV Universal</Text>
            <Text style={styles.subheading}>ONVIF • RTSP • Live Monitor</Text>
          </View>
          <View style={[styles.dot, activeStream ? styles.online : styles.offline]} />
        </View>
        {activeStream ? <Text style={styles.liveUrl}>LIVE • {hideCredentials(activeStream)}</Text> : null}
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {activeTab === "live" ? renderLive() : null}
        {activeTab === "cctv" ? renderCctv() : null}
        {activeTab === "history" ? renderHistory() : null}
        {activeTab === "settings" ? renderSettings() : null}
      </ScrollView>

      <View style={styles.tabs}>
        <TabButton icon="▶" label="Live" active={activeTab === "live"} onPress={() => setActiveTab("live")} />
        <TabButton icon="📷" label="CCTV" active={activeTab === "cctv"} onPress={() => setActiveTab("cctv")} />
        <TabButton icon="🕘" label="Riwayat" active={activeTab === "history"} onPress={() => setActiveTab("history")} />
        <TabButton icon="⚙" label="Pengaturan" active={activeTab === "settings"} onPress={() => setActiveTab("settings")} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0b1220" },
  content: { padding: 16, paddingBottom: 28 },
  header: { padding: 16, backgroundColor: "#0b1220" },
  headerRow: { flexDirection: "row", alignItems: "center" },
  logo: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#1e293b", alignItems: "center", justifyContent: "center" },
  logoText: { color: "#fff", fontSize: 22, fontWeight: "800" },
  title: { color: "#fff", fontSize: 20, fontWeight: "800" },
  subheading: { color: "#94a3b8", fontSize: 12, marginTop: 3 },
  flex: { flex: 1 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  online: { backgroundColor: "#22c55e" },
  offline: { backgroundColor: "#475569" },
  liveUrl: { color: "#22c55e", marginTop: 9, fontSize: 11 },
  rowHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  heading: { color: "#fff", fontSize: 20, fontWeight: "800" },
  card: { backgroundColor: "#111827", borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: "#1e293b" },
  cardTitle: { color: "#fff", fontWeight: "800", fontSize: 15, marginBottom: 5 },
  muted: { color: "#94a3b8", fontSize: 12, lineHeight: 18 },
  centerText: { color: "#94a3b8", fontSize: 12, lineHeight: 19, textAlign: "center", marginTop: 6 },
  label: { color: "#cbd5e1", fontSize: 12, fontWeight: "700", marginTop: 10, marginBottom: 6 },
  input: { backgroundColor: "#0b1220", borderWidth: 1, borderColor: "#334155", borderRadius: 10, padding: 11, color: "#fff" },
  helper: { color: "#64748b", fontSize: 11, marginTop: 5 },
  chip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9, borderWidth: 1, borderColor: "#334155", marginRight: 7 },
  chipActive: { backgroundColor: "#1e293b" },
  chipText: { color: "#94a3b8", fontSize: 11 },
  chipTextActive: { color: "#fff", fontWeight: "700" },
  primary: { minHeight: 46, borderRadius: 10, backgroundColor: "#2563eb", alignItems: "center", justifyContent: "center", marginTop: 10, paddingHorizontal: 12 },
  secondary: { minHeight: 46, borderRadius: 10, backgroundColor: "#334155", alignItems: "center", justifyContent: "center", marginTop: 8 },
  primaryText: { color: "#fff", fontWeight: "800",
               },
});
