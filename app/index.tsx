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
import * as ImagePicker from "expo-image-picker";

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
  if (!username && !password) return value.trim();

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
          Pilih kamera atau masukkan URL RTSP/HTTP/HTTPS.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.videoBox}>
      <Video
        focusable
        source={{
          uri: url,
          type:
            url.toLowerCase().startsWith("rtsp://") ||
            url.toLowerCase().startsWith("rtsps://")
              ? "rtsp"
              : undefined,
        }}
        style={styles.video}
        controls={nativeControls}
        controlsStyles={{
          hideFullscreen: false,
          hideSeekBar: true,
          liveLabel: "LIVE",
        }}
        muted={muted}
        resizeMode="contain"
        paused={false}
        playInBackground={false}
        playWhenInactive={false}
        repeat={false}
        onLoad={() => {
          setLoaded(true);
          setError(false);
          setErrorDetail("");
          onLoad?.();
        }}
        onError={(videoError) => {
          const errorObject = videoError?.error;

          const errorCode =
            errorObject?.errorCode || "";

          const errorString =
            errorObject?.errorString || "";

          const errorException =
            errorObject?.errorException || "";

          const detail = [
            errorCode ? `Code: ${errorCode}` : "",
            errorString ? `Detail: ${errorString}` : "",
            errorException
              ? `Exception: ${errorException}`
              : "",
          ]
            .filter(Boolean)
            .join(" • ");

          const finalDetail =
            detail ||
            "ExoPlayer gagal membuka stream CCTV.";

          setLoaded(false);
          setError(true);
          setErrorDetail(finalDetail);

          onError?.(finalDetail);
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
            {errorDetail}
          </Text>

          <Text style={styles.overlayText}>
            Periksa URL RTSP, codec,
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

  const [activeStream, setActiveStream] =
    useState("");

  const [playerConnected, setPlayerConnected] =
    useState(false);

  const [manualUrl, setManualUrl] = useState(
    "rtsp://192.168.1.20:554/stream1",
  );

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

  const [muted, setMuted] =
    useState(false);

  const [cameraCount, setCameraCount] =
    useState(1);

  const [cameraStreams, setCameraStreams] =
    useState<string[]>([]);

  const [cameraConnected, setCameraConnected] =
    useState<boolean[]>([]);

  const [cameraMuted, setCameraMuted] =
    useState<boolean[]>([]);

  const [cameraControlsVisible, setCameraControlsVisible] =
    useState<boolean[]>([]);

  const cameraControlsTimers =
    useRef<
      Array<ReturnType<typeof setTimeout> | null>
    >([]);

  const [ownerText, setOwnerText] =
    useState(
      "Pemilik: CCTV Universal Monitor",
    );

  const [logoUri, setLogoUri] =
    useState("");

  const [savedOwnerText, setSavedOwnerText] =
    useState(
      "Pemilik: CCTV Universal Monitor",
    );

  const [savedLogoUri, setSavedLogoUri] =
    useState("");

  const [settingsSaved, setSettingsSaved] =
    useState(false);

  const marqueeX =
    useRef(new Animated.Value(0)).current;

  const [marqueeClipWidth, setMarqueeClipWidth] =
    useState(0);

  const [marqueeTextWidth, setMarqueeTextWidth] =
    useState(0);

  const displayedLogo =
    logoUri.trim() || savedLogoUri;

  const displayedOwner =
    ownerText.trim() ||
    savedOwnerText ||
    "Pemilik: CCTV Universal Monitor";

  useEffect(() => {
    setPlayerConnected(false);
  }, [activeStream]);

  useEffect(() => {
    if (
      !marqueeClipWidth ||
      !marqueeTextWidth
    ) {
      return;
    }

    marqueeX.stopAnimation();

    marqueeX.setValue(
      marqueeClipWidth,
    );

    const travelDistance =
      marqueeTextWidth +
      marqueeClipWidth;

    const moveDuration =
      Math.max(
        7000,
        travelDistance * 28,
      );

    const animation =
      Animated.loop(
        Animated.sequence([
          Animated.timing(
            marqueeX,
            {
              toValue:
                -marqueeTextWidth,
              duration:
                moveDuration,
              easing:
                Easing.linear,
              useNativeDriver:
                true,
            },
          ),

          Animated.delay(1500),

          Animated.timing(
            marqueeX,
            {
              toValue:
                marqueeClipWidth,
              duration: 0,
              useNativeDriver:
                true,
            },
          ),

          Animated.delay(500),
        ]),
      );

    animation.start();

    return () =>
      animation.stop();
  }, [
    marqueeClipWidth,
    marqueeTextWidth,
    displayedOwner,
    marqueeX,
  ]);

  const suggestedUrl = useMemo(
    () =>
      makeRtspUrl(
        vendor,
        "192.168.1.20",
      ),
    [vendor],
  );

  const findNextCameraSlot = () => {
    const firstEmpty =
      cameraStreams.findIndex(
        (stream, index) =>
          index < 9 &&
          !stream.trim(),
      );

    if (firstEmpty >= 0) {
      return firstEmpty;
    }

    return cameraStreams.length < 9
      ? cameraStreams.length
      : -1;
  };

  const setCameraStream = (
    slot: number,
    stream: string,
  ) => {
    setCameraStreams(
      (items) => {
        const next = [...items];

        next[slot] = stream;

        return next;
      },
    );

    setCameraConnected(
      (items) => {
        const next = [...items];

        next[slot] = false;

        return next;
      },
    );

    setCameraMuted(
      (items) => {
        const next = [...items];

        next[slot] = false;

        return next;
      },
    );

    const requiredLayout =
      slot === 0
        ? 1
        : slot === 1
          ? 2
          : slot < 4
            ? 4
            : slot < 6
              ? 6
              : 9;

    setCameraCount(
      (current) =>
        current < requiredLayout
          ? requiredLayout
          : current,
    );
  };

  const setCameraSlotConnected = (
    slot: number,
    connected: boolean,
  ) => {
    setCameraConnected(
      (items) => {
        const next = [...items];

        next[slot] = connected;

        return next;
      },
    );

    setPlayerConnected(
      connected,
    );
  };

  const showCameraControls = (
    slot: number,
  ) => {
    const oldTimer =
      cameraControlsTimers
        .current[slot];

    if (oldTimer) {
      clearTimeout(oldTimer);
    }

    setCameraControlsVisible(
      (items) => {
        const next = [...items];

        next[slot] = true;

        return next;
      },
    );

    cameraControlsTimers.current[
      slot
    ] = setTimeout(() => {
      setCameraControlsVisible(
        (items) => {
          const next = [...items];

          next[slot] = false;

          return next;
        },
      );

      cameraControlsTimers.current[
        slot
      ] = null;
    }, 4000);
  };

  const addHistory = (
    action: HistoryItem["action"],
    url: string,
    message: string,
  ) => {
    setHistory(
      (items) =>
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

  const pickLogoFromGallery =
    async () => {
      try {
        const permission =
          await ImagePicker.requestMediaLibraryPermissionsAsync();

        if (!permission.granted) {
          Alert.alert(
            "Izin galeri diperlukan",
            "Izinkan aplikasi mengakses galeri HP untuk memilih logo.",
          );
          return;
        }

        const result =
          await ImagePicker.launchImageLibraryAsync(
            {
              mediaTypes: ["images"],
              allowsEditing: true,
              aspect: [1, 1],
              quality: 1,
            },
          );

        if (
          !result.canceled &&
          result.assets?.[0]?.uri
        ) {
          setLogoUri(
            result.assets[0].uri,
          );

          setSettingsSaved(false);

          setStatusText(
            "Logo dipilih. Tekan Simpan Pengaturan.",
          );
        }
      } catch (error) {
        Alert.alert(
          "Ganti logo gagal",
          error instanceof Error
            ? error.message
            : "Gagal memilih logo dari galeri.",
        );
      }
    };

  const clearLogo = () => {
    setLogoUri("");
    setSettingsSaved(false);

    setStatusText(
      "Logo dihapus dari pengaturan. Tekan Simpan Pengaturan.",
    );
  };

  const saveSettings = () => {
    setSavedOwnerText(
      ownerText.trim() ||
        "Pemilik: CCTV Universal Monitor",
    );

    setSavedLogoUri(
      logoUri.trim(),
    );

    setSettingsSaved(true);

    setStatusText(
      "Pengaturan berhasil disimpan.",
    );

    Alert.alert(
      "Berhasil",
      "Pengaturan identitas dan logo telah disimpan.",
    );
  };

  const searchCameras =
    async () => {
      if (searching) return;

      setSearching(true);
      setStatusText("");

      try {
        const found =
          await discoverOnvifCameras(
            7000,
          );

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

  const connectOnvif =
    async (
      camera: DiscoveredCamera,
    ) => {
      const slot =
        findNextCameraSlot();

      if (slot < 0) {
        Alert.alert(
          "Slot kamera penuh",
          "Maksimal 9 kamera dapat ditampilkan.",
        );
        return;
      }

            const endpoints =
        Array.from(
          new Set(
            (camera.xaddrs ?? []).filter(
              (item) =>
                /^https?:\/\//i.test(
                  item,
                ),
            ),
          ),
        );

      const key =
        `${camera.host}:${camera.port}`;

      if (!endpoints.length) {
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
          username.trim() ||
          undefined,
        password:
          password ||
          undefined,
      };

      let lastMessage =
        "Kamera terdeteksi, tetapi Media Profile ONVIF belum berhasil diperoleh.";

      let lastEndpoint =
        endpoints[0];

      try {
        for (
          let index = 0;
          index < endpoints.length;
          index += 1
        ) {
          const endpoint =
            endpoints[index];

          lastEndpoint =
            endpoint;

          setStatusText(
            `Mencoba endpoint ONVIF ${index + 1}/${endpoints.length}...`,
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

              setCameraStream(
                slot,
                streamUri,
              );

              setActiveStream(
                streamUri,
              );

              setManualUrl(
                hideCredentials(
                  result.streamUri,
                ),
              );

              setProfile(
                result.profile ??
                  null,
              );

              setTesting(true);

              setStatusText(
                `Kamera ${slot + 1}: URI RTSP berhasil diperoleh. Membuka video...`,
              );

              setActiveTab(
                "live",
              );

              addHistory(
                "connected",
                endpoint,
                `Kamera ${slot + 1}: Media Profile ONVIF dan URI RTSP berhasil diperoleh.`,
              );

              return;
            }

            lastMessage =
              result.message;
          } catch (error) {
            lastMessage =
              error instanceof Error
                ? error.message
                : "Endpoint ONVIF gagal diakses.";
          }
        }

        setStatusText(
          lastMessage,
        );

        addHistory(
          "error",
          lastEndpoint,
          lastMessage,
        );

        Alert.alert(
          "Gagal mengambil stream",
          `${lastMessage}\n\nEndpoint yang dicoba: ${endpoints.length}`,
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

    const slot =
      findNextCameraSlot();

    if (slot < 0) {
      Alert.alert(
        "Slot kamera penuh",
        "Maksimal 9 kamera dapat ditampilkan.",
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

    setCameraStream(
      slot,
      target,
    );

    setActiveStream(
      target,
    );

    setTesting(true);

    setStatusText(
      `Membuka Kamera ${slot + 1}...`,
    );

    setActiveTab(
      "live",
    );
  };

  const testConnection =
    async () => {
      const value =
        manualUrl.trim();

      const endpoint =
        getEndpointDetails(
          value,
        );

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

      const target =
        addCredentials(
          value,
          username.trim(),
          password,
        );

      if (
        endpoint.protocol ===
          "RTSP" ||
        endpoint.protocol ===
          "ONVIF"
      ) {
        const slot =
          findNextCameraSlot();

        if (slot < 0) {
          Alert.alert(
            "Slot kamera penuh",
            "Maksimal 9 kamera dapat ditampilkan.",
          );
          return;
        }

        setTesting(true);
        setSelectedCamera(null);
        setProfile(null);
        setPlayerConnected(false);
        setCameraStream(
          slot,
          target,
        );
        setActiveStream(
          target,
        );
        setStatusText(
          `Menguji Kamera ${slot + 1} melalui native player...`,
        );
        setActiveTab(
          "live",
        );
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

        setStatusText(
          message,
        );

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

        setStatusText(
          message,
        );

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
    setCameraStreams([]);
    setCameraConnected([]);
    setCameraMuted([]);
    setCameraControlsVisible([]);
    setActiveStream("");
    setSelectedCamera(null);
    setProfile(null);
    setStatusText(
      "CCTV telah diputus.",
    );
  };

  /*
   * LIVE CCTV
   *
   * Hanya menampilkan kamera yang
   * benar-benar memiliki stream.
   * Slot kosong tidak mengambil tempat.
   *
   * 1 kamera  = 1 kolom
   * 2-4       = 2 kolom
   * 5-9       = 3 kolom
   */

  const renderLive = () => {
    const activeCameraIndexes =
      cameraStreams
        .map(
          (stream, index) =>
            stream.trim()
              ? index
              : -1,
        )
        .filter(
          (index) =>
            index >= 0,
        );

    const activeCount =
      activeCameraIndexes.length;

    const visibleIndexes =
      activeCount > 0
        ? activeCameraIndexes
        : [];

    const columns =
      activeCount <= 1
        ? 1
        : activeCount <= 4
          ? 2
          : 3;

    const slotWidth =
      columns === 1
        ? "100%"
        : columns === 2
          ? "48.5%"
          : "31.5%";

    return (
      <ScrollView
        style={styles.content}
        contentContainerStyle={[
          styles.contentContainer,
          styles.liveContentContainer,
        ]}
      >
        {activeCount === 0 ? (
          <View
            style={
              styles.liveEmptyHeader
            }
          >
            <Text
              style={
                styles.liveEmptyIcon
              }
            >
              📹
            </Text>

            <Text
              style={styles.cardTitle}
            >
              Live CCTV
            </Text>

            <Text
              style={
                styles.centerText
              }
            >
              Belum ada kamera aktif.
              {"\n"}
              Hubungkan kamera dari
              menu CCTV.
            </Text>
          </View>
        ) : null}

        <View
          style={styles.cameraGrid}
        >
          {visibleIndexes.map(
            (index) => {
              const stream =
                cameraStreams[
                  index
                ] || "";

              const connected =
                Boolean(
                  cameraConnected[
                    index
                  ],
                );

              return (
                <View
                  key={index}
                  style={[
                    styles.cameraSlot,
                    {
                      width:
                        slotWidth,
                    },
                    visibleIndexes.length ===
                      1 &&
                      styles.cameraSlotSingle,
                  ]}
                  onTouchStart={() =>
                    showCameraControls(
                      index,
                    )
                  }
                >
                  <View
                    style={
                      styles.cameraSlotHeader
                    }
                  >
                    <Text
                      style={
                        styles.cameraSlotTitle
                      }
                    >
                      Kamera {index + 1}
                    </Text>

                    <Text
                      style={
                        styles.cameraSlotStatus
                      }
                    >
                      {connected
                        ? "LIVE"
                        : stream
                          ? "MEMBUKA..."
                          : "BELUM TERHUBUNG"}
                    </Text>
                  </View>

                  <CameraVideo
                    url={stream}
                    nativeControls={
                      nativeControls
                    }
                    muted={
                      cameraMuted[
                        index
                      ] ?? muted
                    }
                    onLoad={() => {
                      setCameraSlotConnected(
                        index,
                        true,
                      );

                      setTesting(false);

                      setStatusText(
                        `Kamera ${index + 1} LIVE.`,
                      );
                    }}
                    onError={(
                      message,
                    ) => {
                      setCameraSlotConnected(
                        index,
                        false,
                      );

                      setTesting(false);

                      setStatusText(
                        `OFFLINE • Kamera ${
                          index + 1
                        }: ${message}`,
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

                  {stream &&
                  cameraControlsVisible[
                    index
                  ] ? (
                    <View
                      style={
                        styles.cameraControlsOverlay
                      }
                    >
                      <Pressable
                        onPress={() => {
                          setCameraMuted(
                            (
                              items,
                            ) => {
                              const next =
                                [
                                  ...items,
                                ];

                              next[index] =
                                !(
                                  next[
                                    index
                                  ] ??
                                  false
                                );

                              return next;
                            },
                          );

                          showCameraControls(
                            index,
                          );
                        }}
                        style={
                          styles.micButton
                        }
                      >
                        <Text
                          style={
                            styles.micButtonText
                          }
                        >
                          {(
                            cameraMuted[
                              index
                            ] ?? muted
                          )
                            ? "🔇"
                            : "🎙️"}
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            },
          )}
        </View>

        {activeCount > 0 ? (
          <View
            style={
              styles.liveGridInfo
            }
          >
            <Text
              style={
                styles.layoutHint
              }
            >
              {activeCount} kamera aktif
              {" • "}
              {columns} kolom otomatis
            </Text>
          </View>
        ) : null}

        {statusText ? (
          <View
            style={styles.infoBox}
          >
            <Text
              style={styles.infoText}
            >
              {statusText}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    );
  };

/*
 * MENU CCTV
 *
 * Pengaturan jumlah tampilan dan
 * koneksi manual dipindahkan ke sini.
 * Halaman Live tetap bersih.
 */
const renderCctv = () => (
  <ScrollView
    style={styles.content}
    contentContainerStyle={
      styles.contentContainer
    }
  >
    <View style={styles.sectionHeader}>
      <View
        style={styles.sectionHeaderText}
      >
        <Text style={styles.sectionTitle}>
          CCTV
        </Text>

        <Text
          style={styles.sectionSubtitle}
        >
          Cari kamera ONVIF atau tambahkan
          kamera secara manual.
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
            style={
              styles.primaryButtonText
            }
          >
            🔍 Cari CCTV
          </Text>
        )}
      </Pressable>
    </View>

    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        Tata Letak Kamera
      </Text>

      <View style={styles.layoutRow}>
        {[1, 2, 4, 6, 9].map(
          (count) => (
            <Pressable
              key={count}
              onPress={() =>
                setCameraCount(
                  count,
                )
              }
              style={[
                styles.layoutButton,
                cameraCount ===
                  count &&
                  styles.layoutButtonActive,
              ]}
            >
              <Text
                style={[
                  styles.layoutButtonText,
                  cameraCount ===
                    count &&
                    styles.layoutButtonTextActive,
                ]}
              >
                {count}
              </Text>
            </Pressable>
          ),
        )}
      </View>

      <Text
        style={styles.layoutHint}
      >
        Pilihan layout maksimum 1, 2, 4,
        6 atau 9 kamera. Ukuran kamera
        tetap otomatis mengikuti jumlah
        kamera yang aktif.
      </Text>
    </View>

    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        Koneksi Manual
      </Text>

      <Text style={styles.fieldLabel}>
        URL CCTV
      </Text>

      <TextInput
        value={manualUrl}
        onChangeText={setManualUrl}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="rtsp://..."
        placeholderTextColor="#667483"
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
          <Text
            style={
              styles.primaryButtonText
            }
          >
            ▶ Tampilkan Live
          </Text>
        </Pressable>

        <Pressable
          style={[
            styles.secondaryButton,
            styles.flexButton,
          ]}
          onPress={testConnection}
        >
          <Text
            style={
              styles.secondaryButtonText
            }
          >
            Tes Koneksi
          </Text>
        </Pressable>
      </View>

      <Pressable
        style={
          styles.secondaryButton
        }
        onPress={disconnect}
        disabled={
          !activeStream &&
          cameraStreams.length === 0
        }
      >
        <Text
          style={[
            styles.secondaryButtonText,
            !activeStream &&
              cameraStreams.length === 0 &&
              styles.disabledText,
          ]}
        >
          ■ Putuskan Semua Kamera
        </Text>
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

          <Text
            style={styles.loadingText}
          >
            Mencari kamera CCTV...
          </Text>
        </View>
      ) : cameras.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text
            style={styles.emptyIcon}
          >
            📷
          </Text>

          <Text
            style={styles.emptyTitle}
          >
            Belum ada kamera
          </Text>

          <Text
            style={styles.centerText}
          >
            Tekan "Cari CCTV" untuk
            mencari kamera ONVIF.
          </Text>
        </View>
      ) : (
        cameras.map((camera) => {
          const key =
            `${camera.host}:${camera.port}`;

          const endpoint =
            camera.xaddrs?.find(
              (item) =>
                /^https?:\/\//i.test(
                  item,
                ),
            );

          return (
            <View
              key={
                camera.id || key
              }
              style={
                styles.cameraCard
              }
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

              <Pressable
                style={
                  styles.primaryButton
                }
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
                    Hubungkan ke Slot Berikutnya
                  </Text>
                )}
              </Pressable>
            </View>
          );
        })
      )}
    </View>
  </ScrollView>
);

/*
 * MENU RIWAYAT
 */
const renderHistory = () => (
  <ScrollView
    style={styles.content}
    contentContainerStyle={
      styles.contentContainer
    }
  >
    <View style={styles.sectionHeader}>
      <View
        style={styles.sectionHeaderText}
      >
        <Text style={styles.sectionTitle}>
          Riwayat
        </Text>

        <Text
          style={styles.sectionSubtitle}
        >
          Catatan koneksi dan aktivitas
          kamera.
        </Text>
      </View>

      {history.length > 0 ? (
        <Pressable
          style={
            styles.secondaryButtonSmall
          }
          onPress={() =>
            setHistory([])
          }
        >
          <Text
            style={
              styles.secondaryButtonText
            }
          >
            Hapus Riwayat
          </Text>
        </Pressable>
      ) : null}
    </View>

    {history.length === 0 ? (
      <View style={styles.emptyBox}>
        <Text style={styles.emptyIcon}>
          📝
        </Text>

        <Text
          style={styles.emptyTitle}
        >
          Belum ada riwayat
        </Text>

        <Text
          style={styles.centerText}
        >
          Aktivitas koneksi kamera akan
          muncul di sini.
        </Text>
      </View>
    ) : (
      history.map((item) => (
  <View
    key={item.id}
    style={styles.card}
  >
    <Text
      style={styles.cardTitle}
    >
      {item.action ===
      "connected"
        ? "✓ Terhubung"
        : item.action ===
            "disconnected"
          ? "■ Terputus"
          : "⚠ Error"}
    </Text>

    <Text
      style={styles.statusText}
    >
      {item.message}
    </Text>

    <Text
      style={styles.endpointText}
    >
      {item.url}
    </Text>

    <Text
      style={styles.cameraMeta}
    >
      {item.time}
    </Text>
  </View>
))
    )}
  </ScrollView>
);

  const renderSettings = () => (
    <ScrollView
      style={styles.content}
      contentContainerStyle={styles.contentContainer}
    >
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Pengaturan</Text>
          <Text style={styles.sectionSubtitle}>
            Atur identitas, logo, koneksi, dan kontrol video.
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Identitas Pemilik</Text>

        <Text style={styles.switchDescription}>
          Teks identitas pemilik yang berjalan di header.
        </Text>

                <TextInput
          value={ownerText}
          onChangeText={(value) => {
            setOwnerText(value);
            setSettingsSaved(false);
          }}
          placeholder="Masukkan identitas pemilik"
          placeholderTextColor="#667483"
          style={styles.input}
        />

        <Text style={styles.cardTitle}>Logo Header</Text>

                <Text style={styles.cardTitle}>Logo Header</Text>

        <Text style={styles.logoHelpText}>
          Pilih logo dari galeri HP. Logo akan tampil di sudut kanan
          atas header.
        </Text>

        <View style={styles.logoActionRow}>
          <Pressable
            onPress={pickLogoFromGallery}
            style={[styles.primaryButtonSmall, styles.flexButton]}
          >
            <Text style={styles.primaryButtonText}>
              Pilih / Ganti Logo
            </Text>
          </Pressable>

          {logoUri.trim() ? (
            <Pressable
              onPress={clearLogo}
              style={styles.secondaryButtonSmall}
            >
              <Text style={styles.secondaryButtonText}>
                Hapus
              </Text>
            </Pressable>
          ) : null}
        </View>

        {logoUri.trim() ? (
          <Image
            source={{ uri: logoUri.trim() }}
            style={styles.logoPreview}
            resizeMode="contain"
          />
        ) : (
          <View style={styles.logoEmptyPreview}>
            <Text style={styles.logoEmptyText}>
              Belum ada logo dipilih
            </Text>
          </View>
        )}

        <Text style={styles.logoUriText} numberOfLines={2}>
          {logoUri.trim() || "Logo belum dipilih dari galeri."}
        </Text>

        <Pressable
          onPress={saveSettings}
          style={[
            styles.saveButton,
            settingsSaved && styles.saveButtonSaved,
          ]}
        >
          <Text style={styles.saveButtonText}>
            {settingsSaved
              ? "✓ Pengaturan Tersimpan"
              : "💾 Simpan Pengaturan"}
          </Text>
        </Pressable>

        <Text style={styles.saveHint}>
          Tekan tombol ini setelah mengganti logo atau identitas pemilik.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Kontrol Video</Text>

        <View style={styles.switchRow}>
          <View style={styles.switchTextWrap}>
            <Text style={styles.switchTitle}>Kontrol video</Text>
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
            <Text style={styles.switchTitle}>Suara CCTV</Text>
            <Text style={styles.switchDescription}>
              Aktifkan atau matikan suara kamera.
            </Text>
          </View>

          <Switch
            value={!muted}
            onValueChange={(value) =>
              setMuted(!value)
            }
          />
        </View>

        <View style={styles.switchRow}>
          <View style={styles.switchTextWrap}>
            <Text style={styles.switchTitle}>
              Informasi status
            </Text>

            <Text style={styles.switchDescription}>
              Tampilkan informasi status di bagian atas.
            </Text>
          </View>

          <Switch
            value={showInfo}
            onValueChange={setShowInfo}
          />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          Koneksi Kamera
        </Text>
        <Text style={styles.switchDescription}>
          Vendor CCTV
        </Text>

        <TextInput
          value={vendor}
          editable={false}
          style={styles.input}
        />

        <Text style={styles.switchDescription}>
          URL RTSP contoh
        </Text>

        <TextInput
          value={suggestedUrl}
          editable={false}
          style={styles.input}
        />

        <Text style={styles.switchDescription}>
          Kamera ONVIF
        </Text>

        <Text style={styles.statusText}>
          {selectedCamera
            ? `Kamera: ${
                selectedCamera.name ||
                selectedCamera.host
              }`
            : "Belum memilih kamera ONVIF"}
        </Text>

        <Text style={styles.switchDescription}>
          Status Stream
        </Text>

        <Text style={styles.statusText}>
          {activeStream
            ? "Stream aktif"
            : "Stream belum aktif"}
        </Text>
      </View>

      {profile ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Media Profile
          </Text>

          <Text style={styles.statusText}>
            {profile.name ||
              profile.token ||
              "Profile ONVIF"}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );

  return (
    <SafeAreaView
      style={styles.safeArea}
    >
      <View style={styles.app}>
        <View style={styles.header}>
          <View
            style={styles.headerTitleWrap}
          >
            <View
              style={styles.marqueeClip}
              onLayout={(event) =>
                setMarqueeClipWidth(
                  event.nativeEvent
                    .layout.width,
                )
              }
            >
              <Animated.Text
                onLayout={(event) =>
                  setMarqueeTextWidth(
                    event.nativeEvent
                      .layout.width,
                  )
                }
                style={[
                  styles.appSubtitle,
                  {
                    transform: [
                      {
                        translateX:
                          marqueeX,
                      },
                    ],
                  },
                ]}
                numberOfLines={1}
              >
                {displayedOwner}
              </Animated.Text>
            </View>

            <Text
              style={styles.appTitle}
            >
              CCTV Universal Monitor
            </Text>

            <Text
              style={styles.appSubtitle}
            >
              ONVIF • RTSP • HTTP
            </Text>
          </View>

          {displayedLogo ? (
            <Image
              source={{
                uri: displayedLogo,
              }}
              style={styles.headerLogo}
              resizeMode="contain"
            />
          ) : null}

          <View
            style={styles.headerStatus}
          >
            <View
              style={[
                styles.headerStatusDot,
                playerConnected
                  ? styles.headerStatusOnline
                  : styles.headerStatusOffline,
              ]}
            />

            <Text
              style={
                styles.headerStatusText
              }
            >
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
            onPress={() => setActiveTab("live")}
          />

          <TabButton
            icon="📹"
            label="CCTV"
            active={activeTab === "cctv"}
            onPress={() => setActiveTab("cctv")}
          />

          <TabButton
            icon="🕘"
            label="Riwayat"
            active={activeTab === "history"}
            onPress={() => setActiveTab("history")}
          />

          <TabButton
            icon="⚙"
            label="Pengaturan"
            active={activeTab === "settings"}
            onPress={() => setActiveTab("settings")}
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
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#202a35",
    backgroundColor: "#111923",
  },

  headerTitleWrap: {
    flex: 1,
    minWidth: 0,
  },

  marqueeClip: {
    overflow: "hidden",
    width: "100%",
  },

  headerLogo: {
    width: 48,
    height: 48,
    marginHorizontal: 8,
  },

  headerStatus: {
    minWidth: 74,
    alignItems: "flex-end",
  },

  headerStatusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginBottom: 3,
  },

  headerStatusOnline: {
    backgroundColor: "#35d07f",
  },

  headerStatusOffline: {
    backgroundColor: "#667483",
  },

  headerStatusText: {
    color: "#dce5ee",
    fontSize: 11,
    fontWeight: "700",
  },

  appTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
    marginTop: 2,
  },

  appSubtitle: {
    color: "#91a4b8",
    fontSize: 11,
    fontWeight: "600",
  },

  topStatus: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: "#17212c",
    borderBottomWidth: 1,
    borderBottomColor: "#263442",
  },

  topStatusText: {
    color: "#b9c8d6",
    fontSize: 12,
    lineHeight: 17,
  },

  main: {
    flex: 1,
  },

  content: {
    flex: 1,
  },

  contentContainer: {
    padding: 14,
    paddingBottom: 24,
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },

  sectionTitle: {
    color: "#ffffff",
    fontSize: 21,
    fontWeight: "800",
  },

  sectionSubtitle: {
    color: "#91a4b8",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },

  card: {
    backgroundColor: "#111923",
    borderWidth: 1,
    borderColor: "#202a35",
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },

  cardTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 8,
  },

  statusText: {
    color: "#c5d1dc",
    fontSize: 13,
    lineHeight: 19,
  },

  endpointText: {
    color: "#7f93a7",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 5,
  },

  cameraMeta: {
    color: "#667483",
    fontSize: 11,
    marginTop: 6,
  },

  emptyBox: {
    backgroundColor: "#111923",
    borderWidth: 1,
    borderColor: "#202a35",
    borderRadius: 14,
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
  },

  emptyIcon: {
    fontSize: 38,
    marginBottom: 8,
  },

  emptyTitle: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 5,
  },

  centerText: {
    color: "#91a4b8",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },

  infoBox: {
    marginHorizontal: 14,
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#162330",
    borderWidth: 1,
    borderColor: "#26394a",
  },

  infoText: {
    color: "#c9d7e4",
    fontSize: 12,
    lineHeight: 18,
  },

  input: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#30404f",
    backgroundColor: "#0d151e",
    color: "#ffffff",
    paddingHorizontal: 12,
    marginTop: 7,
    marginBottom: 12,
  },
micButtonText: {
  fontSize: 19,
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

  layoutRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },

  layoutButton: {
    minWidth: 48,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#344352",
    backgroundColor: "#19232e",
  },

  layoutButtonActive: {
    borderColor: "#1976d2",
    backgroundColor: "#1976d2",
  },

  layoutButtonText: {
    color: "#dce5ed",
    fontSize: 13,
    fontWeight: "800",
  },

  layoutButtonTextActive: {
    color: "#fff",
  },
  layoutHint: {
    marginTop: 9,
    color: "#7f8b99",
    fontSize: 12,
  },

  cameraGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 6,
  },

  cameraSlot: {
    marginBottom: 2,
    minWidth: 0,
  },

  cameraSlotHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    paddingBottom: 5,
  },

  cameraSlotTitle: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
  },

  cameraSlotStatus: {
    color: "#8d99a8",
    fontSize: 9,
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
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },

  secondaryButton: {
    minHeight: 46,
    marginTop: 8,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#344352",
    backgroundColor: "#19232e",
  },

  secondaryButtonSmall: {
    minHeight: 40,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
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

    logoPreview: {
    width: 120,
    height: 80,
    marginTop: 12,
    borderRadius: 8,
    backgroundColor: "#111923",
  },
  logoEmptyPreview: {
    width: 120,
    height: 80,
    marginTop: 12,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2b3845",
    backgroundColor: "#0b1219",
  },
  logoEmptyText: {
    color: "#667483",
    fontSize: 11,
    textAlign: "center",
  },
  logoUriText: {
    marginTop: 7,
    color: "#617182",
    fontSize: 9,
    lineHeight: 13,
  },
  saveButton: {
    minHeight: 50,
    marginTop: 16,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    backgroundColor: "#16803c",
    borderWidth: 1,
    borderColor: "#2cbf62",
  },
  saveButtonSaved: {
    backgroundColor: "#145c31",
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
  },
  saveHint: {
    marginTop: 8,
    color: "#6f7d8b",
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
  },
  bottomTabs: {
    flexDirection: "row",
    minHeight: 66,
    borderTopWidth: 1,
    borderTopColor: "#202a35",
    backgroundColor: "#111923",
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 7,
  },
  tabActive: {
    backgroundColor: "#172433",
  },
  tabIcon: {
    fontSize: 18,
  },
  tabText: {
    marginTop: 3,
    color: "#7f8b99",
    fontSize: 10,
    fontWeight: "700",
  },
  tabTextActive: {
    color: "#fff",
  },
});
