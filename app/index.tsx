import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import OnvifPlaybackPanel from "@/onvif-playback-panel";

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
  type DimensionValue,
} from "react-native";

import Video from "react-native-video";

import * as ImagePicker from "expo-image-picker";

import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  CCTV_VENDORS,
  makeRtspUrl,
} from "@/cctv";

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

type TabName =
  | "live"
  | "cctv"
  | "playback"
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

type CameraPtzConfig = {
  deviceServiceUrl: string;
  profileToken: string;
  credentials: OnvifPtzCredentials;
};

const MAX_CAMERAS = 9;

function isCameraUrl(value: string) {
  return /^(rtsp|rtsps|http|https):\/\/\S+$/i.test(
    value.trim(),
  );
}

const CAMERA_STORAGE_KEY =
  "@cctv_universal_monitor/cameras_v2";

type SavedCameraState = {
  cameraCount: number;
  cameraStreams: string[];
  cameraIds: string[];
  cameraPtzConfig: Array<CameraPtzConfig | null>;
  ownerText: string;
  logoUri: string;
};

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
  const trimmed = value.trim();

  if (!username && !password) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);

    if (username) {
      url.username = username;
    }

    if (password) {
      url.password = password;
    }

    return url.toString();
  } catch {
    return trimmed;
  }
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "string" &&
    error.trim()
  ) {
    return error;
  }

  return "Terjadi kesalahan yang tidak diketahui.";
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
  const [loaded, setLoaded] =
    useState(false);

  const [error, setError] =
    useState(false);

  const [errorDetail, setErrorDetail] =
    useState("");

  useEffect(() => {
    setLoaded(false);
    setError(false);
    setErrorDetail("");
  }, [url]);

  if (!url) {
    return (
      <View style={styles.emptyVideo}>
        <Text style={styles.bigIcon}>
          📹
        </Text>

        <Text style={styles.emptyTitle}>
          Belum ada kamera aktif
        </Text>

        <Text style={styles.centerText}>
          Pilih kamera atau masukkan URL
          RTSP/HTTP/HTTPS.
        </Text>
      </View>
    );
  }

  const lowerUrl =
    url.toLowerCase();

  const isRtsp =
    lowerUrl.startsWith("rtsp://") ||
    lowerUrl.startsWith("rtsps://");

  return (
    <View style={styles.videoBox}>
  <Video
  key={url}
  focusable
  source={{
    uri: url,
    ...(isRtsp
      ? { type: "rtsp" }
      : {}),
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
          const errorObject =
            videoError?.error;

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
  onMove: (
    direction: PtzDirection,
  ) => void;
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

          const distance = Math.sqrt(
            dx * dx + dy * dy,
          );

          if (distance < 35) {
            onStop();
            return;
          }

          if (
            Math.abs(dx) >
            Math.abs(dy)
          ) {
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

        onPanResponderTerminationRequest:
          () => true,
      }),
    [
      enabled,
      onMove,
      onStop,
    ],
  );

  if (!enabled) {
    return null;
  }

  return (
  <View
    pointerEvents="box-only"
    style={styles.ptzSwipeOverlay}
    {...responder.panHandlers}
  />
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
  const [
    activeTab,
    setActiveTab,
  ] = useState<TabName>("live");

  const [
    cameras,
    setCameras,
  ] = useState<DiscoveredCamera[]>([]);

  const [
    selectedCamera,
    setSelectedCamera,
  ] =
    useState<DiscoveredCamera | null>(
      null,
    );

  const [
    activeStream,
    setActiveStream,
  ] = useState("");

  const [
    playerConnected,
    setPlayerConnected,
  ] = useState(false);

  const [
    manualUrl,
    setManualUrl,
  ] = useState(
    "rtsp://192.168.1.20:554/stream1",
  );

  const [
    username,
    setUsername,
  ] = useState("");

  const [
    password,
    setPassword,
  ] = useState("");

  const [
    vendor,
    setVendor,
  ] =
    useState<(typeof CCTV_VENDORS)[number]>(
      "Generic / ONVIF",
    );

  const [
    searching,
    setSearching,
  ] = useState(false);

  const [
    connecting,
    setConnecting,
  ] = useState<string | null>(null);

  const [
    testing,
    setTesting,
  ] = useState(false);

  const [
    statusText,
    setStatusText,
  ] = useState("");

  const [
    profile,
    setProfile,
  ] =
    useState<OnvifMediaProfile | null>(
      null,
    );

  const [
    history,
    setHistory,
  ] = useState<HistoryItem[]>([]);

  const [
    showInfo,
    setShowInfo,
  ] = useState(true);

  const [
    nativeControls,
    setNativeControls,
  ] = useState(true);

  const [
    muted,
    setMuted,
  ] = useState(false);

const [cameraCount, setCameraCount] = useState(1);
const [fullscreenSlot, setFullscreenSlot] =
useState<number | null>(null);
const [cameraStreams, setCameraStreams] = useState<string[]>([]);
const [cameraIds, setCameraIds] = useState<string[]>([]);
const [cameraConnected, setCameraConnected] = useState<boolean[]>([]);

  const [
    cameraPtzConfig,
    setCameraPtzConfig,
  ] =
    useState<
      Array<CameraPtzConfig | null>
    >([]);

  const [
    ownerText,
    setOwnerText,
  ] = useState(
    "Pemilik: CCTV Universal Monitor",
  );

  const [
    logoUri,
    setLogoUri,
  ] = useState("");

  const [
    savedOwnerText,
    setSavedOwnerText,
  ] = useState(
    "Pemilik: CCTV Universal Monitor",
  );

  const [
    savedLogoUri,
    setSavedLogoUri,
  ] = useState("");

  const [
    settingsSaved,
    setSettingsSaved,
  ] = useState(false);

  const marqueeX =
    useRef(
      new Animated.Value(0),
    ).current;

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
    logoUri.trim() ||
    savedLogoUri;

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
    !marqueeTextWidth ||
    !displayedOwner.trim()
  ) {
    return;
  }

  marqueeX.stopAnimation();

  const startX = marqueeClipWidth;
  const endX = -marqueeTextWidth;

  const travelDistance =
    marqueeClipWidth + marqueeTextWidth;

  const moveDuration = Math.max(
    8000,
    travelDistance * 32,
  );

  // Mulai benar-benar dari luar sisi kanan
  marqueeX.setValue(startX);

  const animation = Animated.loop(
    Animated.timing(
      marqueeX,
      {
        toValue: endX,
        duration: moveDuration,
        easing: Easing.linear,
        useNativeDriver: true,
        isInteraction: false,
      },
    ),
  );

  animation.start();

  return () => {
    animation.stop();
    marqueeX.stopAnimation();
  };
}, [
  marqueeClipWidth,
  marqueeTextWidth,
  displayedOwner,
  marqueeX,
]);
  
  const addHistory =
    useCallback(
      (
        action: HistoryAction,
        url: string,
        message: string,
      ) => {
        setHistory((current) =>
          [
            {
              id:
                `${Date.now()}-${Math.random()}`,
              url: hideCredentials(url),
              action,
              message,
              time:
                new Date().toLocaleString(),
            },
            ...current,
          ].slice(0, 100),
        );
      },
      [],
    );


  const resetCameraArrays = useCallback(
    (_count: number) => {
      // Selalu pertahankan 9 slot kamera.
      // Pergantian layout tidak boleh menghapus
      // stream, ID, status, atau konfigurasi PTZ.
      setCameraStreams((current) =>
        Array.from(
          { length: MAX_CAMERAS },
          (_, index) => current[index] || "",
        ),
      );

      setCameraIds((current) =>
        Array.from(
          { length: MAX_CAMERAS },
          (_, index) => current[index] || "",
        ),
      );

      setCameraConnected((current) =>
        Array.from(
          { length: MAX_CAMERAS },
          (_, index) => current[index] || false,
        ),
      );

      setCameraPtzConfig((current) =>
        Array.from(
          { length: MAX_CAMERAS },
          (_, index) => current[index] || null,
        ),
      );
    },
    [],
  );

  useEffect(() => {
    resetCameraArrays(cameraCount);
  }, [cameraCount, resetCameraArrays]);

  useEffect(() => {
    resetCameraArrays(
      cameraCount,
    );
  }, [
    cameraCount,
    resetCameraArrays,
  ]);

  useEffect(() => {
  let cancelled = false;

  const loadSavedState = async () => {
    try {
      const raw =
        await AsyncStorage.getItem(
          CAMERA_STORAGE_KEY,
        );

      if (!raw || cancelled) {
        return;
      }

      const saved =
        JSON.parse(raw) as Partial<SavedCameraState>;

      if (
        typeof saved.cameraCount === "number"
      ) {
        setCameraCount(
          Math.max(
            1,
            Math.min(
              MAX_CAMERAS,
              Math.floor(
                saved.cameraCount,
              ),
            ),
          ),
        );
      }

      if (Array.isArray(saved.cameraStreams)) {
        setCameraStreams(saved.cameraStreams);
      }

if (Array.isArray(saved.cameraIds)) {
  setCameraIds(saved.cameraIds);
}

    if (
        Array.isArray(
          saved.cameraPtzConfig,
        )
      ) {
        setCameraPtzConfig(
          saved.cameraPtzConfig,
        );
      }

      if (
        typeof saved.ownerText === "string"
      ) {
        setOwnerText(saved.ownerText);
        setSavedOwnerText(
          saved.ownerText,
        );
      }

      if (
        typeof saved.logoUri === "string"
      ) {
        setLogoUri(saved.logoUri);
        setSavedLogoUri(
          saved.logoUri,
        );
      }
    } catch (error) {
      console.warn(
        "Gagal memuat konfigurasi CCTV:",
        error,
      );
    }
  };

  void loadSavedState();

  return () => {
    cancelled = true;
  };
}, []);
  
         useEffect(() => {
  const saveCameraState = async () => {
    try {
      const state: SavedCameraState = {
        cameraCount,
        cameraStreams,
        cameraIds,
        cameraPtzConfig,
        ownerText,
        logoUri,
      };

      await AsyncStorage.setItem(
        CAMERA_STORAGE_KEY,
        JSON.stringify(state),
      );
    } catch (error) {
      console.warn(
        "Gagal menyimpan konfigurasi CCTV:",
        error,
      );
    }
  };

  void saveCameraState();
}, [
  cameraCount,
  cameraStreams,
  cameraIds,
  cameraPtzConfig,
  ownerText,
  logoUri,
]);

  const updateCameraStream =
    useCallback(
      (
        index: number,
        value: string,
      ) => {
        setCameraStreams(
          (current) => {
            const next = [
              ...current,
            ];

            next[index] = value;

            return next;
          },
        );
      },
      [],
    );

  const updateCameraConnected =
    useCallback(
      (
        index: number,
        value: boolean,
      ) => {
        setCameraConnected(
          (current) => {
            const next = [
              ...current,
            ];

            next[index] = value;

            return next;
          },
        );
      },
      [],
    );

  const updateCameraPtzConfig =
    useCallback(
      (
        index: number,
        value: CameraPtzConfig | null,
      ) => {
        setCameraPtzConfig((current) => {
          const next = [...current];
          next[index] = value;
          return next;
        });
      },
      [],
    );

