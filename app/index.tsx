import { useMemo, useState } from "react";
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
import Video from "react-native-video";

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

function addCredentials(
  value: string,
  username: string,
  password: string,
) {
  if (!username && !password) {
    return value.trim();
  }

  try {
    const url = new URL(value.trim());

    if (username) {
      url.username = username;
    }

    if (password) {
      url.password = password;
    }

    return url.toString();
  } catch {
    return value.trim();
  }
}

function CameraVideo({
  url,
  nativeControls,
}: {
  url: string;
  nativeControls: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const handleLoad = () => {
    setLoaded(true);
    setError(false);
  };

  const handleError = () => {
    setLoaded(false);
    setError(true);
  };

  if (!url) {
    return (
      <View style={styles.emptyVideo}>
        <Text style={styles.bigIcon}>📹</Text>

        <Text style={styles.emptyTitle}>
          Belum ada kamera aktif
        </Text>

        <Text style={styles.centerText}>
          Pilih kamera dari daftar atau masukkan URL RTSP/HTTP/HTTPS.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.videoBox}>
      <Video
        source={{
          uri: url,
        }}
        style={styles.video}
        controls={nativeControls}
        resizeMode="contain"
        paused={false}
        playInBackground={false}
        playWhenInactive={false}
        repeat={false}
        onLoad={handleLoad}
        onError={handleError}
        bufferConfig={{
          minBufferMs: 1500,
          maxBufferMs: 5000,
          bufferForPlaybackMs: 500,
          bufferForPlaybackAfterRebufferMs: 1000,
        }}
      />

      {!loaded && !error ? (
        <View style={styles.overlay}>
          <ActivityIndicator
            size="large"
            color="#fff"
          />

          <Text style={styles.overlayText}>
            Menghubungkan ke CCTV...
          </Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.overlay}>
          <Text style={styles.errorIcon}>
            ⚠
          </Text>

          <Text style={styles.overlayTitle}>
            Video tidak dapat diputar
          </Text>

          <Text style={styles.overlayText}>
            Periksa URL RTSP, username/password, codec
            H.264 dan jaringan kamera.
          </Text>
        </View>
      ) : null}

      {loaded && !error ? (
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />

          <Text style={styles.liveText}>
            LIVE
          </Text>
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
    <Pressable
      onPress={onPress}
      style={[
        styles.tab,
        active && styles.tabActive,
      ]}
    >
      <Text style={styles.tabIcon}>
        {icon}
      </Text>

      <Text
        style={[
          styles.tabText,
          active && styles.tabTextActive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function HomeScreen() {
  const [activeTab, setActiveTab] =
    useState<TabName>("live");

  const [cameras, setCameras] =
    useState<DiscoveredCamera[]>([]);

  const [selectedCamera, setSelectedCamera] =
    useState<DiscoveredCamera | null>(null);

  const [activeStream, setActiveStream] =
    useState("");

  const [manualUrl, setManualUrl] =
    useState("rtsp://192.168.1.20:554/stream1");

  const [username, setUsername] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [vendor, setVendor] =
    useState<(typeof CCTV_VENDORS)[number]>(
      "Generic / ONVIF",
    );

  const [searching, setSearching] =
    useState(false);

  const [connecting, setConnecting] =
    useState<string | null>(null);

  const [testing, setTesting] =
    useState(false);

  const [statusText, setStatusText] =
    useState("");

  const [profile, setProfile] =
    useState<OnvifMediaProfile | null>(null);

  const [history, setHistory] =
    useState<HistoryItem[]>([]);

  const [showInfo, setShowInfo] =
    useState(true);

  const [nativeControls, setNativeControls] =
    useState(true);

  const suggestedUrl = useMemo(
    () => makeRtspUrl(vendor, "192.168.1.20"),
    [vendor],
  );

  const addHistory = (
    action: HistoryItem["action"],
    url: string,
    message: string,
  ) => {
    setHistory((items) =>
      [
        {
          id: `${Date.now()}-${Math.random()}`,
          url: hideCredentials(url),
          action,
          message,
          time: new Date().toLocaleTimeString(
            "id-ID",
          ),
        },
        ...items,
      ].slice(0, 100),
    );
  };

  const searchCameras = async () => {
    if (searching) {
      return;
    }

    setSearching(true);
    setStatusText("");

    try {
      const found =
        await discoverOnvifCameras(7000);

      setCameras(found);

      const message = found.length
        ? `${found.length} kamera ditemukan melalui ONVIF.`
        : "Tidak ada kamera ONVIF yang ditemukan.";

      setStatusText(message);
      setActiveTab("cctv");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Pencarian CCTV gagal.";

      setStatusText(message);

      Alert.alert(
        "Pencarian gagal",
        message,
      );
    } finally {
      setSearching(false);
    }
  };

  const connectOnvif = async (
    camera: DiscoveredCamera,
  ) => {
    const endpoint =
      camera.xaddrs?.find((item) =>
        /^https?:\/\//i.test(item),
      ) ?? "";

    const key =
      `${camera.host}:${camera.port}`;

    if (!endpoint) {
      Alert.alert(
        "Endpoint tidak tersedia",
        "Kamera tidak memberikan endpoint ONVIF.",
      );

      return;
    }

    setConnecting(key);
    setSelectedCamera(camera);
    setStatusText(
      `Menghubungkan ke ${camera.host}...`,
    );

    try {
      const result =
        await getOnvifStreamUri(endpoint, {
          username:
            username.trim() || undefined,
          password:
            password || undefined,
        });

      if (!result.ok || !result.streamUri) {
        setStatusText(result.message);

        addHistory(
          "error",
          endpoint,
          result.message,
        );

        Alert.alert(
          "Gagal mengambil stream",
          result.message,
        );

        return;
      }

      const streamUri = addCredentials(
        result.streamUri,
        username.trim(),
        password,
      );

      setActiveStream(streamUri);

      setManualUrl(
        hideCredentials(
          result.streamUri,
        ),
      );

      setProfile(
        result.profile ?? null,
      );

      setStatusText(
        "URI RTSP berhasil diperoleh dari ONVIF.",
      );

      addHistory(
        "connected",
        result.streamUri,
        result.message,
      );

      setActiveTab("live");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Koneksi ONVIF gagal.";

      setStatusText(message);

      addHistory(
        "error",
        endpoint,
        message,
      );

      Alert.alert(
        "Koneksi gagal",
        message,
      );
    } finally {
      setConnecting(null);
    }
  };

  const connectManual = () => {
    const value = manualUrl.trim();

    if (!isCameraUrl(value)) {
      Alert.alert(
        "URL tidak valid",
        "Gunakan rtsp://, rtsps://, http:// atau https://.",
      );

      return;
    }

    const target = addCredentials(
      value,
      username.trim(),
      password,
    );

    setSelectedCamera(null);
    setProfile(null);
    setActiveStream(target);

    setStatusText(
      "Mencoba membuka stream CCTV...",
    );

    addHistory(
      "connected",
      value,
      "Stream manual dibuka.",
    );

    setActiveTab("live");
  };

  const testConnection = async () => {
    const value = manualUrl.trim();

    if (
      !isCameraUrl(value) ||
      !getEndpointDetails(value)
    ) {
      Alert.alert(
        "URL tidak valid",
        "Masukkan URL kamera yang benar.",
      );

      return;
    }

    setTesting(true);

    try {
      const camera: CameraNetworkConfig = {
        id: "manual-camera",
        name: "Camera manual",
        url: value,
        vendor,
        username:
          username.trim() || undefined,
        password:
          password || undefined,
      };

      const result =
        await testCameraConnection(camera);

      const message =
        `${result.status.toUpperCase()} • ${result.message}` +
        (result.latencyMs
          ? ` • ${result.latencyMs}ms`
          : "");

      setStatusText(message);

      addHistory(
        result.ok
          ? "connected"
          : "error",
        value,
        result.message,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Tes koneksi gagal.";

      setStatusText(message);

      addHistory(
        "error",
        value,
        message,
      );
    } finally {
      setTesting(false);
    }
  };

  const disconnect = () => {
    if (activeStream) {
      addHistory(
        "disconnected",
        activeStream,
        "Stream CCTV dihentikan.",
      );
    }

    setActiveStream("");
    setSelectedCamera(null);
    setProfile(null);

    setStatusText(
      "CCTV telah diputus.",
    );
  };

  const renderLive = () => (
    <>
      <View style={styles.rowHeader}>
        <View style={styles.flex}>
          <Text style={styles.heading}>
            Live CCTV
          </Text>

          <Text style={styles.subheading}>
            Pantau kamera secara langsung
          </Text>
        </View>

        {activeStream ? (
          <Pressable
            onPress={disconnect}
            style={styles.danger}
          >
            <Text style={styles.dangerText}>
              Putus
            </Text>
          </Pressable>
        ) : null}
      </View>

      <CameraVideo
        url={activeStream}
        nativeControls={nativeControls}
      />

      {showInfo && selectedCamera ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Kamera Aktif
          </Text>

          <Text style={styles.muted}>
            Host: {selectedCamera.host}
          </Text>

          <Text style={styles.muted}>
            Port: {selectedCamera.port}
          </Text>

          {profile ? (
            <Text style={styles.muted}>
              Profile: {profile.name}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          Hubungkan CCTV Manual
        </Text>

        <Text style={styles.label}>
          Merek / Profil
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {CCTV_VENDORS.map((item) => (
            <Pressable
              key={item}
              onPress={() => setVendor(item)}
              style={[
                styles.chip,
                vendor === item &&
                  styles.chipActive,
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  vendor === item &&
                    styles.chipTextActive,
                ]}
              >
                {item}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <Text style={styles.label}>
          URL RTSP / HTTP / HTTPS
        </Text>

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

        <Text style={styles.helper}>
          Contoh: {suggestedUrl}
        </Text>

        <Text style={styles.label}>
          Username CCTV
        </Text>

        <TextInput
          value={username}
          onChangeText={setUsername}
          placeholder="admin"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />

        <Text style={styles.label}>
          Password CCTV
        </Text>

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

        <Pressable
          onPress={connectManual}
          style={styles.primary}
        >
          <Text style={styles.primaryText}>
            ▶ Hubungkan & Tampilkan
          </Text>
        </Pressable>

        <Pressable
          onPress={testConnection}
          disabled={testing}
          style={[
            styles.secondary,
            testing && styles.disabled,
          ]}
        >
          {testing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>
              Uji Koneksi
            </Text>
          )}
        </Pressable>

        {statusText ? (
          <View style={styles.status}>
            <Text style={styles.muted}>
              {statusText}
            </Text>
          </View>
        ) : null}
      </View>
    </>
  );

  const renderCctv = () => (
    <>
      <View style={styles.rowHeader}>
        <View style={styles.flex}>
          <Text style={styles.heading}>
            Daftar CCTV
          </Text>

          <Text style={styles.subheading}>
            Kamera yang ditemukan melalui ONVIF
          </Text>
        </View>

        <Pressable
          onPress={searchCameras}
          disabled={searching}
          style={[
            styles.smallPrimary,
            searching && styles.disabled,
          ]}
        >
          {searching ? (
            <ActivityIndicator
              color="#fff"
              size="small"
            />
          ) : (
            <Text style={styles.smallText}>
              Cari CCTV
            </Text>
          )}
        </Pressable>
      </View>

      {cameras.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.bigIcon}>
            📡
          </Text>

          <Text style={styles.emptyTitle}>
            Belum ada kamera
          </Text>

          <Text style={styles.centerText}>
            Tekan Cari CCTV untuk menjalankan
            ONVIF/WS-Discovery.
          </Text>
        </View>
      ) : (
        cameras.map((camera) => {
          const key =
            `${camera.host}:${camera.port}`;

          const endpoint =
            camera.xaddrs?.find((item) =>
              /^https?:\/\//i.test(item),
            ) ?? "";

          const busy =
            connecting === key;

          return (
            <View
              key={key}
              style={styles.card}
            >
              <Text style={styles.cardTitle}>
                📷 {camera.host}
              </Text>

              <Text style={styles.muted}>
                Port {camera.port}
              </Text>

              <Text style={styles.endpoint}>
                {endpoint ||
                  "Endpoint ONVIF tidak diketahui"}
              </Text>

              <Pressable
                onPress={() =>
                  connectOnvif(camera)
                }
                disabled={busy}
                style={[
                  styles.primary,
                  busy && styles.disabled,
                ]}
              >
                {busy ? (
                  <ActivityIndicator
                    color="#fff"
                  />
                ) : (
                  <Text
                    style={styles.primaryText}
                  >
                    ▶ Hubungkan & Live
                  </Text>
                )}
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
          <Text style={styles.heading}>
            Riwayat
          </Text>

          <Text style={styles.subheading}>
            Aktivitas koneksi CCTV
          </Text>
        </View>

        {history.length ? (
          <Pressable
            onPress={() => setHistory([])}
            style={styles.danger}
          >
            <Text style={styles.dangerText}>
              Hapus
            </Text>
          </Pressable>
        ) : null}
      </View>

      {!history.length ? (
        <View style={styles.emptyCard}>
          <Text style={styles.bigIcon}>
            🕘
          </Text>

          <Text style={styles.emptyTitle}>
            Belum ada riwayat
          </Text>
        </View>
      ) : (
        history.map((item) => (
          <View
            key={item.id}
            style={styles.card}
          >
            <View style={styles.row}>
              <Text style={styles.action}>
                {item.action.toUpperCase()}
              </Text>

              <Text style={styles.time}>
                {item.time}
              </Text>
            </View>

            <Text style={styles.endpoint}>
              {item.url}
            </Text>

            <Text style={styles.muted}>
              {item.message}
            </Text>
          </View>
        ))
      )}
    </>
  );

  const renderSettings = () => (
    <>
      <Text style={styles.heading}>
        Pengaturan
      </Text>

      <Text style={styles.subheading}>
        Tampilan dan kontrol live video
      </Text>

      <View style={styles.card}>
        <View style={styles.setting}>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>
              Info kamera
            </Text>

            <Text style={styles.muted}>
              Tampilkan informasi kamera aktif.
            </Text>
          </View>

          <Switch
            value={showInfo}
            onValueChange={setShowInfo}
          />
        </View>

        <View style={styles.setting}>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>
              Kontrol video
            </Text>

            <Text style={styles.muted}>
              Tampilkan kontrol native pemutar.
            </Text>
          </View>

          <Switch
            value={nativeControls}
            onValueChange={setNativeControls}
          />
        </View>
      </View>
    </>
  );

  return (
    <SafeAreaView 