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
  PermissionsAndroid,
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

import { startTalkback, stopTalkback } from "cctv-talkback";

import * as ImagePicker from "expo-image-picker";

import * as ScreenOrientation from "expo-screen-orientation";

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
  checkOnvifTalkbackSupport,
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
  cameraTalkbackCredentials?: Array<{
  username: string;
  password: string;
} | null>;
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
  onPlaybackStateChange,
}: {
 
  url: string;
  nativeControls: boolean;
  muted: boolean;
  zoom: number;
  onLoad?: () => void;
  onError?: (message: string) => void;
  onPlaybackStateChange?: (isPlaying: boolean) => void;
}) {

  const [loaded, setLoaded] =
    useState(false);

  const [error, setError] =
    useState(false);

  const [errorDetail, setErrorDetail] =
    useState("");

  const [playbackTime, setPlaybackTime] =
  useState(0);

const [buffering, setBuffering] =
  useState(false);

const [isPlaying, setIsPlaying] =
  useState(false);

const [playerGeneration, setPlayerGeneration] =
  useState(0);

useEffect(() => {
  setLoaded(false);
  setError(false);
  setErrorDetail("");
  setPlaybackTime(0);
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
    disableFocus={true}
    useTextureView={true}

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

controls={false}
muted={muted}
resizeMode="contain"
paused={false}
progressUpdateInterval={1000}

onProgress={({ currentTime }) => {
  setPlaybackTime(currentTime);
}}

onBuffer={({ isBuffering }) => {
  setBuffering(isBuffering);
}}

onPlaybackStateChanged={({ isPlaying }) => {
setIsPlaying(isPlaying);
onPlaybackStateChange?.(isPlaying);
}}

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

      {loaded && !error ? (
  <View style={styles.liveBadge}>
    <View style={styles.liveDot} />

   <Text style={styles.liveText}>
  {buffering
    ? "BUFFERING"
    : isPlaying
      ? "PLAYING"
      : "STOP"}
  {" · "}
  {playbackTime.toFixed(1)}s
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
        // Jangan mengambil sentuhan saat pengguna mengetuk tombol.
        onStartShouldSetPanResponder: () => false,

        // PTZ hanya mengambil alih saat jari mulai bergerak.
        onMoveShouldSetPanResponder: (
          _event,
          gestureState,
        ) =>
          enabled &&
          (
            Math.abs(gestureState.dx) > 8 ||
            Math.abs(gestureState.dy) > 8
          ),

        onPanResponderGrant: (event) => {
          startX.current = event.nativeEvent.pageX;
          startY.current = event.nativeEvent.pageY;
        },

        onPanResponderRelease: (event) => {
          const dx =
            event.nativeEvent.pageX - startX.current;
          const dy =
            event.nativeEvent.pageY - startY.current;

          const distance = Math.sqrt(
            dx * dx + dy * dy,
          );

          if (distance < 35) {
            onStop();
            return;
          }

          if (Math.abs(dx) > Math.abs(dy)) {
            onMove(dx > 0 ? "right" : "left");
          } else {
            onMove(dy > 0 ? "down" : "up");
          }

          onStop();
        },

        onPanResponderTerminate: () => {
          onStop();
        },

        onPanResponderTerminationRequest: () => true,
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

  const nativeControls = true;

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
const [cameraMuted, setCameraMuted] = useState<boolean[]>([]);
const [
  cameraTalkbackCredentials,
  setCameraTalkbackCredentials,
] = useState<
  Array<{
    username: string;
    password: string;
  } | null>
>([]);
const [talkbackActiveSlot, setTalkbackActiveSlot] =
  useState<number | null>(null);
const [talkbackBusySlot, setTalkbackBusySlot] =
  useState<number | null>(null);
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


  const setCameraStream = useCallback(
    (slot: number, stream: string) => {
      setCameraStreams((current) => {
        const next = Array.from(
          { length: MAX_CAMERAS },
          (_, index) => current[index] || "",
        );

        if (slot < 0 || slot >= MAX_CAMERAS) {
          return current;
        }

        next[slot] = stream;
        return next;
      });
    },
    [],
  );
  
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
  Array.isArray(
    saved.cameraTalkbackCredentials,
  )
) {
  setCameraTalkbackCredentials(
    saved.cameraTalkbackCredentials,
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
        cameraTalkbackCredentials,
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
  cameraTalkbackCredentials,
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
            `Perintah PTZ kamera ${slot +