const [cameraSettingsSlot, setCameraSettingsSlot] =
  useState<number | null>(null);

const [cameraSettingsUrl, setCameraSettingsUrl] =
  useState("");

const [cameraSettingsServiceUrl, setCameraSettingsServiceUrl] =
  useState("");

const [cameraSettingsProfileToken, setCameraSettingsProfileToken] =
  useState("");

const [cameraSettingsUsername, setCameraSettingsUsername] =
  useState("");

const [cameraSettingsPassword, setCameraSettingsPassword] =
  useState("");

const findNextCameraSlot = useCallback(() => {
  const visibleStreams = cameraStreams.slice(
    0,
    cameraCount,
  );

  const existingIndex = visibleStreams.findIndex(
    (stream) => !stream.trim(),
  );

  return existingIndex >= 0
    ? existingIndex
    : -1;
}, [cameraStreams, cameraCount]);

  const setCameraPtz =
    useCallback(
      (
        index: number,
        value: CameraPtzConfig | null,
      ) => {
        updateCameraPtzConfig(index, value);
      },
      [updateCameraPtzConfig],
    );

  const sendPtz =
    useCallback(
      async (
        slot: number,
        command: PtzCommand,
      ) => {
        const config =
          cameraPtzConfig[slot];

        if (!config) {
          setStatusText(
            `PTZ kamera ${slot + 1} belum tersedia.`,
          );
          return;
        }

        try {
          await sendOnvifPtzCommand(
            config.deviceServiceUrl,
            config.profileToken,
            config.credentials,
            command,
          );

          setStatusText(
            `Perintah PTZ kamera ${slot + 1} berhasil dikirim.`,
          );
        } catch (error) {
          const message =
            formatError(error);

          setStatusText(
            `PTZ kamera ${slot + 1}: ${message}`,
          );

          addHistory(
            "error",
            cameraStreams[slot] || "",
            `PTZ: ${message}`,
          );
        }
      },
      [
        cameraPtzConfig,
        cameraStreams,
        addHistory,
      ],
    );

  const movePtz =
    useCallback(
      (
        slot: number,
        direction: PtzDirection,
      ) => {
        void sendPtz(slot, {
          type: "move",
          direction,
          speed: 0.5,
        });
      },
      [sendPtz],
    );

    const stopPtz =
    useCallback(
      (slot: number) => {
        void sendPtz(slot, {
          type: "stop",
        });
      },
      [sendPtz],
    );

  const zoomPtz =
    useCallback(
      (
        slot: number,
        direction: "in" | "out",
      ) => {
        void sendPtz(slot, {
          type: "zoom",
          direction,
          speed: 0.5,
        });
      },
      [sendPtz],
    );

