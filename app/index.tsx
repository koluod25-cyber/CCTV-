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
  PanResponder,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
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
import {
  sendOnvifPtzCommand,
  type OnvifPtzCredentials,
  type PtzCommand,
  type PtzDirection,
} from "@/onvif-ptz";

type TabName = "live" | "cctv" | "history" | "settings";

type HistoryItem = {
  id: string;
  url: string;
  action: "connected" | "disconnected" | "error";
  message: string;
  time: string;
};

type CameraPtzConfig = {
  deviceServiceUrl: string;
  profileToken: string;
  credentials: OnvifPtzCredentials;
};

const MAX_CAMERAS = 9;

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
  zoom,
  onLoad,
  onError,
}: {
  url: string;
  nativeControls: boolean;
  muted: boolean;
  zoom: number;
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
        style={[
          styles.video,
          {
            transform: [
              {
                scale: zoom,
              },
            ],
          },
        ]}
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

function PtzSwipeControl({
  enabled,
  onMove,
  onStop,
}: {
  enabled: boolean;
  onMove: (direction: PtzDirection) => void;
  onStop: () => void;
}) {
  const startX = useRef(0);
  const startY = useRef(0);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () =>
          enabled,

        onMoveShouldSetPanResponder: () =>
          enabled,

        onPanResponderGrant: (event) => {
          startX.current =
            event.nativeEvent.pageX;

          startY.current =
            event.nativeEvent.pageY;
        },

        onPanResponderRelease: (event) => {
          if (!enabled) {
            return;
          }

          const dx =
            event.nativeEvent.pageX -
            startX.current;

          const dy =
            event.nativeEvent.pageY -
            startY.current;

          const distance =
            Math.sqrt(dx * dx + dy * dy);

          if (distance < 35) {
            onStop();
            return;
          }

          if (Math.abs(dx) > Math.abs(dy)) {
            onMove(
              dx > 0
                ? "right"
                : "left",
            );
          } else {
            onMove(
              dy > 0
                ? "down"
                : "up",
            );
          }

          onStop();
        },

        onPanResponderTerminate: () => {
          onStop();
        },

        onPanResponderTerminationRequest: () =>
          true,
      }),
    [enabled, onMove, onStop],
  );

  if (!enabled) {
    return null;
  }

  return (
    <View
      pointerEvents="box-only"
      style={styles.ptzSwipeOverlay}
      {...responder.panHandlers}
    >
      <View style={styles.ptzSwipeHint}>
        <Text style={styles.ptzSwipeHintText}>
          Geser layar untuk PTZ
        </Text>
      </View>
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

  const [manualUrl, setManualUrl] =
    useState(
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

  const [cameraZoom, setCameraZoom] =
    useState<number[]>([]);

  const [cameraControlsVisible, setCameraControlsVisible] =
    useState<boolean[]>([]);

  const [cameraPtzConfig, setCameraPtzConfig] =
    useState<Array<CameraPtzConfig | null>>([]);

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

  const [
    marqueeClipWidth,
    setMarqueeClipWidth,
  ] = useState(0);

  const [
    marqueeTextWidth,
    setMarqueeTextWidth,
  ] = useState(0);

  const {
    width: windowWidth,
    height: windowHeight,
  } = useWindowDimensions();

  const isLandscape =
    windowWidth > windowHeight;

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

    return () => {
      animation.stop();
    };
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
          index < MAX_CAMERAS &&
          !stream.trim(),
      );

    if (firstEmpty >= 0) {
      return firstEmpty;
    }

    return cameraStreams.length <
      MAX_CAMERAS
      ? cameraStreams.length
      : -1;
  };

  const setCameraZoomValue = (
    slot: number,
    value: number,
  ) => {
    const nextValue =
      Math.max(
        1,
        Math.min(2, value),
      );

    setCameraZoom((items) => {
      const next = [...items];

      next[slot] =
        Number(
          nextValue.toFixed(1),
        );

      return next;
    });
  };

  const setCameraStream = (
    slot: number,
    stream: string,
  ) => {
    setCameraStreams((items) => {
      const next = [...items];

      next[slot] = stream;

      return next;
    });

    setCameraConnected((items) => {
      const next = [...items];

      next[slot] = false;

      return next;
    });

    setCameraMuted((items) => {
      const next = [...items];

      next[slot] = false;

      return next;
    });

    setCameraZoom((items) => {
      const next = [...items];

      next[slot] = 1;

      return next;
    });

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
        current <
        requiredLayout
          ? requiredLayout
          : current,
    );
  };

  const setCameraSlotConnected = (
    slot: number,
    connected: boolean,
  ) => {
    setCameraConnected((items) => {
      const next = [...items];

      next[slot] =
        connected;

      return next;
    });

    setPlayerConnected(
      connected,
    );
  };
  const showCameraControls = (
    slot: number,
  ) => {
    const oldTimer =
      cameraControlsTimers.current[
        slot
      ];

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

  useEffect(() => {
    return () => {
      cameraControlsTimers.current.forEach(
        (timer) => {
          if (timer) {
            clearTimeout(timer);
          }
        },
      );
    };
  }, []);

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
          time:
            new Date().toLocaleTimeString(
              "id-ID",
            ),
        },
        ...items,
      ].slice(0, 100),
    );
  };

  const setCameraPtz = (
    slot: number,
    config: CameraPtzConfig | null,
  ) => {
    setCameraPtzConfig(
      (items) => {
        const next = [...items];

        next[slot] = config;

        return next;
      },
    );
  };

  const sendPtz = async (
    slot: number,
    command: PtzCommand,
  ) => {
    const config =
      cameraPtzConfig[slot];

    if (!config) {
      setStatusText(
        `PTZ Kamera ${
          slot + 1
        } belum tersedia.`,
      );
      return;
    }

    try {
      const result =
        await sendOnvifPtzCommand(
          config.deviceServiceUrl,
          config.profileToken,
          config.credentials,
          command,
        );

      setStatusText(
        `Kamera ${
          slot + 1
        }: ${result.message}`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Perintah PTZ gagal.";

      setStatusText(
        `PTZ Kamera ${
          slot + 1
        }: ${message}`,
      );

      addHistory(
        "error",
        cameraStreams[slot] ||
          activeStream,
        message,
      );
    }
  };

  const movePtz = (
    slot: number,
    direction: PtzDirection,
  ) => {
    void sendPtz(slot, {
      type: "move",
      direction,
      speed: 0.5,
    });
  };

  const stopPtz = (
    slot: number,
  ) => {
    void sendPtz(slot, {
      type: "stop",
    });
  };

  const zoomPtz = (
    slot: number,
    direction: "in" | "out",
  ) => {
    void sendPtz(slot, {
      type: "zoom",
      direction,
      speed: 0.4,
    });
  };

  const renderPtzControls = (
    slot: number,
  ) => {
    const enabled =
      Boolean(
        cameraPtzConfig[slot],
      );

    if (!enabled) {
      return (
        <View
          style={
            styles.ptzDisabledBox
          }
        >
          <Text
            style={
              styles.ptzDisabledText
            }
          >
            PTZ tidak tersedia untuk
            kamera ini
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.ptzPanel}>
        <View
          style={
            styles.ptzPanelHeader
          }
        >
          <Text
            style={
              styles.ptzPanelTitle
            }
          >
            Kontrol PTZ
          </Text>

          <Text
            style={
              styles.ptzPanelStatus
            }
          >
            ONVIF PTZ
          </Text>
        </View>

        <View
          style={styles.ptzPad}
        >
          <View
            style={
              styles.ptzRow
            }
          >
            <View
              style={
                styles.ptzSpacer
              }
            />

            <Pressable
              onPress={() =>
                movePtz(
                  slot,
                  "up",
                )
              }
              style={
                styles.ptzButton
              }
            >
              <Text
                style={
                  styles.ptzButtonText
                }
              >
                ▲
              </Text>
            </Pressable>

            <View
              style={
                styles.ptzSpacer
              }
            />
          </View>

          <View
            style={
              styles.ptzRow
            }
          >
            <Pressable
              onPress={() =>
                movePtz(
                  slot,
                  "left",
                )
              }
              style={
                styles.ptzButton
              }
            >
              <Text
                style={
                  styles.ptzButtonText
                }
              >
                ◀
              </Text>
            </Pressable>

            <Pressable
              onPress={() =>
                stopPtz(slot)
              }
              style={
                styles.ptzStopButton
              }
            >
              <Text
                style={
                  styles.ptzStopText
                }
              >
                ■
              </Text>
            </Pressable>

            <Pressable
              onPress={() =>
                movePtz(
                  slot,
                  "right",
                )
              }
              style={
                styles.ptzButton
              }
            >
              <Text
                style={
                  styles.ptzButtonText
                }
              >
                ▶
              </Text>
            </Pressable>
          </View>

          <View
            style={
              styles.ptzRow
            }
          >
            <View
              style={
                styles.ptzSpacer
              }
            />

            <Pressable
              onPress={() =>
                movePtz(
                  slot,
                  "down",
                )
              }
              style={
                styles.ptzButton
              }
            >
              <Text
                style={
                  styles.ptzButtonText
                }
              >
                ▼
              </Text>
            </Pressable>

            <View
              style={
                styles.ptzSpacer
              }
            />
          </View>
        </View>

        <View
          style={
            styles.ptzZoomRow
          }
        >
          <Pressable
            onPress={() =>
              zoomPtz(
                slot,
                "out",
              )
            }
            style={
              styles.ptzZoomButton
            }
          >
            <Text
              style={
                styles.ptzZoomText
              }
            >
              − Zoom
            </Text>
          </Pressable>

          <Pressable
            onPress={() =>
              stopPtz(slot)
            }
            style={
              styles.ptzZoomButton
            }
          >
            <Text
              style={
                styles.ptzZoomText
              }
            >
              Stop
            </Text>
          </Pressable>

          <Pressable
            onPress={() =>
              zoomPtz(
                slot,
                "in",
              )
            }
            style={
              styles.ptzZoomButton
            }
          >
            <Text
              style={
                styles.ptzZoomText
              }
            >
              + Zoom
            </Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const pickLogoFromGallery =
    async () => {
      try {
        const permission =
          await ImagePicker
            .requestMediaLibraryPermissionsAsync();

        if (!permission.granted) {
          Alert.alert(
            "Izin galeri diperlukan",
            "Izinkan aplikasi mengakses galeri HP untuk memilih logo.",
          );

          return;
        }

        const result =
          await ImagePicker
            .launchImageLibraryAsync(
              {
                mediaTypes: [
                  "images",
                ],
                allowsEditing:
                  true,
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

          setSettingsSaved(
            false,
          );

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

  const searchCameras = async () => {
    if (searching) {
      return;
    }

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

  const connectOnvif = async (
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
          (
            camera.xaddrs ??
            []
          ).filter((item) =>
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

    const credentials: OnvifPtzCredentials =
      {
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
          `Mencoba endpoint ONVIF ${
            index + 1
          }/${endpoints.length}...`,
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

            setCameraPtz(
              slot,
              result.profile?.token
                ? {
                    deviceServiceUrl:
                      endpoint,
                    profileToken:
                      result.profile
                        .token,
                    credentials,
                  }
                : null,
            );

            setTesting(true);

            setStatusText(
              `Kamera ${
                slot + 1
              }: URI RTSP berhasil diperoleh. Membuka video...`,
            );

            setActiveTab(
              "live",
            );

            addHistory(
              "connected",
              endpoint,
              `Kamera ${
                slot + 1
              }: Media Profile ONVIF dan URI RTSP berhasil diperoleh.`,
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
    setCameraPtz(
      slot,
      null,
    );

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
      `Membuka Kamera ${
        slot + 1
      }...`,
    );

    setActiveTab("live");
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
        setCameraPtz(
          slot,
          null,
        );

        setPlayerConnected(
          false,
        );

        setCameraStream(
          slot,
          target,
        );

        setActiveStream(
          target,
        );

        setStatusText(
          `Menguji Kamera ${
            slot + 1
          } melalui native player...`,
        );

        setActiveTab(
          "live",
        );

        return;
      }

      setTesting(true);

      try {
        const camera:
          CameraNetworkConfig =
          {
            id:
              "manual-camera",
            name:
              "Camera manual",
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
    setPlayerConnected(
      false,
    );

    setCameraStreams([]);
    setCameraConnected([]);
    setCameraMuted([]);
    setCameraZoom([]);
    setCameraControlsVisible(
      [],
    );
    setCameraPtzConfig([]);

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
      contentContainerStyle={
        styles.contentContainer
      }
    >
      <View style={styles.card}>
        <Text
          style={styles.cardTitle}
        >
          Tata Letak Kamera
        </Text>

        <View
          style={styles.layoutRow}
        >
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
          Pilih 1, 2, 4, 6 atau 9
          tampilan kamera.
        </Text>
      </View>

      {cameraStreams.some(
        (stream) =>
          Boolean(
            stream?.trim(),
          ),
      ) ? (
        <View
          style={[
            styles.cameraGrid,
            isLandscape &&
              styles.cameraGridLandscape,
          ]}
        >
          {Array.from({
            length: cameraCount,
          }).map((_, index) => {
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

            const zoom =
              cameraZoom[
                index
              ] ?? 1;

            const widthStyle =
              cameraCount === 1
                ? "100%"
                : cameraCount === 2
                  ? isLandscape
                    ? "49%"
                    : "100%"
                  : cameraCount === 4
                    ? "48%"
                    : cameraCount === 6
                      ? "32%"
                      : "32%";

            return (
              <View
                key={index}
                style={[
                  styles.cameraSlot,
                  {
                    width:
                      widthStyle,
                  },
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
                    {stream
                      ? connected
                        ? "LIVE"
                        : "MEMBUKA..."
                      : "KOSONG"}
                  </Text>
                </View>

                {stream ? (
                  <>
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
                      zoom={zoom}
                      onLoad={() => {
                        setCameraSlotConnected(
                          index,
                          true,
                        );

                        setTesting(
                          false,
                        );

                        setStatusText(
                          `Kamera ${
                            index + 1
                          } LIVE.`,
                        );
                      }}
                      onError={(
                        message,
                      ) => {
                        setCameraSlotConnected(
                          index,
                          false,
                        );

                        setTesting(
                          false,
                        );

                        setStatusText(
                          `OFFLINE • Kamera ${
                            index + 1
                          }: ${message}`,
                        );

                        addHistory(
                          "error",
                          stream,
                          message,
                        );
                      }}
                    />

                    <PtzSwipeControl
                      enabled={Boolean(
                        cameraPtzConfig[
                          index
                        ],
                      )}
                      onMove={(
                        direction,
                      ) => {
                        movePtz(
                          index,
                          direction,
                        );
                      }}
                      onStop={() =>
                        stopPtz(
                          index,
                        )
                      }
                    />

                    {cameraControlsVisible[
                      index
                    ] ? (
                      <View
                        style={
                          styles.cameraControlsOverlay
                        }
                      >
                        <Pressable
                          onPress={() =>
                            setCameraZoomValue(
                              index,
                              zoom - 0.1,
                            )
                          }
                          style={
                            styles.micButton
                          }
                        >
                          <Text
                            style={
                              styles.micButtonText
                            }
                          >
                            −
                          </Text>
                        </Pressable>

                        <View
                          style={
                            styles.zoomLabel
                          }
                        >
                          <Text
                            style={
                              styles.zoomLabelText
                            }
                          >
                            {Math.round(
                              zoom * 100,
                            )}
                            %
                          </Text>
                        </View>

                        <Pressable
                          onPress={() =>
                            setCameraZoomValue(
                              index,
                              zoom + 0.1,
                            )
                          }
                          style={
                            styles.micButton
                          }
                        >
                          <Text
                            style={
                              styles.micButtonText
                            }
                          >
                            +
                          </Text>
                        </Pressable>

                        <Pressable
                          onPress={() => {
                            setCameraMuted(
                              (items) => {
                                const next =
                                  [...items];

                                next[
                                  index
                                ] =
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

                    {renderPtzControls(
                      index,
                    )}
                  </>
                ) : (
                  <View
                    style={
                      styles.emptyCameraSlot
                    }
                  >
                    <Text
                      style={
                        styles.emptySlotIcon
                      }
                    >
                      📹
                    </Text>

                    <Text
                      style={
                        styles.emptySlotText
                      }
                    >
                      Kamera {index + 1}
                    </Text>

                    <Text
                      style={
                        styles.emptySlotHint
                      }
                    >
                      Belum terhubung
                    </Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ) : (
        <View
          style={styles.emptyLiveArea}
        >
          <Text
            style={styles.bigIcon}
          >
            📹
          </Text>

          <Text
            style={styles.emptyTitle}
          >
            Belum ada kamera aktif
          </Text>

          <Text
            style={styles.centerText}
          >
            Hubungkan kamera dari
            menu CCTV atau masukkan
            URL RTSP.
          </Text>
        </View>
      )}

      <View style={styles.card}>
        <Text
          style={styles.cardTitle}
        >
          Koneksi Manual
        </Text>

        <Text
          style={styles.fieldLabel}
        >
          URL CCTV
        </Text>

        <TextInput
          value={manualUrl}
          onChangeText={
            setManualUrl
          }
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="rtsp://..."
          placeholderTextColor="#667483"
          style={styles.input}
        />

        <View
          style={styles.buttonRow}
        >
          <Pressable
            style={[
              styles.primaryButton,
              styles.flexButton,
            ]}
            onPress={
              connectManual
            }
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
            onPress={
              testConnection
            }
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
            cameraStreams.length ===
              0
          }
        >
          <Text
            style={[
              styles.secondaryButtonText,
              !activeStream &&
                cameraStreams.length ===
                  0 &&
                styles.disabledText,
            ]}
          >
            ■ Putuskan Semua
            Kamera
          </Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text
          style={styles.cardTitle}
        >
          Kontrol Video
        </Text>

        <View
          style={styles.switchRow}
        >
          <View
            style={
              styles.switchTextWrap
            }
          >
            <Text
              style={
                styles.switchTitle
              }
            >
              Kontrol video
            </Text>

            <Text
              style={
                styles.switchDescription
              }
            >
              Tampilkan kontrol bawaan
              pemutar video.
            </Text>
          </View>

          <Switch
            value={
              nativeControls
            }
            onValueChange={
              setNativeControls
            }
          />
        </View>

        <View
          style={styles.switchRow}
        >
          <View
            style={
              styles.switchTextWrap
            }
          >
            <Text
              style={
                styles.switchTitle
              }
            >
              Suara CCTV
            </Text>

            <Text
              style={
                styles.switchDescription
              }
            >
              Aktifkan atau matikan
              suara kamera.
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
  const renderCctv = () => (
    <ScrollView
      style={styles.content}
      contentContainerStyle={
        styles.contentContainer
      }
    >
      <View
        style={styles.sectionHeader}
      >
        <View
          style={
            styles.sectionHeaderText
          }
        >
          <Text
            style={styles.sectionTitle}
          >
            CCTV
          </Text>

          <Text
            style={
              styles.sectionSubtitle
            }
          >
            Cari kamera ONVIF di
            jaringan lokal.
          </Text>
        </View>

        <Pressable
          style={
            styles.primaryButtonSmall
          }
          onPress={
            searchCameras
          }
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
        <Text
          style={styles.cardTitle}
        >
          Kamera Ditemukan
        </Text>

        {searching ? (
          <View
            style={
              styles.loadingBox
            }
          >
            <ActivityIndicator
              size="large"
            />

            <Text
              style={
                styles.loadingText
              }
            >
              Mencari kamera CCTV...
            </Text>
          </View>
        ) : cameras.length ===
          0 ? (
          <View
            style={
              styles.emptyBox
            }
          >
            <Text
              style={
                styles.emptyIcon
              }
            >
              📷
            </Text>

            <Text
              style={
                styles.emptyTitle
              }
            >
              Belum ada kamera
            </Text>

            <Text
              style={
                styles.centerText
              }
            >
              Tekan "Cari CCTV"
              untuk mencari kamera
              ONVIF.
            </Text>
          </View>
        ) : (
          cameras.map(
            (camera) => {
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
                    camera.id ||
                    key
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
                          numberOfLines={
                            1
                          }
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
                      connecting ===
                      key
                    }
                  >
                    {connecting ===
                    key ? (
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
                        Hubungkan ke
                        Slot Berikutnya
                      </Text>
                    )}
                  </Pressable>
                </View>
              );
            },
          )
        )}
      </View>

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

  const renderHistory = () => (
    <ScrollView
      style={styles.content}
      contentContainerStyle={
        styles.contentContainer
      }
    >
      <View
        style={styles.sectionHeader}
      >
        <View>
          <Text
            style={styles.sectionTitle}
          >
            Riwayat
          </Text>

          <Text
            style={
              styles.sectionSubtitle
            }
          >
            Riwayat koneksi dan
            aktivitas CCTV.
          </Text>
        </View>

        <Pressable
          style={
            styles.secondaryButton
          }
          onPress={() =>
            setHistory([])
          }
          disabled={
            !history.length
          }
        >
          <Text
            style={[
              styles.secondaryButtonText,
              !history.length &&
                styles.disabledText,
            ]}
          >
            Hapus Riwayat
          </Text>
        </Pressable>
      </View>

      {!history.length ? (
        <View
          style={
            styles.emptyBox
          }
        >
          <Text
            style={
              styles.emptyIcon
            }
          >
            🕘
          </Text>

          <Text
            style={
              styles.emptyTitle
            }
          >
            Belum ada riwayat
          </Text>

          <Text
            style={
              styles.centerText
            }
          >
            Aktivitas koneksi CCTV
            akan tampil di sini.
          </Text>
        </View>
      ) : (
        history.map(
          (item) => (
            <View
              key={item.id}
              style={styles.card}
            >
              <Text
                style={
                  styles.cardTitle
                }
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
                style={
                  styles.statusText
                }
              >
                {item.message}
              </Text>

              <Text
                style={
                  styles.endpointText
                }
              >
                {item.url}
              </Text>

              <Text
                style={
                  styles.cameraMeta
                }
              >
                {item.time}
              </Text>
            </View>
          ),
        )
      )}
    </ScrollView>
  );

  const renderSettings = () => (
    <ScrollView
      style={styles.content}
      contentContainerStyle={
        styles.contentContainer
      }
    >
      <View
        style={styles.sectionHeader}
      >
        <View>
          <Text
            style={styles.sectionTitle}
          >
            Pengaturan
          </Text>

          <Text
            style={
              styles.sectionSubtitle
            }
          >
            Atur identitas, logo,
            koneksi, dan kontrol
            video.
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text
          style={styles.cardTitle}
        >
          Identitas Pemilik
        </Text>

        <Text
          style={
            styles.switchDescription
          }
        >
          Teks identitas pemilik
          yang berjalan di header.
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

        <Text
          style={styles.cardTitle}
        >
          Logo Header
        </Text>

        <Text
          style={
            styles.logoHelpText
          }
        >
          Pilih logo dari galeri HP.
          Logo akan tampil di sudut
          kanan atas header.
        </Text>

        <View
          style={
            styles.logoActionRow
          }
        >
          <Pressable
            onPress={
              pickLogoFromGallery
            }
            style={[
              styles.primaryButtonSmall,
              styles.flexButton,
            ]}
          >
            <Text
              style={
                styles.primaryButtonText
              }
            >
              Pilih / Ganti Logo
            </Text>
          </Pressable>

          {logoUri.trim() ? (
            <Pressable
              onPress={
                clearLogo
              }
              style={
                styles.secondaryButtonSmall
              }
            >
              <Text
                style={
                  styles.secondaryButtonText
                }
              >
                Hapus
              </Text>
            </Pressable>
          ) : null}
        </View>

        {logoUri.trim() ? (
          <Image
            source={{
              uri: logoUri.trim(),
            }}
            style={
              styles.logoPreview
            }
            resizeMode="contain"
          />
        ) : (
          <View
            style={
              styles.logoEmptyPreview
            }
          >
            <Text
              style={
                styles.logoEmptyText
              }
            >
              Belum ada logo dipilih
            </Text>
          </View>
        )}

        <Text
          style={
            styles.logoUriText
          }
          numberOfLines={2}
        >
          {logoUri.trim() ||
            "Logo belum dipilih dari galeri."}
        </Text>

        <Pressable
          onPress={
            saveSettings
          }
          style={[
            styles.saveButton,
            settingsSaved &&
              styles.saveButtonSaved,
          ]}
        >
          <Text
            style={
              styles.saveButtonText
            }
          >
            {settingsSaved
              ? "✓ Pengaturan Tersimpan"
              : "💾 Simpan Pengaturan"}
          </Text>
        </Pressable>

        <Text
          style={
            styles.saveHint
          }
        >
          Tekan tombol ini setelah
          mengganti logo atau
          identitas pemilik.
        </Text>
      </View>

      <View style={styles.card}>
        <Text
          style={styles.cardTitle}
        >
          Kontrol Video
        </Text>

        <View
          style={styles.switchRow}
        >
          <View
            style={
              styles.switchTextWrap
            }
          >
            <Text
              style={
                styles.switchTitle
              }
            >
              Kontrol video
            </Text>

            <Text
              style={
                styles.switchDescription
              }
            >
              Tampilkan kontrol bawaan
              pemutar video.
            </Text>
          </View>

          <Switch
            value={
              nativeControls
            }
            onValueChange={
              setNativeControls
            }
          />
        </View>

        <View
          style={styles.switchRow}
        >
          <View
            style={
              styles.switchTextWrap
            }
          >
            <Text
              style={
                styles.switchTitle
              }
            >
              Suara CCTV
            </Text>

            <Text
              style={
                styles.switchDescription
              }
            >
              Aktifkan atau matikan
              suara kamera.
            </Text>
          </View>

          <Switch
            value={!muted}
            onValueChange={(value) =>
              setMuted(!value)
            }
          />
        </View>

        <View
          style={styles.switchRow}
        >
          <View
            style={
              styles.switchTextWrap
            }
          >
            <Text
              style={
                styles.switchTitle
              }
            >
              Informasi status
            </Text>

            <Text
              style={
                styles.switchDescription
              }
            >
              Tampilkan informasi
              status di bagian atas.
            </Text>
          </View>

          <Switch
            value={showInfo}
            onValueChange={
              setShowInfo
            }
          />
        </View>
      </View>

      <View style={styles.card}>
        <Text
          style={styles.cardTitle}
        >
          Koneksi Kamera
        </Text>

        <Text
          style={
            styles.switchDescription
          }
        >
          Vendor CCTV
        </Text>

        <TextInput
          value={vendor}
          editable={false}
          style={styles.input}
        />

        <Text
          style={
            styles.switchDescription
          }
        >
          URL RTSP contoh
        </Text>

        <TextInput
          value={suggestedUrl}
          editable={false}
          style={styles.input}
        />

        <Text
          style={
            styles.switchDescription
          }
        >
          Kamera ONVIF
        </Text>

        <Text
          style={
            styles.statusText
          }
        >
          {selectedCamera
            ? `Kamera: ${
                selectedCamera.name ||
                selectedCamera.host
              }`
            : "Belum memilih kamera ONVIF"}
        </Text>

        <Text
          style={
            styles.switchDescription
          }
        >
          Status Stream
        </Text>

        <Text
          style={
            styles.statusText
          }
        >
          {activeStream
            ? "Stream aktif"
            : "Stream belum aktif"}
        </Text>
      </View>

      {profile ? (
        <View style={styles.card}>
          <Text
            style={
              styles.cardTitle
            }
          >
            Media Profile
          </Text>

          <Text
            style={
              styles.statusText
            }
          >
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
            style={
              styles.headerTitleWrap
            }
          >
            <View
              style={
                styles.marqueeClip
              }
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
              style={
                styles.headerLogo
              }
              resizeMode="contain"
            />
          ) : null}

          <View
            style={
              styles.headerStatus
            }
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

        {showInfo &&
        statusText ? (
          <View
            style={
              styles.topStatus
            }
          >
            <Text
              style={
                styles.topStatusText
              }
              numberOfLines={2}
            >
              {statusText}
            </Text>
          </View>
        ) : null}

        <View
          style={styles.main}
        >
          {activeTab ===
          "live"
            ? renderLive()
            : activeTab ===
                "cctv"
              ? renderCctv()
              : activeTab ===
                  "history"
                ? renderHistory()
                : renderSettings()}
        </View>

        <View
          style={
            styles.bottomTabs
          }
        >
          <TabButton
            icon="▶"
            label="Live CCTV"
            active={
              activeTab ===
              "live"
            }
            onPress={() =>
              setActiveTab(
                "live",
              )
            }
          />

                    <TabButton
            icon="📹"
            label="CCTV"
            active={activeTab === "cctv"}
            onPress={() => setActiveTab("cctv")}
          />

          <TabButton
            icon="📜"
            label="Riwayat"
            active={activeTab === "history"}
            onPress={() => setActiveTab("history")}
          />

          <TabButton
            icon="⚙️"
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
    backgroundColor: "#07111f",
  },

  container: {
    flex: 1,
    backgroundColor: "#07111f",
  },

  header: {
    minHeight: 72,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#0b1728",
    borderBottomWidth: 1,
    borderBottomColor: "#1d3047",
    flexDirection: "row",
    alignItems: "center",
  },

  headerLogoBox: {
    width: 48,
    height: 48,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#13243a",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },

  headerLogo: {
    width: 44,
    height: 44,
    resizeMode: "contain",
  },

  headerLogoEmpty: {
    fontSize: 23,
  },

  headerCenter: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },

  appTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "800",
  },

  ownerMarqueeBox: {
    height: 22,
    overflow: "hidden",
    marginTop: 2,
  },

  ownerMarqueeContent: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: "100%",
  },

  ownerMarqueeText: {
    color: "#8fa6bd",
    fontSize: 12,
    fontWeight: "600",
  },

  headerStatus: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: "#12253b",
  },

  headerStatusText: {
    color: "#83a6c7",
    fontSize: 10,
    fontWeight: "800",
  },

  scroll: {
    flex: 1,
  },

  content: {
    padding: 12,
    paddingBottom: 90,
  },

  sectionTitle: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 10,
  },

  sectionSubtitle: {
    color: "#8095aa",
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
  },

  card: {
    backgroundColor: "#0d1b2c",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1b3048",
    padding: 12,
    marginBottom: 12,
  },

  cameraGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -4,
  },

  cameraCell: {
    padding: 4,
  },

  cameraCell1: {
    width: "100%",
  },

  cameraCell2: {
    width: "50%",
  },

  cameraCell4: {
    width: "50%",
  },

  cameraCell6: {
    width: "33.3333%",
  },

  cameraCell9: {
    width: "33.3333%",
  },

  videoBox: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#02070d",
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#1b2e44",
  },

  video: {
    width: "100%",
    height: "100%",
    backgroundColor: "#000000",
  },

  emptyVideo: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },

  emptyBox: {
    flex: 1,
    minHeight: 150,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#02070d",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#1b2e44",
    padding: 15,
  },

  emptyIcon: {
    fontSize: 30,
    marginBottom: 7,
  },

  emptyTitle: {
    color: "#dce8f3",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },

  emptyText: {
    color: "#71869a",
    fontSize: 11,
    textAlign: "center",
    marginTop: 5,
    lineHeight: 16,
  },

  cameraOverlay: {
    position: "absolute",
    left: 7,
    right: 7,
    top: 7,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  cameraNameBadge: {
    backgroundColor: "rgba(0,0,0,0.72)",
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 6,
  },

  cameraNameText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "800",
  },

  liveBadge: {
    backgroundColor: "rgba(16, 117, 67, 0.9)",
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 6,
  },

  liveBadgeText: {
    color: "#ffffff",
    fontSize: 9,
    fontWeight: "900",
  },

  offlineBadge: {
    backgroundColor: "rgba(130, 35, 35, 0.9)",
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 6,
  },

  offlineBadgeText: {
    color: "#ffffff",
    fontSize: 9,
    fontWeight: "900",
  },

  cameraBottomBar: {
    position: "absolute",
    left: 6,
    right: 6,
    bottom: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  cameraControlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },

  smallControlButton: {
    minWidth: 30,
    height: 30,
    paddingHorizontal: 7,
    borderRadius: 7,
    backgroundColor: "rgba(0,0,0,0.76)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },

  smallControlText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
  },

  cameraLabel: {
    color: "#dce8f3",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 7,
  },

  cameraUrl: {
    color: "#657b90",
    fontSize: 9,
    marginTop: 2,
  },

  ptzCard: {
    marginTop: 10,
    backgroundColor: "#091522",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1a3047",
    padding: 10,
  },

  ptzTitle: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 8,
  },

  ptzPad: {
    alignItems: "center",
    justifyContent: "center",
  },

  ptzRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },

  ptzButton: {
    width: 44,
    height: 40,
    margin: 3,
    borderRadius: 9,
    backgroundColor: "#13263b",
    borderWidth: 1,
    borderColor: "#27435e",
    alignItems: "center",
    justifyContent: "center",
  },

  ptzButtonActive: {
    backgroundColor: "#1e4260",
  },

  ptzButtonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "900",
  },

  ptzStopButton: {
    width: 48,
    height: 40,
    margin: 3,
    borderRadius: 9,
    backgroundColor: "#552b2b",
    borderWidth: 1,
    borderColor: "#7c3d3d",
    alignItems: "center",
    justifyContent: "center",
  },

  ptzStopText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "900",
  },

  zoomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },

  zoomButton: {
    minWidth: 48,
    height: 34,
    marginHorizontal: 4,
    borderRadius: 8,
    backgroundColor: "#14283d",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#28445e",
  },

  zoomButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
  },

  zoomValue: {
    minWidth: 70,
    textAlign: "center",
    color: "#91a8bc",
    fontSize: 11,
    fontWeight: "700",
  },

  gestureHint: {
    color: "#60768a",
    fontSize: 9,
    textAlign: "center",
    marginTop: 7,
  },

  layoutRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginBottom: 10,
  },

  layoutButton: {
    minWidth: 45,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "#122338",
    borderWidth: 1,
    borderColor: "#203b55",
    alignItems: "center",
    justifyContent: "center",
  },

  layoutButtonActive: {
    backgroundColor: "#1e4869",
    borderColor: "#3d7298",
  },

  layoutButtonText: {
    color: "#9aafc1",
    fontSize: 11,
    fontWeight: "800",
  },

  layoutButtonTextActive: {
    color: "#ffffff",
  },

  fieldLabel: {
    color: "#a8bacb",
    fontSize: 11,
    fontWeight: "800",
    marginBottom: 6,
  },

  input: {
    minHeight: 42,
    backgroundColor: "#07111d",
    borderWidth: 1,
    borderColor: "#20364d",
    borderRadius: 9,
    paddingHorizontal: 11,
    color: "#ffffff",
    fontSize: 13,
    marginBottom: 9,
  },

  multilineInput: {
    minHeight: 80,
    paddingTop: 10,
    textAlignVertical: "top",
  },

  buttonRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },

  primaryButton: {
    minHeight: 42,
    paddingHorizontal: 15,
    borderRadius: 9,
    backgroundColor: "#1c587f",
    alignItems: "center",
    justifyContent: "center",
  },

    primaryButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
  },

  secondaryButton: {
    minHeight: 42,
    paddingHorizontal: 15,
    borderRadius: 9,
    backgroundColor: "#13253a",
    borderWidth: 1,
    borderColor: "#29425a",
    alignItems: "center",
    justifyContent: "center",
  },

  secondaryButtonText: {
    color: "#b5c7d7",
    fontSize: 12,
    fontWeight: "800",
  },

  dangerButton: {
    minHeight: 42,
    paddingHorizontal: 15,
    borderRadius: 9,
    backgroundColor: "#552b2b",
    borderWidth: 1,
    borderColor: "#754040",
    alignItems: "center",
    justifyContent: "center",
  },

  dangerButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
  },

  disabledButton: {
    opacity: 0.45,
  },

  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },

  loadingText: {
    color: "#8da3b7",
    fontSize: 11,
    marginLeft: 8,
  },

  statusBox: {
    padding: 10,
    borderRadius: 9,
    backgroundColor: "#091827",
    borderWidth: 1,
    borderColor: "#1b334a",
    marginTop: 8,
  },

  statusText: {
    color: "#9db2c5",
    fontSize: 11,
    lineHeight: 17,
  },

  successText: {
    color: "#77c99b",
  },

  errorText: {
    color: "#ef8d8d",
  },

  infoText: {
    color: "#82b6df",
  },

  cameraList: {
    marginTop: 8,
  },

  discoveredCamera: {
    padding: 10,
    borderRadius: 9,
    backgroundColor: "#091827",
    borderWidth: 1,
    borderColor: "#1b334a",
    marginBottom: 7,
  },

  discoveredTitle: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
  },

  discoveredAddress: {
    color: "#73899d",
    fontSize: 10,
    marginTop: 3,
  },

  discoveredButton: {
    alignSelf: "flex-start",
    marginTop: 8,
    paddingHorizontal: 11,
    minHeight: 32,
    borderRadius: 7,
    backgroundColor: "#173653",
    alignItems: "center",
    justifyContent: "center",
  },

  discoveredButtonText: {
    color: "#c8d9e7",
    fontSize: 10,
    fontWeight: "800",
  },

  historyItem: {
    padding: 11,
    borderRadius: 10,
    backgroundColor: "#091827",
    borderWidth: 1,
    borderColor: "#1b334a",
    marginBottom: 8,
  },

  historyTitle: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
  },

  historyDetail: {
    color: "#7890a5",
    fontSize: 10,
    lineHeight: 16,
    marginTop: 4,
  },

  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 45,
    borderBottomWidth: 1,
    borderBottomColor: "#152a40",
  },

  settingLabel: {
    color: "#d3e0eb",
    fontSize: 12,
    fontWeight: "700",
    flex: 1,
    paddingRight: 10,
  },

  settingValue: {
    color: "#7f96aa",
    fontSize: 11,
  },

  logoPreviewBox: {
    width: 86,
    height: 86,
    borderRadius: 12,
    backgroundColor: "#07111d",
    borderWidth: 1,
    borderColor: "#223b53",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: 10,
  },

  logoPreview: {
    width: 80,
    height: 80,
    resizeMode: "contain",
  },

  logoPlaceholder: {
    color: "#62788c",
    fontSize: 10,
    textAlign: "center",
  },

  saveButton: {
    minHeight: 44,
    borderRadius: 9,
    backgroundColor: "#216448",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },

  saveButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
  },

  saveHint: {
    marginTop: 8,
    color: "#6f7d8b",
    fontSize: 11,
    lineHeight: 16,
  },

  bottomTabs: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 66,
    backgroundColor: "#0b1728",
    borderTopWidth: 1,
    borderTopColor: "#1d3047",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 5,
    paddingBottom: 4,
  },

  tabButton: {
    flex: 1,
    minHeight: 58,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    marginHorizontal: 2,
  },

  tabButtonActive: {
    backgroundColor: "#132b43",
  },

  tabIcon: {
    fontSize: 18,
    marginBottom: 2,
  },

  tabLabel: {
    color: "#6f8599",
    fontSize: 9,
    fontWeight: "800",
  },

  tabLabelActive: {
    color: "#ffffff",
  },

  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },

      centeredText: {
    color: "#8297aa",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
  },

  // ===== STYLE TAMBAHAN PTZ =====
  ptzSwipeOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 10,
  },

  ptzSwipeHint: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 7,
    backgroundColor: "rgba(0,0,0,0.58)",
  },

  ptzSwipeHintText: {
    color: "#d7e4ef",
    fontSize: 9,
    fontWeight: "700",
  },

  ptzDisabledBox: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#0a1522",
    borderWidth: 1,
    borderColor: "#26384a",
    alignItems: "center",
    justifyContent: "center",
  },

  ptzDisabledText: {
    color: "#71869a",
    fontSize: 11,
    textAlign: "center",
    lineHeight: 16,
  },

  ptzPanel: {
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "#091522",
    borderWidth: 1,
    borderColor: "#1a3047",
  },

  ptzPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },

  ptzPanelTitle: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },

  ptzPanelStatus: {
    color: "#7790a5",
    fontSize: 10,
  },

  ptzSpacer: {
    width: 44,
    height: 40,
    margin: 3,
  },

  ptzZoomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },

  ptzZoomButton: {
    minWidth: 52,
    height: 36,
    marginHorizontal: 4,
    borderRadius: 8,
    backgroundColor: "#14283d",
    borderWidth: 1,
    borderColor: "#28445e",
    alignItems: "center",
    justifyContent: "center",
  },

  ptzZoomText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },

  // ===== STYLE TAB ALIAS =====
  tab: {
    flex: 1,
    minHeight: 58,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    marginHorizontal: 2,
  },

  tabActive: {
    backgroundColor: "#132b43",
  },

  tabText: {
    color: "#6f8599",
    fontSize: 9,
    fontWeight: "800",
  },

  tabTextActive: {
    color: "#ffffff",
  },

  // ===== STYLE GRID CAMERA =====
  contentContainer: {
    padding: 12,
    paddingBottom: 90,
  },

  bigIcon: {
    fontSize: 34,
    marginBottom: 8,
  },

  centerText: {
    color: "#8297aa",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
  },

  cardTitle: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 8,
  },

  layoutHint: {
    color: "#6f8599",
    fontSize: 10,
    lineHeight: 15,
    marginTop: 4,
  },

  cameraGridLandscape: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -4,
  },

  cameraSlot: {
    width: "100%",
    backgroundColor: "#0d1b2c",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1b3048",
    padding: 8,
    marginBottom: 8,
  },

  cameraSlotHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },

  cameraSlotTitle: {
    flex: 1,
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
  },

  cameraSlotStatus: {
    color: "#77c99b",
    fontSize: 9,
    fontWeight: "800",
  },

  // ===== STYLE LIVE / OVERLAY =====
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    padding: 15,
  },

  overlayTitle: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 5,
  },

  overlayText: {
    color: "#9db2c5",
    fontSize: 10,
    lineHeight: 15,
    textAlign: "center",
  },

  errorIcon: {
    fontSize: 28,
    marginBottom: 8,
  },

  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#52d38a",
    marginRight: 5,
  },

  liveText: {
    color: "#77c99b",
    fontSize: 10,
    fontWeight: "800",
  },

  // ===== STYLE CAMERA CONTROLS =====
  cameraControlsOverlay: {
    position: "absolute",
    left: 7,
    right: 7,
    bottom: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 5,
  },

  micButton: {
    minWidth: 34,
    height: 32,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.75)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },

  micButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },

  zoomLabel: {
    height: 32,
    minWidth: 55,
    paddingHorizontal: 7,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.75)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },

  zoomLabelText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "800",
  },
});


  
