import { useEffect, useMemo, useState } from "react";
import { useEvent } from "expo";
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

type TabName =
  | "live"
  | "cctv"
  | "history"
  | "settings";

type HistoryAction =
  | "connected"
  | "disconnected"
  | "error";

type HistoryItem = {
  id: string;
  url: string;
  action: HistoryAction;
  message: string;
  time: string;
};

function formatTime(date = new Date()) {
  return date.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function isSupportedCameraUrl(url: string) {
  return /^(rtsp|rtsps|http|https):\/\//i.test(
    url.trim()
  );
}

function buildAuthenticatedUrl(
  rawUrl: string,
  username: string,
  password: string
) {
  const url = rawUrl.trim();

  if (!username && !password) {
    return url;
  }

  try {
    const parsed = new URL(url);

    if (username) {
      parsed.username = username;
    }

    if (password) {
      parsed.password = password;
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

function getOnvifEndpoint(
  camera: DiscoveredCamera
) {
  return (
    camera.xaddrs?.find((item) =>
      /^https?:\/\//i.test(item)
    ) ?? ""
  );
}

function hideCredentialsFromUrl(url: string) {
  try {
    const parsed = new URL(url);

    parsed.username = "";
    parsed.password = "";

    return parsed.toString();
  } catch {
    return url;
  }
}

function CameraVideo({
  url,
  nativeControls,
}: {
  url: string;
  nativeControls: boolean;
}) {
  const player = useVideoPlayer(null, (instance) => {
    instance.loop = false;
  });

  const { status, error } = useEvent(
    player,
    "statusChange",
    {
      status: player.status,
      error: player.error,
    }
  );

  useEffect(() => {
    if (!url) {
      try {
        player.pause();
      } catch {
        // Ignore.
      }

      return;
    }

    try {
      player.replace(url);
      player.play();
    } catch {
      // Native player akan mengirim status error.
    }
  }, [player, url]);

  if (!url) {
    return (
      <View style={styles.videoEmpty}>
        <Text style={styles.videoEmptyIcon}>
          📹
        </Text>

        <Text style={styles.videoEmptyTitle}>
          Belum ada kamera aktif
        </Text>

        <Text style={styles.videoEmptyText}>
          Pilih kamera dari daftar atau masukkan
          URL RTSP/HTTP/HTTPS secara manual.
        </Text>
      </View>
    );
  }

  const playerError =
    error?.message ||
    (status === "error"
      ? "Stream tidak dapat diputar."
      : "");

  return (
    <View style={styles.videoWrapper}>
      <VideoView
        style={styles.video}
        player={player}
        nativeControls={nativeControls}
        contentFit="contain"
        allowsFullscreen
        allowsPictureInPicture
        surfaceType="textureView"
      />

      {status === "loading" ||
      status === "idle" ? (
        <View style={styles.videoLoadingOverlay}>
          <ActivityIndicator
            size="large"
            color="#ffffff"
          />

          <Text style={styles.videoLoadingText}>
            Menghubungkan ke CCTV...
          </Text>
        </View>
      ) : null}

      {status === "error" ? (
        <View style={styles.videoErrorOverlay}>
          <Text style={styles.videoErrorIcon}>
            ⚠
          </Text>

          <Text style={styles.videoErrorTitle}>
            Video tidak dapat diputar
          </Text>

          <Text style={styles.videoErrorText}>
            {playerError ||
              "Periksa URL, username/password, codec dan jaringan kamera."}
          </Text>
        </View>
      ) : null}

      {status === "readyToPlay" ? (
        <View style={styles.readyBadge}>
          <View style={styles.readyDot} />

          <Text style={styles.readyText}>
            LIVE
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function TabButton({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.tabButton,
        active && styles.tabButtonActive,
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

  const [cameras, setCameras] = useState<
    DiscoveredCamera[]
  >([]);

  const [selectedCamera, setSelectedCamera] =
    useState<DiscoveredCamera | null>(null);

  const [activeStream, setActiveStream] =
    useState("");

  const [manualUrl, setManualUrl] = useState(
    "rtsp://192.168.1.20:554/stream1"
  );

  const [username, setUsername] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [vendor, setVendor] =
    useState<(typeof CCTV_VENDORS)[number]>(
      "Generic / ONVIF"
    );

  const [searching, setSearching] =
    useState(false);

  const [connectingOnvif, setConnectingOnvif] =
    useState<string | null>(null);

  const [testing, setTesting] =
    useState(false);

  const [statusText, setStatusText] =
    useState<string | null>(null);

  const [history, setHistory] =
    useState<HistoryItem[]>([]);

  const [activeProfile, setActiveProfile] =
    useState<OnvifMediaProfile | null>(
      null
    );

  const [autoReconnect, setAutoReconnect] =
    useState(true);

  const [showCameraInfo, setShowCameraInfo] =
    useState(true);

  const [hardwareControls, setHardwareControls] =
    useState(true);

  const suggestedUrl = useMemo(
    () =>
      makeRtspUrl(
        vendor,
        "192.168.1.20",
        554,
        1,
        false
      ),
    [vendor]
  );

  const addHistory = (
    action: HistoryAction,
    url: string,
    message: string
  ) => {
    const item: HistoryItem = {
      id: `${Date.now()}-${Math.random()}`,
      url,
      action,
      message,
      time: formatTime(),
    };

    setHistory((current) =>
      [item, ...current].slice(0, 50)
    );
  };

  const searchCameras = async () => {
    if (searching) {
      return;
    }

    setSearching(true);
    setStatusText(null);

    try {
      const found =
        await discoverOnvifCameras(7000);

      setCameras(found);

      if (found.length > 0) {
        setStatusText(
          `${found.length} kamera ditemukan melalui ONVIF.`
        );

        setActiveTab("cctv");
      } else {
        setStatusText(
          "Tidak ada kamera ONVIF yang ditemukan."
        );

        Alert.alert(
          "CCTV tidak ditemukan",
          "Pastikan HP dan kamera berada pada Wi-Fi/LAN yang sama dan ONVIF/WS-Discovery aktif."
        );
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Terjadi kesalahan saat mencari CCTV.";

      setStatusText(message);

      Alert.alert(
        "Pencarian gagal",
        message
      );
    } finally {
      setSearching(false);
    }
  };

  const connectOnvifCamera = async (
    camera: DiscoveredCamera
  ) => {
    const endpoint =
      getOnvifEndpoint(camera);

    if (!endpoint) {
      Alert.alert(
        "Endpoint ONVIF tidak tersedia",
        "Kamera ditemukan tetapi tidak memberikan endpoint layanan ONVIF."
      );

      return;
    }

    const key =
      `${camera.host}:${camera.port}`;

    if (connectingOnvif === key) {
      return;
    }

    setConnectingOnvif(key);
    setSelectedCamera(camera);
    setStatusText(
      `Menghubungkan ONVIF ke ${camera.host}...`
    );

    try {
      const result =
        await getOnvifStreamUri(
          endpoint,
          {
            username:
              username.trim() ||
              undefined,
            password:
              password || undefined,
          }
        );

      if (!result.ok ||
        !result.streamUri) {
        const message =
          result.message ||
          "ONVIF tidak memberikan URI stream.";

        setStatusText(message);

        addHistory(
          "error",
          endpoint,
          message
        );

        Alert.alert(
          "Gagal mengambil stream",
          message
        );

        return;
      }

      const streamUri =
        result.streamUri;

      /*
       * Simpan URI yang sudah lengkap untuk
       * player. URL yang ditampilkan ke user
       * tetap tanpa username/password.
       */
      setActiveStream(streamUri);

      setActiveProfile(
        result.profile ?? null
      );

      setManualUrl(
        hideCredentialsFromUrl(
          streamUri
        )
      );

      setStatusText(
        `RTSP berhasil diperoleh • ${
          result.profile?.name ||
          "Media Profile"
        }`
      );

      addHistory(
        "connected",
        hideCredentialsFromUrl(
          streamUri
        ),
        "URI RTSP berhasil diperoleh melalui ONVIF."
      );

      setActiveTab("live");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Gagal menghubungkan kamera ONVIF.";

      setStatusText(message);

      addHistory(
        "error",
        endpoint,
        message
      );

      Alert.alert(
        "Koneksi ONVIF gagal",
        message
      );
    } finally {
      setConnectingOnvif(null);
    }
  };

  const runManualCheck = async () => {
    const trimmedUrl =
      manualUrl.trim();

    if (!trimmedUrl) {
      Alert.alert(
        "URL kosong",
        "Masukkan URL kamera terlebih dahulu."
      );

      return;
    }

    if (
      !isSupportedCameraUrl(
        trimmedUrl
      )
    ) {
      Alert.alert(
        "URL tidak valid",
        "Gunakan rtsp://, rtsps://, http:// atau https://."
      );

      return;
    }

    const endpoint =
      getEndpointDetails(
        trimmedUrl
      );

    if (!endpoint) {
      Alert.alert(
        "URL tidak valid",
        "Format URL kamera tidak dapat dikenali."
      );

      return;
    }

    setTesting(true);
    setStatusText(null);

    try {
      const result =
        await testCameraConnection({
          id: "manual-camera",
          name: "Camera manual",
          url: trimmedUrl,
          vendor,
          username:
            username.trim() ||
            undefined,
          password:
            password ||
            undefined,
        } as CameraNetworkConfig);

      const resultText =
        `${result.status.toUpperCase()} • ${result.message}` +
        (result.latencyMs
          ? ` • ${result.latencyMs}ms`
          : "");

      setStatusText(resultText);

      addHistory(
        result.ok
          ? "connected"
          : "error",
        trimmedUrl,
        result.message
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Tes koneksi gagal.";

      setStatusText(message);

      addHistory(
        "error",
        trimmedUrl,
        message
      );
    } finally {
      setTesting(false);
    }
  };

  const connectManualCamera = () => {
    const url =
      manualUrl.trim();

    if (!url) {
      Alert.alert(
        "URL kosong",
        "Masukkan URL CCTV terlebih dahulu."
      );

      return;
    }

    if (
      !isSupportedCameraUrl(url)
    ) {
      Alert.alert(
        "URL tidak valid",
        "Gunakan rtsp://, rtsps://, http:// atau https://."
      );

      return;
    }

    const authenticatedUrl =
      buildAuthenticatedUrl(
        url,
        username.trim(),
        password
      );

    setSelectedCamera(null);
    setActiveProfile(null);
    setActiveStream(
      authenticatedUrl
    );

    setStatusText(
      "Mencoba membuka stream CCTV..."
    );

    addHistory(
      "connected",
      url,
      "Stream manual dibuka."
    );

    setActiveTab("live");
  };

  const disconnectCamera = () => {
    const oldStream =
      activeStream;

    setActiveStream("");
    setActiveProfile(null);
    setSelectedCamera(null);

    setStatusText(
      "CCTV telah diputus."
    );

    if (oldStream) {
      addHistory(
        "disconnected",
        hideCredentialsFromUrl(
          oldStream
        ),
        "Stream CCTV dihentikan."
      );
    }
  };

  const clearHistory = () => {
    Alert.alert(
      "Hapus riwayat",
      "Hapus semua riwayat koneksi CCTV?",
      [
        {
          text: "Batal",
          style: "cancel",
        },
        {
          text: "Hapus",
          style: "destructive",
          onPress: () =>
            setHistory([]),
        },
      ]
    );
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoText}>
            C
          </Text>
        </View>

        <View
          style={
            styles.headerTitleWrap
          }
        >
          <Text style={styles.title}>
            CCTV Universal
          </Text>

          <Text style={styles.subtitle}>
            Monitor CCTV • ONVIF • RTSP
          </Text>
        </View>

        <View
          style={[
            styles.connectionDot,
            activeStream
              ? styles.connectionOnline
              : styles.connectionOffline,
          ]}
        />
      </View>

      {activeStream ? (
        <View style={styles.activeInfo}>
          <View
            style={styles.liveDot}
          />

          <Text
            style={styles.activeInfoText}
          >
            LIVE
          </Text>

          <Text
            style={styles.activeUrl}
            numberOfLines={1}
          >
            {hideCredentialsFromUrl(
              activeStream
            )}
          </Text>
        </View>
      ) : null}
    </View>
  );

  const renderLive = () => (
    <>
      <View
        style={styles.sectionHeader}
      >
        <View>
          <Text
            style={styles.sectionTitle}
          >
            Live CCTV
          </Text>

          <Text
            style={styles.sectionSubtitle}
          >
            Pantau kamera secara langsung
          </Text>
        </View>

        {activeStream ? (
          <Pressable
            onPress={
              disconnectCamera
            }
            style={
              styles.dangerButton
            }
          >
            <Text
              style={
                styles.dangerButtonText
              }
            >
              Putus
            </Text>
          </Pressable>
        ) : null}
      </View>

      <CameraVideo
        url={activeStream}
        nativeControls={
          hardwareControls
        }
      />

      {showCameraInfo &&
      selectedCamera ? (
        <View
          style={styles.infoCard}
        >
          <Text
            style={styles.infoTitle}
          >
            Kamera Aktif
          </Text>

          <Text
            style={styles.infoText}
          >
            Host:{" "}
            {selectedCamera.host}
          </Text>

          <Text
            style={styles.infoText}
          >
            Port:{" "}
            {selectedCamera.port}
          </Text>

          {activeProfile ? (
            <Text
              style={styles.infoText}
            >
              Profile:{" "}
              {activeProfile.name}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.panel}>
        <Text
          style={styles.panelTitle}
        >
          Hubungkan CCTV Manual
        </Text>

        <Text style={styles.label}>
          Merek / Profil URL
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={
            false
          }
          style={
            styles.vendorScroll
          }
        >
          {CCTV_VENDORS.map(
            (item) => (
              <Pressable
                key={item}
                onPress={() =>
                  setVendor(item)
                }
                style={[
                  styles.vendorChip,
                  vendor === item &&
                    styles.vendorChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.vendorChipText,
                    vendor === item &&
                      styles.vendorChipTextActive,
                  ]}
                >
                  {item}
                </Text>
              </Pressable>
            )
          )}
        </ScrollView>

        <Text style={styles.label}>
          URL RTSP / HTTP / HTTPS
        </Text>

        <TextInput
          value={manualUrl}
          onChangeText={
            setManualUrl
          }
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
          onChangeText={
            setUsername
          }
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
          onChangeText={
            setPassword
          }
          placeholder="Password kamera"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={styles.input}
        />

        <Pressable
          onPress={
            connectManualCamera
          }
          style={({ pressed }) => [
            styles.primaryButton,
            pressed &&
              styles.buttonPressed,
          ]}
        >
          <Text
            style={
              styles.primaryButtonText
            }
          >
            ▶  Hubungkan & Tampilkan
          </Text>
        </Pressable>

        <Pressable
          disabled={testing}
          onPress={
            runManualCheck
          }
          style={({ pressed }) => [
            styles.secondaryButton,
            pressed &&
              styles.buttonPressed,
            testing &&
              styles.buttonDisabled,
          ]}
        >
          {testing ? (
            <ActivityIndicator
              color="#fff"
            />
          ) : (
            <Text
              style={
                styles.primaryButtonText
              }
            >
              Uji Koneksi
            </Text>
          )}
        </Pressable>

        {statusText ? (
          <View
            style={styles.statusBox}
          >
            <Text
              style={styles.statusText}
            >
              {statusText}
            </Text>
          </View>
        ) : null}
      </View>
    </>
  );

  const renderCameras = () => (
    <>
      <View
        style={styles.sectionHeader}
      >
        <View
          style={
            styles.sectionHeaderText
      