const openCameraSettings = useCallback(
  (slot: number) => {
    const config = cameraPtzConfig[slot];

    setCameraSettingsSlot(slot);
    setCameraSettingsUrl(cameraStreams[slot] || "");
    setCameraSettingsServiceUrl(
      config?.deviceServiceUrl || "",
    );
    setCameraSettingsProfileToken(
      config?.profileToken || "",
    );
    setCameraSettingsUsername(
      config?.credentials.username || "",
    );
    setCameraSettingsPassword(
      config?.credentials.password || "",
    );

    setActiveTab("settings");
  },
  [cameraPtzConfig, cameraStreams],
);

  const discoverCameras =
    useCallback(
      async () => {
        setSearching(true);
        setStatusText(
          "Mencari kamera ONVIF...",
        );

        try {
          const result =
            await discoverOnvifCameras();

          setCameras(result);

          if (!result.length) {
            setStatusText(
              "Tidak ada kamera ONVIF yang ditemukan.",
            );
            return;
          }

          setStatusText(
            `${result.length} kamera ditemukan.`,
          );
        } catch (error) {
          const message =
            formatError(error);

          setStatusText(message);

          addHistory(
            "error",
            "",
            message,
          );
        } finally {
          setSearching(false);
        }
      },
      [addHistory],
    );

  const connectCamera =
  useCallback(
    async (
      camera: DiscoveredCamera,
      targetSlot?: number,
    ) => {
      const deviceUrl =
        camera.xaddrs[0] ||
        camera.address;

      if (!deviceUrl) {
        setStatusText(
          "Alamat layanan ONVIF kamera tidak tersedia.",
        );
        return;
      }

      // Cegah satu kamera ONVIF dipasang
      // pada lebih dari satu channel.
      const existingSlot =
        cameraIds.findIndex(
          (id) =>
            id === camera.id,
        );

      if (
        existingSlot >= 0 &&
        existingSlot !== targetSlot
      ) {
        Alert.alert(
          "Kamera sudah digunakan",
          `${
            camera.name ||
            camera.host ||
            "Kamera"
          } sudah terpasang pada Kamera ${
            existingSlot + 1
          }.`,
        );
        return;
      }

      let slot =
        typeof targetSlot === "number"
          ? targetSlot
          : findNextCameraSlot();

      if (
        slot < 0 ||
        slot >= cameraCount
      ) {
        Alert.alert(
          "Channel penuh",
          "Semua channel kamera yang aktif sudah digunakan.",
        );
        return;
      }

      setConnecting(camera.id);
      setStatusText(
        `Menghubungkan ke ${
          camera.name ||
          camera.host
        }...`,
      );

      const credentials: OnvifPtzCredentials = {
        username,
        password,
      };

      try {
        const result =
          await getOnvifStreamUri(
            deviceUrl,
            credentials,
          );

        if (
          !result.ok ||
          !result.streamUri
        ) {
          throw new Error(
            result.message ||
              "Kamera tidak mengembalikan media profile ONVIF.",
          );
        }

        const streamUri =
          addCredentials(
            result.streamUri,
            username,
            password,
          );

        setSelectedCamera(camera);
        setProfile(
          result.profile || null,
        );
        setActiveStream(streamUri);
        setManualUrl(streamUri);

        // Simpan kamera ke channel
        // yang dipilih.
        setCameraIds(
          (current) => {
            const next = [
              ...current,
            ];

            next[slot] =
              camera.id;

            return next;
          },
        );

        setCameraStream(
          slot,
          streamUri,
        );

        if (
          result.mediaServiceUrl &&
          result.profile?.token
        ) {
          setCameraPtz(
            slot,
            {
              deviceServiceUrl:
                deviceUrl,
              profileToken:
                result.profile.token,
              credentials,
            },
          );
        } else {
          setCameraPtz(
            slot,
            null,
          );
        }

        setActiveTab("live");

        setStatusText(
          `Kamera ${
            camera.name ||
            camera.host
          } terhubung ke Kamera ${
            slot + 1
          }.`,
        );

        addHistory(
          "connected",
          streamUri,
          `Kamera ONVIF terhubung ke Kamera ${
            slot + 1
          }.`,
        );
      } catch (error) {
        const message =
          formatError(error);

        setStatusText(
          message,
        );

        addHistory(
          "error",
          deviceUrl,
          message,
        );
      } finally {
        setConnecting(null);
      }
    },
    [
      username,
      password,
      cameraIds,
      cameraCount,
      findNextCameraSlot,
      setCameraStream,
      setCameraPtz,
      addHistory,
    ],
  );

  const connectManual =
    useCallback(
      async () => {
        const rawUrl =
          manualUrl.trim();

        if (!isCameraUrl(rawUrl)) {
          Alert.alert(
            "URL tidak valid",
            "Masukkan URL RTSP, RTSPS, HTTP, atau HTTPS yang valid.",
          );
          return;
        }

        const finalUrl =
          addCredentials(
            rawUrl,
            username,
            password,
          );

        setConnecting("manual");
        setStatusText(
          "Menyiapkan stream...",
        );

        try {
          const result =
            await testCameraConnection({
              id: "manual",
              name: "Manual",
              url: finalUrl,
              username,
              password,
              vendor,
            });

          /*
           * RTSP memang dikembalikan sebagai
           * unsupported oleh network probe.
           * Itu bukan berarti kamera offline.
           * Player native menjadi pengujian sebenarnya.
           */
          if (
            result.status === "offline" &&
            !/^rtsp(s?):\/\//i.test(
              finalUrl,
            )
          ) {
            throw new Error(
              result.message,
            );
          }

          setActiveStream(finalUrl);
          setSelectedCamera(null);
          setProfile(null);

          const slot =
            findNextCameraSlot();

          if (slot >= 0) {
  // RTSP/manual tidak lagi terikat
  // ke kamera ONVIF sebelumnya.
  setCameraIds(
    (current) => {
      const next = [...current];
      next[slot] = "";
      return next;
    },
  );

  setCameraStream(
    slot,
    finalUrl,
  );

  setCameraPtz(
    slot,
    null,
  );
}

          setActiveTab("live");
          setStatusText(
            "Stream siap diputar.",
          );

          addHistory(
            "connected",
            finalUrl,
            "Stream manual berhasil disiapkan.",
          );
        } catch (error) {
          const message =
            formatError(error);

          setStatusText(message);

          addHistory(
            "error",
            finalUrl,
            message,
          );
        } finally {
          setConnecting(null);
        }
      },
      [
  manualUrl,
  username,
  password,
  vendor,
  findNextCameraSlot,
  setCameraIds,
  setCameraStream,
  setCameraPtz,
  addHistory,
],
    );
  const testManualConnection =
    useCallback(
      async () => {
        const rawUrl =
          manualUrl.trim();

        if (!isCameraUrl(rawUrl)) {
          Alert.alert(
            "URL tidak valid",
            "Masukkan URL RTSP, RTSPS, HTTP, atau HTTPS yang valid.",
          );
          return;
        }

        const finalUrl =
          addCredentials(
            rawUrl,
            username,
            password,
          );

        setTesting(true);
        setStatusText(
          "Menguji koneksi kamera...",
        );

        try {
          const result =
            await testCameraConnection({
              id: "manual",
              name: "Manual",
              url: finalUrl,
              username,
              password,
              vendor,
            });

          setStatusText(
            result.message ||
              "Koneksi kamera selesai diuji.",
          );

          addHistory(
            result.status === "offline"
              ? "error"
              : "connected",
            finalUrl,
            result.message ||
              "Tes koneksi selesai.",
          );
        } catch (error) {
          const message =
            formatError(error);

          setStatusText(message);

          addHistory(
            "error",
            finalUrl,
            message,
          );
        } finally {
          setTesting(false);
        }
      },
      [
        manualUrl,
        username,
        password,
        vendor,
        addHistory,
      ],
    );

  const disconnectCamera =
    useCallback(
      (slot?: number) => {
        if (
          typeof slot === "number"
        ) {
          const stream =
            cameraStreams[slot] || "";

          if (stream) {
            addHistory(
              "disconnected",
              stream,
              `Kamera ${slot + 1} diputus.`,
            );
          }

          clearCameraSlot(slot);

          if (
            activeStream === stream
          ) {
            setActiveStream("");
            setSelectedCamera(null);
            setProfile(null);
            setPlayerConnected(false);
          }

          setStatusText(
            `Kamera ${slot + 1} diputus.`,
          );

          return;
        }

        if (activeStream) {
          addHistory(
            "disconnected",
            activeStream,
            "Kamera diputus.",
          );
        }

        setActiveStream("");
        setSelectedCamera(null);
        setProfile(null);
        setPlayerConnected(false);
        setStatusText(
          "Kamera diputus.",
        );
      },
      [
        activeStream,
        cameraStreams,
        addHistory,
      ],
    );

  const pickLogoFromGallery =
    useCallback(
      async () => {
        try {
          const permission =
            await ImagePicker.requestMediaLibraryPermissionsAsync();

          if (!permission.granted) {
            Alert.alert(
              "Izin diperlukan",
              "Izinkan akses galeri untuk memilih logo.",
            );
            return;
          }

          const result =
            await ImagePicker.launchImageLibraryAsync(
              {
                mediaTypes:
                  ["images"],
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.9,
              },
            );

          if (
            result.canceled ||
            !result.assets?.[0]?.uri
          ) {
            return;
          }

          setLogoUri(
            result.assets[0].uri,
          );
          setSettingsSaved(false);
        } catch (error) {
          Alert.alert(
            "Logo",
            formatError(error),
          );
        }
      },
      [],
    );

  const saveSettings =
    useCallback(
      () => {
        const nextOwner =
          ownerText.trim() ||
          "Pemilik: CCTV Universal Monitor";

        setSavedOwnerText(
          nextOwner,
        );

        setSavedLogoUri(
          logoUri.trim(),
        );

        setOwnerText(nextOwner);

        setSettingsSaved(true);
        setStatusText(
          "Pengaturan berhasil disimpan.",
        );
      },
      [ownerText, logoUri],
    );

  const clearHistory =
    useCallback(
      () => {
        Alert.alert(
          "Hapus riwayat",
          "Hapus semua riwayat koneksi?",
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
          ],
        );
      },
      [],
    );

  const selectCameraLayout =
    useCallback(
      (count: number) => {
        const safeCount =
          Math.max(
            1,
            Math.min(
              MAX_CAMERAS,
              Math.floor(count),
            ),
          );

        setCameraCount(
          safeCount,
        );
      },
      [],
    );

