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

type TabName = "live" | "cctv" | "history" | "settings";

type HistoryItem = {
  id: string;
  url: string;
  action: "connected" | "disconnected" | "error";
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
  return /^(rtsp|rtsps|http|https):\/\//i.test(url.trim());
}

function getCameraUrl(camera: DiscoveredCamera) {
  const xaddr = camera.xaddrs?.find((item) =>
    /^https?:\/\//i.test(item)
  );

  return xaddr ?? "";
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
      player.pause();
      return;
    }

    try {
      player.replace(url);
      player.play();
    } catch {
      // Status/error akan ditangani oleh event player.
    }
  }, [player, url]);

  if (!url) {
    return (
      <View style={styles.videoEmpty}>
        <Text style={styles.videoEmptyIcon}>📹</Text>
        <Text style={styles.videoEmptyTitle}>
          Belum ada kamera aktif
        </Text>
        <Text style={styles.videoEmptyText}>
          Pilih CCTV dari daftar atau masukkan URL
          RTSP/HTTP/HTTPS.
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

      {status === "loading" || status === "idle" ? (
        <View style={styles.videoLoadingOverlay}>
          <ActivityIndicator size="large" color="#ffffff" />
          <Text style={styles.videoLoadingText}>
            Menghubungkan ke CCTV...
          </Text>
        </View>
      ) : null}

      {status === "error" ? (
        <View style={styles.videoErrorOverlay}>
          <Text style={styles.videoErrorIcon}>⚠</Text>
          <Text style={styles.videoErrorTitle}>
            Video tidak dapat diputar
          </Text>
          <Text style={styles.videoErrorText}>
            {playerError || "Periksa URL, username/password, codec, dan jaringan kamera."}
          </Text>
        </View>
      ) : null}
    </View>
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

  const [manualUrl, setManualUrl] = useState(
    "rtsp://192.168.1.20:554/stream1"
  );

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [activeStream, setActiveStream] = useState("");

  const [vendor, setVendor] =
    useState<(typeof CCTV_VENDORS)[number]>(
      "Generic / ONVIF"
    );

  const [searching, setSearching] = useState(false);
  const [testing, setTesting] = useState(false);
  const [statusText, setStatusText] =
    useState<string | null>(null);

  const [history, setHistory] =
    useState<HistoryItem[]>([]);

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
    action: HistoryItem["action"],
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
    if (searching) return;

    setSearching(true);
    setCameras([]);
    setSelectedCamera(null);
    setStatusText(null);

    try {
      const found = await discoverOnvifCameras(7000);

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
          "Pastikan HP dan kamera berada pada Wi-Fi/LAN yang sama dan ONVIF/WS-Discovery aktif pada kamera."
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

  const runManualCheck = async () => {
    const trimmedUrl = manualUrl.trim();

    if (!trimmedUrl) {
      Alert.alert(
        "URL kosong",
        "Masukkan URL kamera terlebih dahulu."
      );
      return;
    }

    if (!isSupportedCameraUrl(trimmedUrl)) {
      Alert.alert(
        "URL tidak valid",
        "Gunakan rtsp://, rtsps://, http:// atau https://."
      );
      return;
    }

    const endpoint =
      getEndpointDetails(trimmedUrl);

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
          username: username.trim() || undefined,
          password: password || undefined,
        } as CameraNetworkConfig);

      const resultText =
        `${result.status.toUpperCase()} • ${result.message}` +
        (result.latencyMs
          ? ` • ${result.latencyMs}ms`
          : "");

      setStatusText(resultText);

      addHistory(
        result.ok ? "connected" : "error",
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

      Alert.alert(
        "Tes gagal",
        message
      );
    } finally {
      setTesting(false);
    }
  };

  const connectManualCamera = () => {
    const url = manualUrl.trim();

    if (!url) {
      Alert.alert(
        "URL kosong",
        "Masukkan URL CCTV terlebih dahulu."
      );
      return;
    }

    if (!isSupportedCameraUrl(url)) {
      Alert.alert(
        "URL tidak valid",
        "Gunakan rtsp://, rtsps://, http:// atau https://."
      );
      return;
    }

    setSelectedCamera(null);
    setActiveStream(url);
    setStatusText(
      `Mencoba membuka ${url}`
    );

    addHistory(
      "connected",
      url,
      "Stream CCTV dibuka dari URL manual."
    );

    setActiveTab("live");
  };

  const connectDiscoveredCamera = (
    camera: DiscoveredCamera
  ) => {
    const url = getCameraUrl(camera);

    setSelectedCamera(camera);

    if (!url) {
      Alert.alert(
        "URL video belum tersedia",
        "Kamera berhasil ditemukan melalui ONVIF, tetapi XAddrs yang tersedia belum merupakan URL stream video RTSP/HTTP. Masukkan URL stream secara manual."
      );

      setStatusText(
        "Kamera ditemukan, tetapi URL stream perlu dikonfigurasi manual."
      );

      setActiveTab("cctv");
      return;
    }

    setActiveStream(url);
    setManualUrl(url);
    setStatusText(
      `Membuka ${url}`
    );

    addHistory(
      "connected",
      url,
      `Kamera ${camera.host} dipilih dari ONVIF.`
    );

    setActiveTab("live");
  };

  const disconnectCamera = () => {
    const oldStream = activeStream;

    setActiveStream("");
    setSelectedCamera(null);
    setStatusText(
      "CCTV telah diputus."
    );

    if (oldStream) {
      addHistory(
        "disconnected",
        oldStream,
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
          onPress: () => setHistory([]),
        },
      ]
    );
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoText}>C</Text>
        </View>

        <View style={styles.headerTitleWrap}>
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
          <View style={styles.liveDot} />

          <Text style={styles.activeInfoText}>
            LIVE
          </Text>

          <Text
            style={styles.activeUrl}
            numberOfLines={1}
          >
            {activeStream}
          </Text>
        </View>
      ) : null}
    </View>
  );

  const renderLive = () => (
    <>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>
            Live CCTV
          </Text>

          <Text style={styles.sectionSubtitle}>
            Pantau kamera secara langsung
          </Text>
        </View>

        {activeStream ? (
          <Pressable
            onPress={disconnectCamera}
            style={styles.dangerButton}
          >
            <Text style={styles.dangerButtonText}>
              Putus
            </Text>
          </Pressable>
        ) : null}
      </View>

      <CameraVideo
        url={activeStream}
        nativeControls={hardwareControls}
      />

      {showCameraInfo && selectedCamera ? (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>
            Kamera Aktif
          </Text>

          <Text style={styles.infoText}>
            Host: {selectedCamera.host}
          </Text>

          <Text style={styles.infoText}>
            Port: {selectedCamera.port}
          </Text>

          {selectedCamera.types ? (
            <Text style={styles.infoText}>
              ONVIF: {selectedCamera.types}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>
          Hubungkan CCTV
        </Text>

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
          Username CCTV (opsional)
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
          Password CCTV (opsional)
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
          onPress={connectManualCamera}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.buttonPressed,
          ]}
        >
          <Text style={styles.primaryButtonText}>
            ▶  Hubungkan & Tampilkan
          </Text>
        </Pressable>

        <Pressable
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
            <Text style={styles.primaryButtonText}>
              Uji Koneksi
            </Text>
          )}
        </Pressable>

        {statusText ? (
          <View style={styles.statusBox}>
            <Text style={styles.statusText}>
              {statusText}
            </Text>
          </View>
        ) : null}
      </View>
    </>
  );

  const renderCameras = () => (
    <>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderText}>
          <Text style={styles.sectionTitle}>
            Daftar CCTV
          </Text>

          <Text style={styles.sectionSubtitle}>
            Kamera yang ditemukan melalui ONVIF
          </Text>
        </View>

        <Pressable
          disabled={searching}
          onPress={searchCameras}
          style={({ pressed }) => [
            styles.searchButton,
            pressed && styles.buttonPressed,
            searching && styles.buttonDisabled,
          ]}
        >
          {searching ? (
            <ActivityIndicator
              color="#fff"
              size="small"
            />
          ) : (
            <Text style={styles.searchButtonText}>
              Cari
            </Text>
          )}
        </Pressable>
      </View>

      {cameras.length === 0 && !searching ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyIcon}>
            📡
          </Text>

          <Text style={styles.emptyTitle}>
            Belum ada CCTV
          </Text>

          <Text style={styles.emptyText}>
            Tekan tombol "Cari" untuk mencari kamera
            ONVIF pada jaringan lokal.
          </Text>

          <Pressable
            onPress={searchCameras}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>
              Cari CCTV Sekarang
            </Text>
          </Pressable>
        </View>
      ) : null}

      {searching ? (
        <View style={styles.searchingCard}>
          <ActivityIndicator size="large" />

          <Text style={styles.searchingTitle}>
            Mencari CCTV...
          </Text>

          <Text style={styles.searchingText}>
            Proses ONVIF WS-Discovery sedang berjalan.
          </Text>
        </View>
      ) : null}

      {cameras.map((camera, index) => {
        const url = getCameraUrl(camera);

        const isActive =
          selectedCamera?.host === camera.host &&
          activeStream.length > 0;

        return (
          <View
            key={`${camera.host}:${camera.port}:${index}`}
            style={[
              styles.cameraCard,
              isActive &&
                styles.cameraCardActive,
            ]}
          >
            <View style={styles.cameraCardHeader}>
              <View style={styles.cameraNumber}>
                <Text style={styles.cameraNumberText}>
                  {index + 1}
                </Text>
              </View>

              <View style={styles.cameraNameWrap}>
                <Text style={styles.cameraTitle}>
                  CCTV {index + 1}
                </Text>

                <Text style={styles.cameraHost}>
                  {camera.host}
                </Text>
              </View>

              {isActive ? (
                <View style={styles.liveBadge}>
                  <Text style={styles.liveBadgeText}>
                    LIVE
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.cameraDetails}>
              <Text style={styles.detail}>
                Port: {camera.port}
              </Text>

              {camera.types ? (
                <Text style={styles.detail}>
                  Type: {camera.types}
                </Text>
              ) : null}

              {camera.scopes ? (
                <Text
                  style={styles.detail}
                  numberOfLines={2}
                >
                  Scope: {camera.scopes}
                </Text>
              ) : null}

              {url ? (
                <Text
                  style={styles.url}
                  numberOfLines={2}
                >
                  Endpoint: {url}
                </Text>
              ) : (
                <Text style={styles.warningText}>
                  Endpoint video belum tersedia
                </Text>
              )}
            </View>

            <View style={styles.cameraActions}>
              <Pressable
                onPress={() =>
                  connectDiscoveredCamera(camera)
                }
                style={styles.smallPrimaryButton}
              >
                <Text style={styles.smallButtonText}>
                  ▶ Live
                </Text>
              </Pressable>

              {url ? (
                <Pressable
                  onPress={() => {
                    setManualUrl(url);
                    setActiveTab("live");
                  }}
                  style={styles.smallSecondaryButton}
                >
                  <Text
                    style={styles.smallSecondaryText}
                  >
                    Gunakan URL
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}
    </>
  );

  const renderHistory = () => (
    <>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>
            Riwayat
          </Text>

          <Text style={styles.sectionSubtitle}>
            Aktivitas koneksi CCTV
          </Text>
        </View>

        {history.length > 0 ? (
          <Pressable
            onPress={clearHistory}
            style={styles.dangerButton}
          >
            <Text style={styles.dangerButtonText}>
              Hapus
            </Text>
          </Pressable>
        ) : null}
      </View>

      {history.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyIcon}>
            🕘
          </Text>

          <Text style={styles.emptyTitle}>
            Belum ada riwaya