import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
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
  muted,
  onLoad,
  onError,
}: {
  url: string;
  nativeControls: boolean;
  muted: boolean;
  onLoad?: () => void;
  onError?: (message: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [errorDetail, setErrorDetail] = useState("");

  useEffect(() => {
    setLoaded(false);
    setError(false);
    setErrorDetail("");
  }, [url]);

  if (!url) {
    return (
      <View style={styles.emptyVideo}>
        <Text style={styles.bigIcon}>📹</Text>

        <Text style={styles.emptyTitle}>
          Belum ada kamera aktif
        </Text>

        <Text style={styles.centerText}>
          Pilih kamera dari daftar atau masukkan URL
          RTSP/HTTP/HTTPS.
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
        muted={muted}
        resizeMode="contain"
        paused={false}
        playInBackground={false}
        playWhenInactive={false}
        repeat={false}
        onLoad={() => {
          console.log(
            "CCTV EXOPLAYER LOAD SUCCESS:",
            url,
          );

          setLoaded(true);
          setError(false);
          setErrorDetail("");

          onLoad?.();
        }}
        onError={(videoError) => {
          setLoaded(false);
          setError(true);

          const errorObject =
            videoError?.error;

          const errorCode =
            errorObject?.errorCode || "";

          const errorString =
            errorObject?.errorString || "";

          const errorException =
            errorObject?.errorException || "";

          const errorStack =
            errorObject?.errorStackTrace || "";

          const detail = [
            errorCode
              ? `Code: ${errorCode}`
              : "",
            errorString
              ? `Detail: ${errorString}`
              : "",
            errorException
              ? `Exception: ${errorException}`
              : "",
          ]
            .filter(Boolean)
            .join(" • ");

          const finalDetail =
            detail ||
            "ExoPlayer gagal membuka stream CCTV.";

          setErrorDetail(finalDetail);

          console.log(
            "=== CCTV EXOPLAYER ERROR ===",
          );

          console.log(
            "URL:",
            url,
          );

          console.log(
            "ERROR CODE:",
            errorCode,
          );

          console.log(
            "ERROR STRING:",
            errorString,
          );

          console.log(
            "ERROR EXCEPTION:",
            errorException,
          );

          console.log(
            "ERROR STACK:",
            errorStack,
          );

          console.log(
            JSON.stringify(
              videoError,
              null,
              2,
            ),
          );

          onError?.(finalDetail);

          // Jangan membuat instance Video baru.
          // Error 21004 / FAILED_RUNTIME_CHECK dapat
          // dipicu berulang jika player direkreasi otomatis.
        }}
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
            ExoPlayer gagal membuka stream.
          </Text>

          {errorDetail ? (
            <Text style={styles.overlayText}>
              {errorDetail}
            </Text>
          ) : null}

          <Text style={styles.overlayText}>
            Periksa URL RTSP, codec kamera,
            username/password, dan jaringan.
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

const [activeStream, setActiveStream] = useState("");

const [playerConnected, setPlayerConnected] =
  useState(false);

useEffect(() => {
  // Setiap URL stream berubah, player dianggap
  // belum terhubung sampai Video.onLoad terpanggil.
  setPlayerConnected(false);
}, [activeStream]);

const [manualUrl, setManualUrl] = useState("rtsp://192.168.1.20:554/stream1");

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
  
const [muted, setMuted] = useState(false);

const [cameraCount, setCameraCount] =
  useState(1);

const [ownerText, setOwnerText] =
  useState("Pemilik: CCTV Universal Monitor");

const [logoUri, setLogoUri] =
  useState("");

const marqueeX =
  useRef(new Animated.Value(0)).current;
useEffect(() => {

const animation = Animated.loop(
    Animated.sequence([
      Animated.timing(marqueeX, {
        toValue: -180,
        duration: 5000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
      Animated.timing(marqueeX, {
        toValue: 0,
        duration: 5000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ]),
  );

  animation.start();

  return () => {
    animation.stop();
  };
}, [marqueeX]);

const suggestedUrl = useMemo(
    () =>
      makeRtspUrl(
        vendor,
        "192.168.1.20",
      ),
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

      setStatusText(
        found.length
          ? `${found.length} kamera ditemukan melalui ONVIF.`
          : "Tidak ada kamera ONVIF yang ditemukan.",
      );

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
  camera: DiscoveredCamera,) => {
    const endpoints = Array.from(
      new Set(
        (camera.xaddrs ?? []).filter((item) =>
          /^https?:\/\//i.test(item),
        ),
      ),
    );

    const key =
      `${camera.host}:${camera.port}`;

    if (endpoints.length === 0) {
      Alert.alert(
        "Endpoint tidak tersedia",
        "Kamera tidak memberikan endpoint ONVIF HTTP/HTTPS.",
      );

      return;
    }

setConnecting(key);
setSelectedCamera(camera);
setPlayerConnected(false);

    setStatusText(
      `Menghubungkan ke ${camera.host}...`,
    );

    const credentials = {
      username:
        username.trim() || undefined,
      password:
        password || undefined,
    };

    let lastMessage =
      "Kamera terdeteksi, tetapi Media Profile ONVIF belum berhasil diperoleh.";

    let lastEndpoint = endpoints[0];

    try {
      for (let index = 0; index < endpoints.length; index += 1) {
        const endpoint = endpoints[index];
        lastEndpoint = endpoint;

setStatusText(`Mencoba endpoint ONVIF ${index + 1}/${endpoints.length}...`,
        );

        try {
          const result =
            await getOnvifStreamUri(
              endpoint,
              credentials,
            );

          if (
            result.ok &&
            result.streamUri
          ) {
            const streamUri =
              addCredentials(
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

            setTesting(true);

            setStatusText(
              "URI RTSP berhasil diperoleh. Membuka video...",
            );

            setActiveTab("live");

  addHistory(
  "connected",
  endpoint,
  "Media Profile ONVIF dan URI RTSP berhasil diperoleh.",
);

            return;
          }

          lastMessage = result.message;
        } catch (error) {
          lastMessage =
            error instanceof Error
              ? error.message
              : "Endpoint ONVIF gagal diakses.";
        }
      }

      setStatusText(lastMessage);

      addHistory(
        "error",
        lastEndpoint,
        lastMessage,
      );

      Alert.alert(
        "Gagal mengambil stream",
        `${lastMessage}

Endpoint yang dicoba: ${endpoints.length}`,
      );
    } finally {
      setConnecting(null);
    }
  };

  const connectManual = () => {
    const value =
      manualUrl.trim();

    if (!isCameraUrl(value)) {
      Alert.alert(
        "URL tidak valid",
        "Gunakan rtsp://, rtsps://, http:// atau https://.",
      );

      return;
    }

    const target =
      addCredentials(
        value,
        username.trim(),
        password,
      );

setSelectedCamera(null);
setProfile(null);
setPlayerConnected(false);
setActiveStream(target);

    setTesting(true);

    setStatusText(
      "Mencoba membuka stream CCTV...",
    );

    setActiveTab("live");
  };

  const testConnection =
    async () => {
      const value =
        manualUrl.trim();

      const endpoint =
        getEndpointDetails(value);

      if (
        !isCameraUrl(value) ||
        !endpoint
      ) {
        Alert.alert(
          "URL tidak valid",
          "Masukkan URL kamera yang benar.",
        );

        return;
      }

      /*
       * RTSP/ONVIF tidak dapat diuji menggunakan fetch().
       * Untuk RTSP, pengujian dilakukan langsung oleh
       * native react-native-video melalui onLoad/onError.
       */
      if (
        endpoint.protocol === "RTSP" ||
        endpoint.protocol === "ONVIF"
      ) {
        const target =
          addCredentials(
            value,
            username.trim(),
            password,
          );

setTesting(true);
setSelectedCamera(null);
setProfile(null);
setPlayerConnected(false);
setActiveStream(target);

        setStatusText(
          "Menguji RTSP melalui native player...",
        );

        setActiveTab("live");

        return;
      }

      setTesting(true);

      try {
        const camera: CameraNetworkConfig =
          {
            id: "manual-camera",
            name: "Camera manual",
            url: value,
            vendor,
            username:
              username.trim() ||
              undefined,
            password:
              password ||
              undefined,
          };

        const result =
          await testCameraConnection(
            camera,
          );

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

    setTesting(false);
    setPlayerConnected(false);
    setActiveStream("");
    setSelectedCamera(null);
    setProfile(null);

    setStatusText(
      "CCTV telah diputus.",
    );
  };
  const renderLive = () => (
    <ScrollView
      style={styles.content}
      contentContainerStyle={styles.contentContainer}
    >
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>
            Live CCTV
          </Text>

          <Text style={styles.sectionSubtitle}>
            Pantau kamera CCTV secara langsung.
          </Text>
        </View>

        <View
          style={[
            styles.statusPill,
            playerConnected
            ? styles.statusPillOnline
            : styles.statusPillOffline
          ]}
        >
          <View
            style={[
              styles.statusDot,
              playerConnected 
                ? styles.statusDotOnline
                : styles.statusDotOffline,
            ]}
          />

<Text style={styles.statusPillText}>
  {playerConnected
    ? "TERHUBUNG"
    : activeStream
      ? "MEMBUKA STREAM"
      : "TIDAK TERHUBUNG"}
</Text>
        </View>
      </View>

      <View style={styles.cameraGrid}>
  {Array.from({ length: cameraCount }).map(
    (_, index) => {
      const stream =
        index === 0 ? activeStream : "";

      return (
        <View
          key={index}
          style={styles.cameraSlot}
        >
          <View style={styles.cameraSlotHeader}>
            <Text style={styles.cameraSlotTitle}>
              Kamera {index + 1}
            </Text>

            <Text style={styles.cameraSlotStatus}>
  {index === 0 && playerConnected
    ? "LIVE"
    : stream
      ? "MEMBUKA..."
      : "BELUM TERHUBUNG"}
</Text>
</View>

<CameraVideo
  url={stream}
  nativeControls={nativeControls}
  muted={muted}
  onLoad={() => {
    setPlayerConnected(true);
    setTesting(false);

    setStatusText(
      `ONLINE • Kamera ${index + 1} berhasil dibuka oleh native player.`,
    );

    if (stream) {
      addHistory(
        "connected",
        stream,
        `Kamera ${index + 1} berhasil dibuka oleh native player.`,
      );
    }
  }}
  onError={(message) => {
    setPlayerConnected(false);
    setTesting(false);

    setStatusText(
      `OFFLINE • Kamera ${index + 1}: ${message}`,
    );

    if (stream) {
      addHistory(
        "error",
        stream,
        message,
      );
    }
  }}
/>
</View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          Kontrol Live
        </Text>

        <View style={styles.buttonRow}>
          <Pressable
            style={[
              styles.primaryButton,
              styles.flexButton,
            ]}
            onPress={connectManual}
          >
            <Text style={styles.primaryButtonText}>
              ▶ Tampilkan Live
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.secondaryButton,
              styles.flexButton,
            ]}
            onPress={disconnect}
            disabled={!activeStream}
          >
            <Text
              style={[
                styles.secondaryButtonText,
                !activeStream &&
                  styles.disabledText,
              ]}
            >
              ■ Stop
            </Text>
          </Pressable>
        </View>

 <View style={styles.switchRow}>
  <View style={styles.switchTextWrap}>
    <Text style={styles.switchTitle}>
      Kontrol video
    </Text>

    <Text style={styles.switchDescription}>
      Tampilkan kontrol bawaan pemutar video.
    </Text>
  </View>

  <Switch
    value={nativeControls}
    onValueChange={setNativeControls}
  />
</View>

<View style={styles.switchRow}>
  <View style={styles.switchTextWrap}>
    <Text style={styles.switchTitle}>
      Suara CCTV
    </Text>

    <Text style={styles.switchDescription}>
      Aktifkan atau matikan suara dari stream CCTV.
    </Text>
  </View>

  <Switch
    value={!muted}
    onValueChange={(value) =>
      setMuted(!value)
    }
  />
</View>
</View>
      {statusText ? (
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            {statusText}
          </Text>
        </View>
      ) : null}

      {selectedCamera ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Kamera Aktif
          </Text>

          <Text style={styles.cameraName}>
            {selectedCamera.name ||
              "CCTV ONVIF"}
          </Text>

          <Text style={styles.cameraMeta}>
            {selectedCamera.host}
            {selectedCamera.port
              ? `:${selectedCamera.port}`
              : ""}
          </Text>

          {profile ? (
            <View style={styles.profileBox}>
              <Text style={styles.profileLabel}>
                Profil ONVIF
              </Text>

              <Text style={styles.profileValue}>
                {profile.name ||
                  profile.token ||
                  "Media Profile"}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          Hubungkan CCTV
        </Text>

        <Text style={styles.fieldLabel}>
          URL Stream
        </Text>

        <TextInput
          value={manualUrl}
          onChangeText={setManualUrl}
          placeholder="rtsp://192.168.1.20:554/stream1"
          placeholderTextColor="#7d8795"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />

        <Text style={styles.fieldLabel}>
          Username
        </Text>

        <TextInput
          value={username}
          onChangeText={setUsername}
          placeholder="Username kamera"
          placeholderTextColor="#7d8795"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />

        <Text style={styles.fieldLabel}>
          Password
        </Text>

        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password kamera"
          placeholderTextColor="#7d8795"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />

        <View style={styles.buttonRow}>
          <Pressable
            style={[
              styles.primaryButton,
              styles.flexButton,
            ]}
            onPress={connectManual}
          >
            <Text style={styles.primaryButtonText}>
              Hubungkan & Tampilkan
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.secondaryButton,
              styles.flexButton,
            ]}
            onPress={testConnection}
            disabled={testing}
          >
            {testing ? (
              <ActivityIndicator
                size="small"
              />
            ) : (
              <Text
                style={styles.secondaryButtonText}
              >
                Uji Koneksi
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );

  const renderCctv = () => (
    <ScrollView
      style={styles.content}
      contentContainerStyle={styles.contentContainer}
    >
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderText}>
          <Text style={styles.sectionTitle}>
            CCTV
          </Text>

          <Text style={styles.sectionSubtitle}>
            Cari kamera ONVIF di jaringan lokal.
          </Text>
        </View>

        <Pressable
          style={styles.primaryButtonSmall}
          onPress={searchCameras}
          disabled={searching}
        >
          {searching ? (
            <ActivityIndicator
              size="small"
              color="#fff"
            />
          ) : (
            <Text
              style={styles.primaryButtonText}
            >
              🔍 Cari CCTV
            </Text>
          )}
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          Kamera Ditemukan
        </Text>

        {searching ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator
              size="large"
            />

            <Text style={styles.loadingText}>
              Mencari kamera CCTV...
            </Text>
          </View>
        ) : cameras.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>
              📷
            </Text>

            <Text style={styles.emptyTitle}>
              Belum ada kamera
            </Text>

            <Text style={styles.centerText}>
              Tekan "Cari CCTV" untuk mencari
              kamera ONVIF pada jaringan Wi-Fi
              yang sama.
            </Text>
          </View>
        ) : (
          cameras.map((camera) => {
            const key =
              `${camera.host}:${camera.port}`;

            const endpoint =
              camera.xaddrs?.find((item) =>
                /^https?:\/\//i.test(item),
              );

            return (
              <View
                key={
                  camera.id ||
                  key
                }
                style={styles.cameraCard}
              >
                <View
                  style={
                    styles.cameraCardHeader
                  }
                >
                  <View
                    style={
                      styles.cameraIconBox
                    }
                  >
                    <Text
                      style={
                        styles.cameraIcon
                      }
                    >
                      📹
                    </Text>
                  </View>

                  <View
                    style={
                      styles.cameraCardInfo
                    }
                  >
                    <Text
                      style={
                        styles.cameraName
                      }
                    >
                      {camera.name ||
                        "Kamera ONVIF"}
                    </Text>

                    <Text
                      style={
                        styles.cameraMeta
                      }
                    >
                      {camera.host}
                      {camera.port
                        ? `:${camera.port}`
                        : ""}
                    </Text>

                    {endpoint ? (
                      <Text
                        style={
                          styles.endpointText
                        }
                        numberOfLines={1}
                      >
                        {endpoint}
                      </Text>
                    ) : null}
                  </View>
                </View>

                <View
                  style={
                    styles.buttonRow
                  }
                >
                  <Pressable
                    style={[
                      styles.primaryButton,
                      styles.flexButton,
                    ]}
                    onPress={() =>
                      connectOnvif(
                        camera,
                      )
                    }
                    disabled={
                      connecting === key
                    }
                  >
                                        {connecting === key ? (
                      <ActivityIndicator
                        size="small"
                        color="#fff"
                      />
                    ) : (
                      <Text
                        style={
                          styles.primaryButtonText
                        }
                      >
                        Hubungkan
                      </Text>
                    )}
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
      </View>

      {statusText ? (
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            {statusText}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );

  const renderHistory = () => (
    <ScrollView
      style={styles.content}
      contentContainerStyle={styles.contentContainer}
    >
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>
            Riwayat
          </Text>

          <Text style={styles.sectionSubtitle}>
            Riwayat koneksi dan aktivitas CCTV.
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        {history.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>
              🕘
            </Text>

            <Text style={styles.emptyTitle}>
              Belum ada riwayat
            </Text>

            <Text style={styles.centerText}>
              Aktivitas koneksi CCTV akan muncul
              di sini.
            </Text>
          </View>
        ) : (
          history.map((item) => (
            <View
              key={item.id}
              style={styles.historyItem}
            >
              <View
                style={[
                  styles.historyIndicator,
                  item.action === "connected"
                    ? styles.historyConnected
                    : item.action ===
                        "disconnected"
                      ? styles.historyDisconnected
                      : styles.historyError,
                ]}
              />

              <View
                style={
                  styles.historyContent
                }
              >
                <View
                  style={
                    styles.historyHeader
                  }
                >
                  <Text
                    style={
                      styles.historyAction
                    }
                  >
                    {item.action ===
                    "connected"
                      ? "Terhubung"
                      : item.action ===
                          "disconnected"
                        ? "Diputus"
                        : "Error"}
                  </Text>

                  <Text
                    style={
                      styles.historyTime
                    }
                  >
                    {item.time}
                  </Text>
                </View>

                <Text
                  style={
                    styles.historyUrl
                  }
                  numberOfLines={2}
                >
                  {item.url}
                </Text>

                <Text
                  style={
                    styles.historyMessage
                  }
                >
                  {item.message}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );

  const renderSettings = () => (
    <ScrollView
      style={styles.content}
      contentContainerStyle={styles.contentContainer}
    >
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>
            Pengaturan
          </Text>

          <Text style={styles.sectionSubtitle}>
            Pengaturan koneksi dan tampilan CCTV.
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          Kamera
        </Text>

        <Text style={styles.fieldLabel}>
          Vendor CCTV
        </Text>

        <View style={styles.vendorGrid}>
          {CCTV_VENDORS.map(
            (item) => (
              <Pressable
                key={item}
                style={[
                  styles.vendorButton,
                  vendor === item &&
                    styles.vendorButtonActive,
                ]}
                onPress={() =>
                  setVendor(item)
                }
              >
                <Text
                  style={[
                    styles.vendorText,
                    vendor === item &&
                      styles.vendorTextActive,
                  ]}
                >
                  {item}
                </Text>
              </Pressable>
            ),
          )}
        </View>

        <View style={styles.suggestionBox}>
          <Text
            style={
              styles.suggestionLabel
            }
          >
            URL RTSP contoh
          </Text>

          <Text
            style={
              styles.suggestionValue
            }
            numberOfLines={2}
          >
            {suggestedUrl}
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          Tampilan
        </Text>

        <View style={styles.switchRow}>
          <View style={styles.switchTextWrap}>
            <Text style={styles.switchTitle}>
              Informasi koneksi
            </Text>

            <Text
              style={
                styles.switchDescription
              }
            >
              Tampilkan informasi status
              koneksi pada layar.
            </Text>
          </View>

          <Switch
            value={showInfo}
            onValueChange={setShowInfo}
          />
        </View>

        <View style={styles.switchRow}>
          <View style={styles.switchTextWrap}>
            <Text style={styles.switchTitle}>
              Kontrol video
            </Text>

            <Text
              style={
                styles.switchDescription
              }
            >
              Tampilkan kontrol native pada
              pemutar video.
            </Text>
          </View>

          <Switch
            value={nativeControls}
            onValueChange={setNativeControls}
          />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          Status Sistem
        </Text>

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>
            ONVIF Discovery
          </Text>

          <Text style={styles.statusValue}>
            Aktif
          </Text>
        </View>

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>
            RTSP Player
          </Text>

          <Text style={styles.statusValue}>
            Native
          </Text>
        </View>

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>
            Kamera ditemukan
          </Text>

          <Text style={styles.statusValue}>
            {cameras.length}
          </Text>
        </View>

        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>
            Stream aktif
          </Text>

          <Text style={styles.statusValue}>
            {activeStream
              ? "Ya"
              : "Tidak"}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.app}>
        <View style={styles.header}>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.appTitle}>
              CCTV Universal Monitor
            </Text>

            <Text style={styles.appSubtitle}>
              ONVIF • RTSP • HTTP
            </Text>
          </View>

          <View style={styles.headerStatus}>

<View
  style={[
    styles.headerStatusDot,
    playerConnected
      ? styles.headerStatusOnline
      : styles.headerStatusOffline,
  ]}
/>

<Text style={styles.headerStatusText}>
  {playerConnected
    ? "LIVE"
    : activeStream
      ? "CONNECTING"
      : "OFFLINE"}
</Text>
</View>
</View>

        {showInfo && statusText ? (
          <View style={styles.topStatus}>
            <Text
              style={styles.topStatusText}
              numberOfLines={2}
            >
              {statusText}
            </Text>
          </View>
        ) : null}

        <View style={styles.main}>
          {activeTab === "live"
            ? renderLive()
            : activeTab === "cctv"
              ? renderCctv()
              : activeTab === "history"
                ? renderHistory()
                : renderSettings()}
        </View>

        <View style={styles.bottomTabs}>
          <TabButton
            icon="▶"
            label="Live CCTV"
            active={activeTab === "live"}
            onPress={() =>
              setActiveTab("live")
            }
          />

          <TabButton
            icon="📹"
            label="CCTV"
            active={activeTab === "cctv"}
            onPress={() =>
              setActiveTab("cctv")
            }
          />

          <TabButton
            icon="🕘"
            label="Riwayat"
            active={
              activeTab === "history"
            }
            onPress={() =>
              setActiveTab("history")
            }
          />

          <TabButton
            icon="⚙"
            label="Pengaturan"
            active={
              activeTab === "settings"
            }
            onPress={() =>
              setActiveTab("settings")
            }
          />
        </View>
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0b1118",
  },

  app: {
    flex: 1,
    backgroundColor: "#0b1118",
  },

  header: {
    minHeight: 72,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#202a35",
    backgroundColor: "#111923",
  },

  headerTitleWrap: {
    flex: 1,
  },

  appTitle: {
    color: "#ffffff",
    fontSize: 19,
    fontWeight: "800",
  },

  appSubtitle: {
    marginTop: 3,
    color: "#8d99a8",
    fontSize: 12,
  },

  headerStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: "#18222d",
  },

  headerStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  headerStatusOnline: {
    backgroundColor: "#36d399",
  },

  headerStatusOffline: {
    backgroundColor: "#687585",
  },

  headerStatusText: {
    color: "#dbe4ee",
    fontSize: 11,
    fontWeight: "800",
  },

  topStatus: {
    marginHorizontal: 14,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: "#142333",
    borderWidth: 1,
    borderColor: "#23405b",
  },

  topStatusText: {
    color: "#bcdcff",
    fontSize: 12,
    lineHeight: 18,
  },

  main: {
    flex: 1,
  },

  content: {
    flex: 1,
  },

  contentContainer: {
    padding: 16,
    paddingBottom: 30,
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    gap: 12,
  },

  sectionHeaderText: {
    flex: 1,
  },

  sectionTitle: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "800",
  },

  sectionSubtitle: {
    marginTop: 4,
    color: "#8793a2",
    fontSize: 13,
    lineHeight: 19,
  },

  card: {
    marginBottom: 14,
    padding: 15,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#202b37",
    backgroundColor: "#111923",
  },

  cardTitle: {
    marginBottom: 13,
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
  },

  videoBox: {
    position: "relative",
    width: "100%",
    aspectRatio: 16 / 9,
    marginBottom: 14,
    overflow: "hidden",
    borderRadius: 15,
    backgroundColor: "#020609",
    borderWidth: 1,
    borderColor: "#25313e",
  },

  video: {
    width: "100%",
    height: "100%",
    backgroundColor: "#020609",
  },

  emptyVideo: {
    width: "100%",
    aspectRatio: 16 / 9,
    marginBottom: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 25,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#25313e",
    backgroundColor: "#111923",
  },

  bigIcon: {
    marginBottom: 10,
    fontSize: 40,
  },

  emptyBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 28,
    paddingHorizontal: 20,
  },

  emptyIcon: {
    marginBottom: 10,
    fontSize: 35,
  },

  emptyTitle: {
    marginBottom: 6,
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },

  centerText: {
    color: "#8793a2",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },

  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 25,
    backgroundColor: "rgba(0,0,0,0.55)",
  },

  overlayTitle: {
    marginTop: 10,
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },

  overlayText: {
    marginTop: 8,
    color: "#d8e0e8",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },

  errorIcon: {
    color: "#ff8d8d",
    fontSize: 34,
  },

  liveBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 7,
    backgroundColor: "rgba(130,0,0,0.78)",
  },

  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#ff5353",
  },

  liveText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "900",
  },

  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 20,
  },

  statusPillOnline: {
    backgroundColor: "#123b2d",
  },

  statusPillOffline: {
    backgroundColor: "#202832",
  },

  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },

  statusDotOnline: {
    backgroundColor: "#36d399",
  },

  statusDotOffline: {
    backgroundColor: "#687585",
  },

  statusPillText: {
    color: "#d9e4ee",
    fontSize: 10,
    fontWeight: "800",
  },

  buttonRow: {
    flexDirection: "row",
    gap: 9,
    marginTop: 4,
  },

  flexButton: {
    flex: 1,
  },

  primaryButton: {
    minHeight: 46,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "#1976d2",
  },

  primaryButtonSmall: {
    minHeight: 40,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    backgroundColor: "#1976d2",
  },

  primaryButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },

  secondaryButton: {
    minHeight: 46,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#344352",
    backgroundColor: "#19232e",
  },

  secondaryButtonText: {
    color: "#dce5ed",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },

  disabledText: {
    color: "#65717e",
  },

  infoBox: {
    marginBottom: 14,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#23405b",
    backgroundColor: "#122131",
  },

  infoText: {
    color: "#bcdcff",
    fontSize: 12,
    lineHeight: 18,
  },

  fieldLabel: {
    marginTop: 5,
    marginBottom: 7,
    color: "#b9c4cf",
    fontSize: 12,
    fontWeight: "700",
  },

  input: {
    minHeight: 46,
    marginBottom: 10,
    paddingHorizontal: 12,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#2b3845",
    backgroundColor: "#0b1219",
    color: "#ffffff",
    fontSize: 13,
  },

  switchRow: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#202b37",
  },

  switchTextWrap: {
    flex: 1,
    paddingVertical: 10,
  },

  switchTitle: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },

  switchDescription: {
    marginTop: 3,
    color: "#7f8b99",
    fontSize: 12,
    lineHeight: 17,
  },

  cameraCard: {
    marginBottom: 11,
    padding: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#263442",
    backgroundColor: "#0d151e",
  },

    cameraGrid: {
    width: "100%",
    gap: 10,
    marginBottom: 4,
  },

  cameraSlot: {
    width: "100%",
  },

  cameraSlotHeader: {
    minHeight: 32,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    backgroundColor: "#172330",
  },

  cameraSlotTitle: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
  },

  cameraSlotStatus: {
    color: "#8d99a8",
    fontSize: 9,
    fontWeight: "800",
  },

  cameraCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },

  cameraIconBox: {
    width: 45,
    height: 45,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    backgroundColor: "#172433",
  },

  cameraIcon: {
    fontSize: 23,
  },

  cameraCardInfo: {
    flex: 1,
  },

  cameraName: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },

  cameraMeta: {
    marginTop: 3,
    color: "#8b98a7",
    fontSize: 12,
  },

  endpointText: {
    marginTop: 4,
    color: "#64788d",
    fontSize: 10,
  },

  profileBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 9,
    backgroundColor: "#172330",
  },

  profileLabel: {
    color: "#7e8d9d",
    fontSize: 10,
    fontWeight: "700",
  },

  profileValue: {
    marginTop: 3,
    color: "#dce7f0",
    fontSize: 12,
  },

  loadingBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 35,
  },

  loadingText: {
    marginTop: 10,
    color: "#8d99a8",
    fontSize: 13,
  },

  vendorGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  vendorButton: {
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#2c3946",
    backgroundColor: "#0c141c",
  },

  vendorButtonActive: {
    borderColor: "#1976d2",
    backgroundColor: "#15365a",
  },

  vendorText: {
    color: "#9aa6b3",
    fontSize: 11,
    fontWeight: "700",
  },

  vendorTextActive: {
    color: "#ffffff",
  },

  suggestionBox: {
    marginTop: 15,
    padding: 11,
    borderRadius: 9,
    backgroundColor: "#0b131b",
  },

  suggestionLabel: {
    color: "#718091",
    fontSize: 10,
    fontWeight: "700",
  },

  suggestionValue: {
    marginTop: 5,
    color: "#b8cce0",
    fontSize: 11,
    lineHeight: 17,
  },

  statusRow: {
    minHeight: 43,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#202b37",
  },

  statusLabel: {
    color: "#8d99a8",
    fontSize: 13,
  },

  statusValue: {
    color: "#dce7f0",
    fontSize: 13,
    fontWeight: "700",
  },

  historyItem: {
    flexDirection: "row",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#202b37",
  },

  historyIndicator: {
    width: 4,
    marginRight: 11,
    borderRadius: 4,
  },

  historyConnected: {
    backgroundColor: "#36d399",
  },

  historyDisconnected: {
    backgroundColor: "#7d8a98",
  },

  historyError: {
    backgroundColor: "#ef6b73",
  },

  historyContent: {
    flex: 1,
  },

  historyHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },

  historyAction: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },

  historyTime: {
    color: "#697786",
    fontSize: 10,
  },

  historyUrl: {
    marginTop: 5,
    color: "#8ea0b1",
    fontSize: 11,
  },

  historyMessage: {
    marginTop: 4,
    color: "#687887",
    fontSize: 11,
    lineHeight: 16,
  },

  bottomTabs: {
    minHeight: 67,
    flexDirection: "row",
    alignItems: "stretch",
    borderTopWidth: 1,
    borderTopColor: "#202a35",
    backgroundColor: "#111923",
  },

  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 7,
    borderTopWidth: 2,
    borderTopColor: "transparent",
  },

  tabActive: {
    borderTopColor: "#1976d2",
    backgroundColor: "#15212d",
  },

  tabIcon: {
    marginBottom: 3,
    fontSize: 17,
  },

  tabText: {
    color: "#718091",
    fontSize: 10,
    fontWeight: "700",
  },

  tabTextActive: {
    color: "#ffffff",
  },
});