const clearCameraSlot =
  useCallback(
    (slot: number) => {
      setCameraStreams(
        (items) => {
          const next = [...items];
          next[slot] = "";
          return next;
        },
      );

      setCameraIds(
        (items) => {
          const next = [...items];
          next[slot] = "";
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

            setCameraPtzConfig(
        (items) => {
          const next = [...items];
          next[slot] = null;
          return next;
        },
      );
    },
    [],
  );
      
  const cameraGridColumns =
    cameraCount === 1
      ? 1
      : 2;

  const cameraAspectRatio =
    cameraCount === 1
      ? 16 / 9
      : cameraCount <= 4
        ? 1.25
        : 1.45;

  
  const cameraCardWidth: DimensionValue =
    fullscreenSlot !== null
      ? "100%"
      : isLandscape
        ? `${100 / cameraGridColumns - 1}%`
        : "100%";


  const cameraGridStyle = {
    flexDirection:
      "row" as const,
    flexWrap:
      "wrap" as const,
    justifyContent:
      "space-between" as const,
  };

  const setCameraSlotConnected =
    useCallback(
      (
        slot: number,
        value: boolean,
      ) => {
        updateCameraConnected(
          slot,
          value,
        );
// Status LIVE hanya untuk channel ini.
// Jangan mengubah activeStream global ketika
// beberapa kamera sedang diputar bersamaan.
      },
      [
        updateCameraConnected,
        cameraStreams,
      ],
    );

  const renderCameraSlot =
    (slot: number) => {
      const stream =
        cameraStreams[slot] || "";

      const connected =
        cameraConnected[slot] || false;

      const ptzConfig =
        cameraPtzConfig[slot];

      return (
        <View
          key={`camera-slot-${slot}`}
          style={[
            styles.cameraCard,
            {
              width: cameraCardWidth,
            },
          ]}
        >
          <View
            style={styles.cameraCardHeader}
          >
            <View
              style={
                styles.cameraHeaderTitleWrap
              }
            >
              <Text
                style={styles.cardTitle}
              >
                Kamera {slot + 1}
              </Text>

              <View
                style={
                  styles.cameraStatusWrap
                }
              >
                <View
                  style={[
                    styles.statusDot,
                    connected &&
                      styles.statusDotOnline,
                  ]}
                />

                <Text
                  style={
                    styles.cameraStatusText
                  }
                >
                  {connected
                    ? "LIVE"
                    : stream
                      ? "SIAP"
                      : "KOSONG"}
                </Text>
              </View>
            </View>
          </View>

          <View
            style={[
              styles.cameraVideoArea,
              {
                aspectRatio:
                  cameraAspectRatio,
              },
            ]}
          >

{stream ? (
  <>

    <CameraVideo
      url={stream}
      nativeControls={false}
      muted={muted}
      zoom={1}
      onLoad={() => {
        setCameraSlotConnected(slot, true);
      }}
      onError={(message) => {
        updateCameraConnected(
          slot,
          false,
        );

        addHistory(
          "error",
          stream,
          message,
        );
      }}
    />

    <PtzSwipeControl
      enabled={
        Boolean(ptzConfig) &&
        !nativeControls
      }
      onMove={(direction) =>
        movePtz(slot, direction)
      }
      onStop={() => stopPtz(slot)}
    />

  
<View style={styles.cameraControlRow}>
  {/* Tombol layar penuh */}
  <Pressable
    style={styles.cameraControlButton}
    onPress={() =>
      setFullscreenSlot(
        fullscreenSlot === slot
          ? null
          : slot,
      )
    }
  >
    <Text style={styles.cameraControlText}>
      {fullscreenSlot === slot ? "⊡" : "⛶"}
    </Text>
  </Pressable>

  {/* Tombol suara */}
  <Pressable
    style={styles.cameraControlButton}
    onPress={() => setMuted(!muted)}
  >
    <Text style={styles.cameraControlText}>
      {muted ? "🔇" : "🔊"}
    </Text>
  </Pressable>

  {/* Tombol pengaturan per kamera */}
  <Pressable
    style={styles.cameraControlButton}
    onPress={() => openCameraSettings(slot)}
  >
    <Text style={styles.cameraControlText}>
      ⚙
    </Text>
  </Pressable>
</View>
</>
) : 
(
  <View
    style={styles.emptyCameraSlot}
  >
    <Text
      style={styles.emptySlotIcon}
    >
      📹
    </Text>

    <Text
      style={styles.emptySlotText}
    >
      Kamera {slot + 1}
    </Text>

    <Text
      style={styles.emptySlotHint}
    >
      Tambahkan dari menu CCTV
     </Text>
  </View>
)}

          </View>

          {stream ? (
            <View
              style={styles.cameraMeta}
            >
              <Text
                style={
                  styles.endpointText
                }
                numberOfLines={1}
              >
                {hideCredentials(stream)}
              </Text>
            </View>
          ) : null}
        </View>
      );
    };

  const renderLive = () => (
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
          style={styles.sectionHeaderText}
        >
          <Text
            style={styles.sectionTitle}
          >
            Live CCTV
          </Text>

          <Text
            style={styles.sectionSubtitle}
          >
            Pantau semua kamera secara langsung.
          </Text>
        </View>

        <View
          style={styles.layoutSelector}
        >
          {[1, 2, 4, 6, 9].map(
            (count) => (
              <Pressable
                key={count}
                onPress={() =>
                  selectCameraLayout(count)
                }
                style={[
                  styles.layoutButton,
                  cameraCount === count &&
                    styles.layoutButtonActive,
                ]}
              >
                <Text
                  style={[
                    styles.layoutButtonText,
                    cameraCount === count &&
                      styles.layoutButtonTextActive,
                  ]}
                >
                  {count}
                </Text>
              </Pressable>
            ),
          )}
        </View>
      </View>

      <View
        style={[
          styles.cameraGrid,
          cameraGridStyle,
        ]}
      >
        
{Array.from(
  {
    length:
      fullscreenSlot !== null
        ? 1
        : cameraCount,
  },
  (_, index) =>
    renderCameraSlot(
      fullscreenSlot !== null
        ? fullscreenSlot
        : index,
    ),
)}

      </View>

      {!cameraStreams.some(
        (stream) => Boolean(stream),
      ) ? (
        <View
          style={styles.emptyLiveArea}
        >
          <Text
            style={styles.emptyIcon}
          >
            📹
          </Text>

          <Text
            style={styles.emptyTitle}
          >
            Belum ada stream CCTV
          </Text>

          <Text
            style={styles.centerText}
          >
            Tambahkan kamera melalui menu CCTV.
          </Text>

          <Pressable
            style={styles.primaryButton}
            onPress={() =>
              setActiveTab("cctv")
            }
          >
            <Text
              style={styles.primaryButtonText}
            >
              Tambah Kamera
            </Text>
          </Pressable>
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
      keyboardShouldPersistTaps="handled"
    >
      <View
        style={styles.sectionHeader}
      >
        <View
          style={styles.sectionHeaderText}
        >
          <Text
            style={styles.sectionTitle}
          >
            CCTV
          </Text>

          <Text
            style={styles.sectionSubtitle}
          >
            Cari kamera ONVIF atau masukkan stream manual.
          </Text>
        </View>

        <Pressable
          style={styles.primaryButtonSmall}
          onPress={discoverCameras}
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
              Cari CCTV
            </Text>
          )}
        </Pressable>
      </View>

      {statusText ? (
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            {statusText}
          </Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          Kamera Ditemukan
        </Text>

        {cameras.length === 0 ? (
          <Text style={styles.mutedText}>
            Belum ada kamera ditemukan.
            Tekan "Cari CCTV".
          </Text>
        ) : (

cameras.map((camera) => {
  const assignedSlot =
    cameraIds.findIndex(
      (id) => id === camera.id,
    );

  return (
    <View
      key={camera.id}
      style={styles.cameraListItem}
    >
      <View
        style={styles.cameraListInfo}
      >
        <Text
          style={styles.cameraListName}
        >
          {camera.name ||
            "Kamera ONVIF"}
        </Text>

        <Text
          style={
            styles.cameraListAddress
          }
        >
          {camera.host}:{camera.port}
        </Text>

        {camera.xaddrs?.length ? (
          <Text
            style={styles.endpointText}
            numberOfLines={1}
          >
            {camera.xaddrs[0]}
          </Text>
        ) : null}

        {assignedSlot >= 0 ? (
          <Text
            style={[
              styles.mutedText,
              {
                marginTop: 4,
              },
            ]}
          >
            Terpasang pada Kamera{" "}
            {assignedSlot + 1}
          </Text>
        ) : null}
      </View>

      <Text
        style={[
          styles.fieldLabel,
          {
            marginTop: 8,
          },
        ]}
      >
        Pilih Channel
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          gap: 6,
          paddingVertical: 4,
        }}
      >
        {Array.from(
          {
            length: cameraCount,
          },
          (_, slot) => {
            const isAssigned =
              cameraIds[slot] ===
              camera.id;

            const assignedElsewhere =
              assignedSlot >= 0 &&
              assignedSlot !== slot;

            return (
              <Pressable
                key={`camera-${camera.id}-slot-${slot}`}
                disabled={
                  connecting === camera.id ||
                  assignedElsewhere
                }
                onPress={() =>
                  connectCamera(
                    camera,
                    slot,
                  )
                }
                style={[
                  styles.vendorButton,
                  isAssigned &&
                    styles.vendorButtonActive,
                  assignedElsewhere && {
                    opacity: 0.35,
                  },
                  connecting ===
                    camera.id && {
                    opacity: 0.6,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.vendorButtonText,
                    isAssigned &&
                      styles.vendorButtonTextActive,
                  ]}
                >
                  {isAssigned
                    ? `Kamera ${
                        slot + 1
                      } ✓`
                    : `Kamera ${
                        slot + 1
                      }`}
                </Text>
              </Pressable>
            );
          },
        )}

{cameraSettingsSlot !== null ? (
  <View style={styles.card}>
    <Text style={styles.sectionTitle}>
      Pengaturan Kamera {cameraSettingsSlot + 1}
    </Text>

    <Text style={styles.fieldLabel}>
      URL Stream
    </Text>
    <TextInput
      value={cameraSettingsUrl}
      onChangeText={setCameraSettingsUrl}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType="url"
      placeholder="rtsp://alamat-kamera/stream"
      placeholderTextColor="#7b8794"
      style={styles.input}
    />

    <Text style={styles.fieldLabel}>
      ONVIF Device Service URL
    </Text>
    <TextInput
      value={cameraSettingsServiceUrl}
      onChangeText={setCameraSettingsServiceUrl}
      autoCapitalize="none"
      autoCorrect={false}
      placeholder="Alamat layanan ONVIF"
      placeholderTextColor="#7b8794"
      style={styles.input}
    />

    <Text style={styles.fieldLabel}>
      ONVIF Profile Token
    </Text>
    <TextInput
      value={cameraSettingsProfileToken}
      onChangeText={setCameraSettingsProfileToken}
      placeholder="Profile token"
      placeholderTextColor="#7b8794"
      style={styles.input}
    />

    <Text style={styles.fieldLabel}>
      Username ONVIF
    </Text>
    <TextInput
      value={cameraSettingsUsername}
      onChangeText={setCameraSettingsUsername}
      autoCapitalize="none"
      placeholder="Username"
      placeholderTextColor="#7b8794"
      style={styles.input}
    />

    <Text style={styles.fieldLabel}>
      Password ONVIF
    </Text>
    <TextInput
      value={cameraSettingsPassword}
      onChangeText={setCameraSettingsPassword}
      secureTextEntry
      placeholder="Password"
      placeholderTextColor="#7b8794"
      style={styles.input}
    />

    <Text style={styles.saveHint}>
      Simpan URL dan konfigurasi PTZ untuk channel ini saja.
    </Text>
  </View>
) : null}

      </ScrollView>
      <Pressable
        style={[
          styles.secondaryButton,
          connecting === camera.id &&
            styles.buttonDisabled,
        ]}
        disabled={
          connecting === camera.id
        }
        onPress={() =>
          connectCamera(camera)
        }
      >
        {connecting === camera.id ? (
          <ActivityIndicator
            size="small"
          />
        ) : (
          <Text
            style={
              styles.secondaryButtonText
            }
          >
            Hubungkan Otomatis
          </Text>
        )}
      </Pressable>
    </View>
  );
})
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          Tambah Stream Manual
        </Text>

        <Text style={styles.fieldLabel}>
          URL Kamera
        </Text>

        <TextInput
          value={manualUrl}
          onChangeText={setManualUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="rtsp://192.168.1.20:554/stream1"
          placeholderTextColor="#7b8794"
          style={styles.input}
        />

        <Text style={styles.fieldLabel}>
          Username
        </Text>

        <TextInput
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Username kamera"
          placeholderTextColor="#7b8794"
          style={styles.input}
        />

        <Text style={styles.fieldLabel}>
          Password
        </Text>

        <TextInput
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          placeholder="Password kamera"
          placeholderTextColor="#7b8794"
          style={styles.input}
        />

        <Text style={styles.fieldLabel}>
          Vendor
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={
            styles.vendorRow
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
                  styles.vendorButton,
                  vendor === item &&
                    styles.vendorButtonActive,
                ]}
              >
                <Text
                  style={[
                    styles.vendorButtonText,
                    vendor === item &&
                      styles.vendorButtonTextActive,
                  ]}
                >
                  {item}
                </Text>
              </Pressable>
            ),
          )}
        </ScrollView>

        <View
          style={styles.buttonRow}
        >
          <Pressable
            style={styles.secondaryButton}
            onPress={
              testManualConnection
            }
            disabled={testing}
          >
            {testing ? (
              <ActivityIndicator
                size="small"
              />
            ) : (
              <Text
                style={
                  styles.secondaryButtonText
                }
              >
                Tes Koneksi
              </Text>
            )}
          </Pressable>

          <Pressable
            style={styles.primaryButton}
            onPress={connectManual}
            disabled={
              connecting === "manual"
            }
          >
            {connecting === "manual" ? (
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
                Putar Stream
              </Text>
            )}
          </Pressable>
        </View>

        <Text style={styles.saveHint}>
          RTSP tidak diuji menggunakan HTTP probe.
          Player Android menjadi pengujian pemutaran
          sebenarnya.
        </Text>
      </View>

      {selectedCamera ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Kamera Aktif
          </Text>

          <Text style={styles.mutedText}>
            {selectedCamera.name ||
              selectedCamera.host}
          </Text>

          {profile ? (
            <View style={styles.profileBox}>
              <Text
                style={styles.profileTitle}
              >
                Media Profile
              </Text>

              <Text
                style={styles.profileText}
              >
                {profile.name ||
                  profile.token}
              </Text>

              {profile.videoEncoding ? (
                <Text
                  style={styles.profileText}
                >
                  Codec:{" "}
                  {profile.videoEncoding}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );

  const renderSettings = () => (
    <ScrollView
      style={styles.content}
      contentContainerStyle={
        styles.contentContainer
      }
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          Pengaturan Tampilan
        </Text>

        <Text
          style={styles.sectionSubtitle}
        >
          Atur identitas pemilik dan logo.
        </Text>

        <Text style={styles.fieldLabel}>
          Identitas Pemilik
        </Text>

        <TextInput
          value={ownerText}
          onChangeText={(value) => {
            setOwnerText(value);
            setSettingsSaved(false);
          }}
          placeholder="Masukkan identitas pemilik"
          placeholderTextColor="#7b8794"
          style={styles.input}
        />

        <Text style={styles.fieldLabel}>
          Logo
        </Text>

        <View
          style={styles.logoPreviewBox}
        >
          {displayedLogo ? (
            <Image
              source={{
                uri: displayedLogo,
              }}
              style={styles.logoPreview}
              resizeMode="contain"
            />
          ) : (
            <View
              style={styles.logoPlaceholder}
>
              <Text
                style={
                  styles.logoPlaceholderText
                }
              >
                Logo belum dipilih
              </Text>
            </View>
          )}
        </View>

        <View
          style={styles.logoActionRow}
        >
          <Pressable
            style={styles.secondaryButton}
            onPress={
              pickLogoFromGallery
            }
          >
            <Text
              style={
                styles.secondaryButtonText
              }
            >
              Pilih Logo
            </Text>
          </Pressable>

          {logoUri ? (
            <Pressable
              style={styles.secondaryButton}
              onPress={() => {
                setLogoUri("");
                setSettingsSaved(false);
              }}
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

        <Text
          style={styles.logoHelpText}
        >
          Logo akan tampil di sudut kanan atas.
        </Text>

        <Pressable
          style={[
            styles.primaryButton,
            settingsSaved &&
              styles.saveButtonSaved,
          ]}
          onPress={saveSettings}
        >
          <Text
            style={
              styles.primaryButtonText
            }
          >
            {settingsSaved
              ? "Tersimpan"
              : "Simpan Pengaturan"}
          </Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          Tampilan Live
        </Text>

        <View style={styles.switchRow}>
          <View
            style={styles.switchTextWrap}
          >
            <Text
              style={styles.switchTitle}
            >
              Suara CCTV
            </Text>

            <Text
              style={
                styles.switchDescription
              }
            >
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
          <View
            style={styles.switchTextWrap}
          >
            <Text
              style={styles.switchTitle}
            >
              Kontrol Video
            </Text>

            <Text
              style={
                styles.switchDescription
              }
            >
              Tampilkan kontrol bawaan player.
            </Text>
          </View>

          <Switch
            value={nativeControls}
            onValueChange={
              setNativeControls
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
    </ScrollView>
  );

const renderPlayback = () => (
  <OnvifPlaybackPanel
    cameras={cameraPtzConfig.flatMap(
      (config, index) =>
        config?.deviceServiceUrl
          ? [
              {
                slot: index,
                deviceServiceUrl:
                  config.deviceServiceUrl,
                credentials:
                  config.credentials,
                connected:
                  cameraConnected[index],
              },
            ]
          : [],
    )}
    muted={muted}
    onHistory={(url, message) =>
      addHistory(
        "connected",
        url,
        message,
      )
    }
  />
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
        <View
          style={styles.sectionHeaderText}
        >
          <Text
            style={styles.sectionTitle}
          >
            Riwayat
          </Text>

          <Text
            style={styles.sectionSubtitle}
          >
            Riwayat koneksi dan aktivitas kamera.
          </Text>
        </View>

        {history.length > 0 ? (
          <Pressable
            style={styles.secondaryButton}
            onPress={clearHistory}
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

      {history.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>
            🕘
          </Text>

          <Text style={styles.emptyTitle}>
            Belum ada riwayat
          </Text>

          <Text style={styles.centerText}>
            Aktivitas kamera akan ditampilkan di sini.
          </Text>
        </View>
      ) : (
        history.map((item) => (
          <View
            key={item.id}
            style={styles.historyItem}
          >
            <View
              style={styles.historyIconWrap}
            >
              <Text
                style={styles.historyIcon}
              >
                {item.action ===
                "connected"
                  ? "✓"
                  : item.action ===
                      "disconnected"
                    ? "−"
                    : "!"}
              </Text>
            </View>

            <View
              style={styles.historyContent}
            >
              <Text
                style={styles.historyAction}
              >
                {item.action ===
                "connected"
                  ? "Terhubung"
                  : item.action ===
                      "disconnected"
                    ? "Terputus"
                    : "Error"}
              </Text>

              <Text
                style={styles.historyMessage}
              >
                {item.message}
              </Text>

              {item.url ? (
                <Text
                  style={styles.historyUrl}
                  numberOfLines={2}
                >
             
 {hideCredentials(item.url)}
                </Text>
              ) : null}

              <Text
                style={styles.historyTime}
              >
                {item.time}
              </Text>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );

  const renderHeader = () => (
    <View style={styles.header}>
      <View
        style={styles.marqueeContainer}
        onLayout={(event) => {
          setMarqueeClipWidth(
            event.nativeEvent.layout.width,
          );
        }}
      >
        <Animated.View
          style={[
            styles.marqueeContent,
            {
              transform: [
                {
                  translateX: marqueeX,
                },
              ],
            },
          ]}
        >
          <Text
            style={styles.marqueeText}
            onLayout={(event) => {
              setMarqueeTextWidth(
                event.nativeEvent.layout.width,
              );
            }}
          >
            {displayedOwner}
          </Text>
        </Animated.View>
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
    </View>
  );

  const renderContent = () => {
    switch (activeTab) {
      case "cctv":
        return renderCctv();

      case "playback":
        return renderPlayback();

      case "history":
        return renderHistory();

      case "settings":
        return renderSettings();

      case "live":
      default:
        return renderLive();
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {renderHeader()}

      <View style={styles.main}>
        {renderContent()}
      </View>

      <View style={styles.bottomTabs}>
        <TabButton
          icon="📺"
          label="Live"
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
          active={activeTab === "history"}
          onPress={() =>
            setActiveTab("history")
          }
        />

<TabButton
  icon="⏪"
  label="Playback"
  active={activeTab === "playback"}
  onPress={() =>
    setActiveTab("playback")
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
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0b1117",
  },

  main: {
    flex: 1,
  },

  header: {
  minHeight: 58,
  paddingHorizontal: 8,
  paddingVertical: 6,
  backgroundColor: "#111923",
  flexDirection: "row",
  alignItems: "center",
  borderBottomWidth: 1,
  borderBottomColor: "#263341",
},

  marqueeContainer: {
  ...StyleSheet.absoluteFillObject,
  overflow: "hidden",
  justifyContent: "center",
  zIndex: 1,
},

  marqueeContent: {
  position: "absolute",
  left: 0,
  minWidth: "100%",
},

  marqueeText: {
  color: "#ffffff",
  fontSize: 18,
  fontWeight: "700",
  includeFontPadding: false,
  paddingHorizontal: 10,
},

  headerLogo: {
  position: "absolute",
  right: 8,
  top: 8,
  width: 42,
  height: 42,
  borderRadius: 8,
  zIndex: 10,
  elevation: 10,
  backgroundColor: "#18222d",
},

  content: {
    flex: 1,
  },

  contentContainer: {
    padding: 12,
    paddingBottom: 24,
  },

  card: {
    backgroundColor: "#141d27",
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#263341",
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },

  sectionHeaderText: {
    flex: 1,
    marginRight: 10,
  },

  sectionTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
  },

  sectionSubtitle: {
    color: "#8d9aaa",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },

  cardTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 8,
  },

  fieldLabel: {
    color: "#b9c4d0",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 10,
    marginBottom: 6,
  },

  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: "#344352",
    borderRadius: 9,
    backgroundColor: "#0e151d",
    color: "#ffffff",
    paddingHorizontal: 12,
    fontSize: 14,
  },

  buttonRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 14,
  },

  primaryButton: {
    minHeight: 44,
    flex: 1,
    paddingHorizontal: 14,
    borderRadius: 9,
    backgroundColor: "#1976d2",
    alignItems: "center",
    justifyContent: "center",
  },

  primaryButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
  },

  secondaryButton: {
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: 9,
    backgroundColor: "#263442",
    alignItems: "center",
    justifyContent: "center",
  },

  secondaryButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },

  buttonDisabled: {
    opacity: 0.5,
  },

  saveButtonSaved: {
    backgroundColor: "#287d4b",
  },

  saveHint: {
    color: "#7f8d9c",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 9,
  },

  infoBox: {
    backgroundColor: "#172432",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#2c4053",
  },

  infoText: {
    color: "#b9c9d9",
    fontSize: 12,
    lineHeight: 18,
  },

  mutedText: {
    color: "#8d9aaa",
    fontSize: 12,
  },

  centerText: {
    color: "#8d9aaa",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },

  videoBox: {
    flex: 1,
    backgroundColor: "#000000",
    overflow: "hidden",
    position: "relative",
  },

  video: {
    width: "100%",
    height: "100%",
    backgroundColor: "#000000",
  },

  emptyVideo: {
    flex: 1,
    minHeight: 240,
    backgroundColor: "#090d12",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },

  bigIcon: {
    fontSize: 42,
    marginBottom: 10,
  },

  emptyTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 6,
  },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.68)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },

  overlayTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
  },

  overlayText: {
    color: "#d6dde5",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 8,
  },

  errorIcon: {
    color: "#ffb74d",
    fontSize: 34,
    marginBottom: 8,
  },

  liveBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.7)",
  },

  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#ef5350",
    marginRight: 5,
  },

  liveText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "800",
  },

  cameraGrid: {
    marginBottom: 12,
  },

  cameraCard: {
    backgroundColor: "#141d27",
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#263341",
  },

  cameraCardHeader: {
    minHeight: 42,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  cameraStatusWrap: {
    flexDirection: "row",
    alignItems: "center",
  },
  cameraHeaderTitleWrap: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
  },

  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#65717e",
    marginRight: 5,
  },

  statusDotOnline: {
    backgroundColor: "#35c46a",
  },

  cameraStatusText: {
    color: "#9ba8b6",
    fontSize: 10,
    fontWeight: "700",
  },

  cameraVideoArea: {
    width: "100%",
    backgroundColor: "#000000",
  },

  cameraMeta: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },

  endpointText: {
    color: "#718092",
    fontSize: 10,
  },

  emptyCameraSlot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    backgroundColor: "#090d12",
  },

  emptySlotIcon: {
    fontSize: 28,
    marginBottom: 6,
  },

  emptySlotText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
  },

  emptySlotHint: {
    color: "#718092",
    fontSize: 10,
    marginTop: 4,
    textAlign: "center",
  },

  cameraListItem: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#0e151d",
    borderWidth: 1,
    borderColor: "#263341",
    marginBottom: 8,
  },

  cameraListInfo: {
    flex: 1,
    marginRight: 10,
  },

  cameraListName: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 4,
  },

  cameraListAddress: {
    color: "#9aa8b7",
    fontSize: 11,
    marginBottom: 4,
  },

  cameraListRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  profileBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 9,
    backgroundColor: "#0d151d",
    borderWidth: 1,
    borderColor: "#293846",
  },

  profileTitle: {
    color: "#9eb0c2",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    marginBottom: 4,
  },

  profileText: {
    color: "#dce4ec",
    fontSize: 12,
    marginTop: 2,
  },
    layoutSelector: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  layoutButton: {
    minWidth: 28,
    height: 28,
    paddingHorizontal: 6,
    borderRadius: 7,
    backgroundColor: "#263442",
    alignItems: "center",
    justifyContent: "center",
  },

  layoutButtonActive: {
    backgroundColor: "#1976d2",
  },

  layoutButtonText: {
    color: "#b5c1cd",
    fontSize: 10,
    fontWeight: "700",
  },

  layoutButtonTextActive: {
    color: "#ffffff",
  },

  emptyLiveArea: {
    backgroundColor: "#141d27",
    borderRadius: 12,
    padding: 18,
    marginBottom: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#263341",
  },

  primaryButtonSmall: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#1976d2",
    alignItems: "center",
    justifyContent: "center",
  },

settingsSaveButton: {
  width: "100%",
  minHeight: 48,
  marginTop: 12,
  paddingHorizontal: 14,
  borderRadius: 9,
  backgroundColor: "#1976d2",
  alignItems: "center",
  justifyContent: "center",
  alignSelf: "stretch",
  elevation: 3,
},

  vendorRow: {
        gap: 7,
    paddingVertical: 2,
  },

  vendorButton: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#263442",
  },

  vendorButtonActive: {
    backgroundColor: "#1976d2",
  },

  vendorButtonText: {
    color: "#b5c1cd",
    fontSize: 11,
    fontWeight: "600",
  },

  vendorButtonTextActive: {
    color: "#ffffff",
  },

  ptzSwipeOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },

  ptzSwipeHint: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 7,
    backgroundColor: "rgba(0,0,0,0.45)",
  },

  ptzSwipeHintText: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 9,
  },

  logoPreviewBox: {
    height: 120,
    borderRadius: 10,
    backgroundColor: "#0d141b",
    borderWidth: 1,
    borderColor: "#344352",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },

  logoPreview: {
    width: 105,
    height: 105,
  },

  logoPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },

  logoPlaceholderText: {
    color: "#718092",
    fontSize: 12,
  },

  logoActionRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },

  logoHelpText: {
    color: "#718092",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
    marginBottom: 10,
  },

  switchRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#263341",
    marginTop: 8,
    paddingTop: 8,
  },

  switchTextWrap: {
    flex: 1,
    paddingRight: 12,
  },

  switchTitle: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },

  switchDescription: {
    color: "#718092",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },

  emptyBox: {
    backgroundColor: "#141d27",
    borderRadius: 12,
    padding: 28,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#263341",
  },

  emptyIcon: {
    fontSize: 30,
    marginBottom: 8,
  },

  historyItem: {
    flexDirection: "row",
    backgroundColor: "#141d27",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#263341",
  },

  historyIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#263442",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },

  historyIcon: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800",
  },

  historyContent: {
    flex: 1,
  },

  historyAction: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
  },

  historyMessage: {
    color: "#aab6c3",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },

  historyUrl: {
    color: "#718092",
    fontSize: 10,
    lineHeight: 14,
    marginTop: 4,
  },

  historyTime: {
    color: "#596777",
    fontSize: 9,
    marginTop: 5,
  },

  bottomTabs: {
  minHeight: 56,
  flexDirection: "row",
  backgroundColor: "#111923",
  borderTopWidth: 1,
  borderTopColor: "#263341",
  paddingHorizontal: 6,
  paddingTop: 3,
  paddingBottom: 3,
  marginBottom: 2,
},

  tab: {
  flex: 1,
  minHeight: 48,
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 9,
  marginHorizontal: 2,
},

  tabActive: {
    backgroundColor: "#1b3044",
  },

  tabIcon: {
    fontSize: 17,
    marginBottom: 2,
  },

  tabText: {
    color: "#718092",
    fontSize: 9,
    fontWeight: "600",
  },

  tabTextActive: {
    color: "#ffffff",
  },

  
  cameraControlRow: {
    position: "absolute",
    top: 8,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    zIndex: 20,
    elevation: 20,
  },

  cameraControlButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: "rgba(15, 25, 35, 0.9)",
    borderWidth: 1,
    borderColor: "#526273",
    alignItems: "center",
    justifyContent: "center",
  },

  cameraControlText: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },

});