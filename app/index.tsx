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
  return /^(rtsp|rtsps|http|https):\/\/\S+$/i.test(
    value.trim(),
  );
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

  return (
    <View style={styles.videoBox}>
      <Video
        focusable
        source={{
          uri: url,
          type:
            url
              .toLowerCase()
              .startsWith("rtsp://") ||
            url
              .toLowerCase()
              .startsWith("rtsps://")
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
          bufferForPlaybackAfterRebufferMs:
            1000,
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

          <Text
            style={styles.overlayTitle}
          >
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
    useState<DiscoveredCamera | null>(
      null,
    );

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
    useState<OnvifMediaProfile | null>(
      null,
    );

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

  const [
    cameraControlsVisible,
    setCameraControlsVisible,
  ] = useState<boolean[]>([]);

  const cameraControlsTimers =
    useRef<
      Array<
        ReturnType<typeof setTimeout> | null
      >
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
    setCameraCount(1);
    setStatusText(
      "CCTV telah diputus.",
    );
  };

  const showCameraControls = (slot: number) => {
    const oldTimer = cameraControlsTimers.current[slot];

    if (oldTimer) {
      clearTimeout(oldTimer);
    }

    setCameraControlsVisible((items) => {
      const next = [...items];
      next[slot] = true;
      return next;
    });

    cameraControlsTimers.current[slot] = setTimeout(() => {
      setCameraControlsVisible((items) => {
        const next = [...items];
        next[slot] = false;
        return next;
      });

      cameraControlsTimers.current[slot] = null;
    }, 4000);
  };

  const setCameraStream = (slot: number, stream: string) => {
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

    setCameraControlsVisible((items) => {
      const next = [...items];
      next[slot] = false;
      return next;
    });

    const oldTimer = cameraControlsTimers.current[slot];

    if (oldTimer) {
      clearTimeout(oldTimer);
      cameraControlsTimers.current[slot] = null;
    }

    const requiredLayout =
      slot === 0 ? 1 :
      slot === 1 ? 2 :
      slot < 4 ? 4 :
      slot < 6 ? 6 : 9;

    setCameraCount((current) =>
      current < requiredLayout ? requiredLayout : current,
    );
  };

  const setCameraSlotConnected = (
    slot: number,
    connected: boolean,
  ) => {
    setCameraConnected((items) => {
      const next = [...items];
      next[slot] = connected;
      return next;
    });

    setPlayerConnected(connected);

    if (connected) {
      setTesting(false);
    }
  };

  const toggleCameraMute = (slot: number) => {
    setCameraMuted((items) => {
      const next = [...items];
      next[slot] = !next[slot];
      return next;
    });

    showCameraControls(slot);
  };

  const clearCameraSlot = (slot: number) => {
    setCameraStreams((items) => {
      const next = [...items];
      next[slot] = "";
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

    setCameraControlsVisible((items) => {
      const next = [...items];
      next[slot] = false;
      return next;
    });

    const oldTimer = cameraControlsTimers.current[slot];

    if (oldTimer) {
      clearTimeout(oldTimer);
      cameraControlsTimers.current[slot] = null;
    }

    if (slot === 0) {
      setActiveStream("");
      setPlayerConnected(false);
    }
  };

  const connectCamera = async (
    camera: CameraDevice,
    slot = 0,
  ) => {
    const stream = await resolveCameraStream(camera);

    if (!stream) {
      setStatusText(
        `Kamera ${slot + 1}: URL RTSP tidak ditemukan.`,
      );

      addHistory(
        "error",
        camera.xaddr || camera.address || camera.name,
        "URL RTSP kamera tidak ditemukan.",
      );

      return;
    }

    setSelectedCamera(camera);
    setActiveStream(stream);
    setProfile(null);
    setTesting(true);
    setPlayerConnected(false);

    setCameraStream(slot, stream);

    setStatusText(
      `Menghubungkan kamera ${slot + 1}...`,
    );

    addHistory(
      "connected",
      stream,
      `Kamera ${slot + 1} sedang dihubungkan.`,
    );
  };

    const connectManualCamera = async () => {
    const value = manualRtsp.trim();

    if (!value) {
      Alert.alert(
        "RTSP belum diisi",
        "Masukkan alamat RTSP kamera terlebih dahulu.",
      );
      return;
    }

    const slot = findNextCameraSlot();

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

    setCameraStream(slot, value);
    setActiveStream(value);

    setStatusText(
      `Menghubungkan RTSP manual ke kamera ${slot + 1}...`,
    );

    addHistory(
      "connected",
      value,
      `RTSP manual kamera ${slot + 1} sedang dihubungkan.`,
    );
  };

  const testCamera = async () => {
    const slot = findNextCameraSlot();

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

    setStatusText("Mencari kamera ONVIF...");

    try {
      const cameras = await discoverOnvifCameras();

      setCameras(cameras);

      if (!cameras.length) {
        setStatusText(
          "Tidak ada kamera ONVIF yang ditemukan.",
        );

        addHistory(
          "error",
          "ONVIF",
          "Tidak ada kamera ONVIF yang ditemukan.",
        );

        return;
      }

      const camera = cameras[0];

      setSelectedCamera(camera);

      setStatusText(
        `Kamera terdeteksi: ${
          camera.name || camera.address || "ONVIF"
        }`,
      );

      const stream = await resolveCameraStream(camera);

      if (!stream) {
        setStatusText(
          "Camera tidak mengembalikan media profile ONVIF.",
        );

        addHistory(
          "error",
          camera.xaddr || camera.address || camera.name,
          "Camera tidak mengembalikan media profile ONVIF.",
        );

        return;
      }

      setCameraStream(slot, stream);
      setActiveStream(stream);
      setPlayerConnected(false);

      setStatusText(
        `Kamera ${slot + 1} siap diputar.`,
      );

      addHistory(
        "connected",
        stream,
        `Kamera ${slot + 1} ditemukan melalui ONVIF.`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Gagal mencari kamera ONVIF.";

      setStatusText(message);

      addHistory(
        "error",
        "ONVIF",
        message,
      );

      Alert.alert(
        "Koneksi gagal",
        message,
      );
    } finally {
      setTesting(false);
    }
  };

  const selectDiscoveredCamera = async (
    camera: CameraDevice,
  ) => {
    const slot = findNextCameraSlot();

    if (slot < 0) {
      Alert.alert(
        "Slot kamera penuh",
        "Maksimal 9 kamera dapat ditampilkan.",
      );
      return;
    }

    setSelectedCamera(camera);
    setTesting(true);
    setProfile(null);
    setPlayerConnected(false);

    setStatusText(
      `Mengambil media profile dari ${
        camera.name || camera.address || "kamera"
      }...`,
    );

    try {
      const stream = await resolveCameraStream(camera);

      if (!stream) {
        setStatusText(
          "Camera tidak mengembalikan media profile ONVIF.",
        );

        addHistory(
          "error",
          camera.xaddr || camera.address || camera.name,
          "Camera tidak mengembalikan media profile ONVIF.",
        );

        return;
      }

      setCameraStream(slot, stream);
      setActiveStream(stream);

      setStatusText(
        `Kamera ${slot + 1} siap diputar.`,
      );

      addHistory(
        "connected",
        stream,
        `Kamera ${slot + 1} terhubung.`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Gagal mengambil media profile.";

      setStatusText(message);

      addHistory(
        "error",
        camera.xaddr || camera.address || camera.name,
        message,
      );
    } finally {
      setTesting(false);
    }
  };

  const renderCameraVideo = (
    stream: string,
    index: number,
  ) => {
    const connected = cameraConnected[index] ?? false;
    const muted = cameraMuted[index] ?? false;
    const controlsVisible =
      cameraControlsVisible[index] ?? false;

    return (
      <View
        key={`camera-${index}`}
        style={[
          styles.cameraSlot,
          {
            width:
              cameraCount <= 1
                ? "100%"
                : cameraCount <= 4
                  ? "49%"
                  : "32%",
          },
        ]}
      >
        <View style={styles.cameraSlotHeader}>
          <Text style={styles.cameraSlotTitle}>
            Kamera {index + 1}
          </Text>

          <Text style={styles.cameraSlotStatus}>
            {connected
              ? "LIVE"
              : stream
                ? "CONNECTING"
                : "OFFLINE"}
          </Text>
        </View>

        <View
          style={styles.liveCameraFrame}
          onTouchStart={() => showCameraControls(index)}
        >
          <CameraVideo
            url={stream}
            nativeControls={nativeControls}
            muted={muted}
            onLoad={() => {
              setCameraSlotConnected(index, true);
            }}
            onError={(message) => {
              setCameraSlotConnected(index, false);

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

          {controlsVisible ? (
            <View style={styles.cameraControlsOverlay}>
              <Pressable
                onPress={() => toggleCameraMute(index)}
                style={styles.micButton}
              >
                <Text style={styles.micButtonText}>
                  {muted ? "🔇" : "🎙️"}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {stream ? (
          <View
            style={[
              styles.statusPill,
              connected
                ? styles.statusPillOnline
                : styles.statusPillOffline,
            ]}
          >
            <View
              style={[
                styles.statusDot,
                connected
                  ? styles.statusDotOnline
                  : styles.statusDotOffline,
              ]}
            />

            <Text style={styles.statusPillText}>
              {connected
                ? "Live terhubung"
                : "Menghubungkan..."}
            </Text>
          </View>
        ) : null}
      </View>
    );
  };

  const renderLive = () => {
    const activeStreams = cameraStreams
      .map((stream, index) => ({
        stream,
        index,
      }))
      .filter((item) => item.stream.trim());

    if (!activeStreams.length) {
      return (
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
        >
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>📹</Text>

            <Text style={styles.emptyTitle}>
              Belum ada kamera aktif
            </Text>

            <Text style={styles.centerText}>
              Hubungkan kamera dari halaman CCTV untuk
              menampilkan live view.
            </Text>
          </View>
        </ScrollView>
      );
    }

    return (
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
      >
        <View style={styles.cameraGrid}>
          {activeStreams.map(({ stream, index }) =>
            renderCameraVideo(stream, index),
          )}
        </View>
      </ScrollView>
    );
  };
  const renderCctv = () => {
    return (
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
      >
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderText}>
            <Text style={styles.sectionTitle}>CCTV</Text>
            <Text style={styles.sectionSubtitle}>
              Cari kamera ONVIF atau masukkan alamat RTSP secara manual.
            </Text>
          </View>

          <View
            style={[
              styles.statusPill,
              playerConnected
                ? styles.statusPillOnline
                : styles.statusPillOffline,
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
              {playerConnected ? "LIVE" : "OFFLINE"}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Tata Letak Kamera
          </Text>

          <View style={styles.layoutRow}>
            {[1, 2, 4, 6, 9].map((count) => (
              <Pressable
                key={count}
                onPress={() => setCameraCount(count)}
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
            ))}
          </View>

          <Text style={styles.layoutHint}>
            Pilihan jumlah tampilan: 1, 2, 4, 6 atau 9 kamera.
            Slot kosong tidak akan mengambil ruang tampilan.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Koneksi Manual
          </Text>

          <Text style={styles.fieldLabel}>
            Alamat RTSP
          </Text>

          <TextInput
            value={manualRtsp}
            onChangeText={setManualRtsp}
            placeholder="rtsp://username:password@192.168.1.100:554/..."
            placeholderTextColor="#596674"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.input}
          />

          <View style={styles.buttonRow}>
            <Pressable
              onPress={connectManualCamera}
              disabled={testing}
              style={[
                styles.primaryButton,
                styles.flexButton,
                testing && { opacity: 0.55 },
              ]}
            >
              <Text style={styles.primaryButtonText}>
                {testing
                  ? "Menghubungkan..."
                  : "Hubungkan RTSP"}
              </Text>
            </Pressable>

            <Pressable
              onPress={disconnect}
              style={[
                styles.secondaryButtonSmall,
                styles.flexButton,
              ]}
            >
              <Text style={styles.secondaryButtonText}>
                Putuskan
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Pencarian ONVIF
          </Text>

          <Text style={styles.centerText}>
            Pastikan HP dan kamera berada pada jaringan lokal
            yang sama sebelum melakukan pencarian.
          </Text>

          <Pressable
            onPress={testCamera}
            disabled={testing}
            style={[
              styles.primaryButton,
              testing && { opacity: 0.55 },
            ]}
          >
            <Text style={styles.primaryButtonText}>
              {testing
                ? "Mencari kamera..."
                : "🔎 Cari CCTV"}
            </Text>
          </Pressable>
        </View>

        {cameras.length ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Kamera Ditemukan
            </Text>

            {cameras.map((camera, index) => (
              <View
                key={`${camera.address || camera.xaddr || index}-${index}`}
                style={styles.cameraCard}
              >
                <View style={styles.cameraCardHeader}>
                  <View style={styles.cameraIconBox}>
                    <Text style={styles.cameraIcon}>
                      📹
                    </Text>
                  </View>

                  <View style={styles.cameraCardInfo}>
                    <Text style={styles.cameraName}>
                      {camera.name ||
                        `Kamera ${index + 1}`}
                    </Text>

                    <Text style={styles.cameraMeta}>
                      {camera.address ||
                        camera.xaddr ||
                        "Alamat tidak tersedia"}
                    </Text>

                    {camera.xaddr ? (
                      <Text
                        style={styles.endpointText}
                        numberOfLines={2}
                      >
                        {camera.xaddr}
                      </Text>
                    ) : null}
                  </View>

                  <View
                    style={[
                      styles.statusPill,
                      styles.statusPillOffline,
                    ]}
                  >
                    <View
                      style={[
                        styles.statusDot,
                        styles.statusDotOffline,
                      ]}
                    />

                    <Text style={styles.statusPillText}>
                      ONVIF
                    </Text>
                  </View>
                </View>

                <Pressable
                  onPress={() =>
                    selectDiscoveredCamera(camera)
                  }
                  disabled={testing}
                  style={[
                    styles.primaryButtonSmall,
                    testing && { opacity: 0.55 },
                  ]}
                >
                  <Text style={styles.primaryButtonText}>
                    Gunakan Kamera Ini
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              Belum ada hasil pencarian kamera. Tekan
              "Cari CCTV" untuk memulai discovery ONVIF.
            </Text>
          </View>
        )}

        {selectedCamera ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Kamera Terpilih
            </Text>

                      <Text style={styles.statusText}>
              {selectedCamera.name ||
                selectedCamera.address ||
                selectedCamera.xaddr ||
                "Kamera ONVIF"}
            </Text>

            {selectedCamera.xaddr ? (
              <Text style={styles.endpointText}>
                {selectedCamera.xaddr}
              </Text>
            ) : null}

            {profile ? (
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>
                  Media profile berhasil diperoleh.
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {statusText ? (
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              {statusText}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    );
  };

  const renderHistory = () => {
    return (
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
      >
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderText}>
            <Text style={styles.sectionTitle}>
              Riwayat
            </Text>

            <Text style={styles.sectionSubtitle}>
              Catatan koneksi, disconnect dan error kamera.
            </Text>
          </View>
        </View>

        {!history.length ? (
          <View style={styles.card}>
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>
                🕘
              </Text>

              <Text style={styles.emptyTitle}>
                Belum ada riwayat
              </Text>

              <Text style={styles.centerText}>
                Aktivitas kamera akan muncul di sini.
              </Text>
            </View>
          </View>
        ) : (
          history.map((item, index) => (
            <View
              key={`${item.timestamp}-${index}`}
              style={styles.cameraCard}
            >
              <View style={styles.cameraCardHeader}>
                <View style={styles.cameraIconBox}>
                  <Text style={styles.cameraIcon}>
                    {item.type === "error"
                      ? "⚠️"
                      : item.type === "connected"
                        ? "▶️"
                        : "⏹️"}
                  </Text>
                </View>

                <View style={styles.cameraCardInfo}>
                  <Text style={styles.cameraName}>
                    {item.type === "error"
                      ? "Error"
                      : item.type === "connected"
                        ? "Terhubung"
                        : "Diputus"}
                  </Text>

                  <Text style={styles.cameraMeta}>
                    {formatHistoryDate(item.timestamp)}
                  </Text>
                </View>
              </View>

              <Text style={styles.statusText}>
                {item.message}
              </Text>

              {item.stream ? (
                <Text
                  style={styles.endpointText}
                  numberOfLines={2}
                >
                  {item.stream}
                </Text>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
    );
  };

  const renderSettings = () => {
    return (
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
      >
        <View style={styles.sectionHeader}>
          <View style={styles.sectionHeaderText}>
            <Text style={styles.sectionTitle}>
              Pengaturan
            </Text>

            <Text style={styles.sectionSubtitle}>
              Atur identitas aplikasi, tampilan video dan logo.
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Identitas Pemilik
          </Text>

          <Text style={styles.fieldLabel}>
            Tulisan identitas
          </Text>

          <TextInput
            value={ownerText}
            onChangeText={setOwnerText}
            placeholder="Masukkan identitas pemilik"
            placeholderTextColor="#596674"
            style={styles.input}
          />

          <Text style={styles.logoHelpText}>
            Tulisan akan bergerak otomatis pada bagian atas
            aplikasi.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Logo Header
          </Text>

          <Text style={styles.logoHelpText}>
            Pilih logo dari galeri HP. Logo akan tampil di
            sudut kanan atas header.
          </Text>

          <View style={styles.logoActionRow}>
            <Pressable
              onPress={pickLogoFromGallery}
              style={[
                styles.primaryButtonSmall,
                styles.flexButton,
              ]}
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

          <Text
            style={styles.logoUriText}
            numberOfLines={2}
          >
            {logoUri.trim() ||
              "Logo belum dipilih dari galeri."}
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
            Tekan tombol ini setelah mengganti logo atau
            identitas pemilik.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Kontrol Video
          </Text>

          <View style={styles.switchRow}>
            <View style={styles.switchTextWrap}>
              <Text style={styles.switchTitle}>
                Kontrol video native
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
                Audio kamera
              </Text>

              <Text style={styles.switchDescription}>
                Aktifkan suara secara default ketika stream
                diputar.
              </Text>
            </View>

            <Switch
              value={audioEnabled}
              onValueChange={setAudioEnabled}
            />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Informasi
          </Text>

          <Text style={styles.infoText}>
            CCTV Universal Monitor mendukung discovery ONVIF
            dan pemutaran stream RTSP melalui ExoPlayer.
          </Text>

          <Text
            style={[
              styles.infoText,
              { marginTop: 8 },
            ]}
          >
            Untuk kamera yang tidak menyediakan ONVIF media
            profile, gunakan koneksi RTSP manual.
          </Text>
        </View>
      </ScrollView>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.app}>
        <View style={styles.header}>
          <View 
            style={styles.headerTitleWrap}>
            <View
              style={styles.marqueeClip}
              onLayout={(event) =>
                setMarqueeClipWidth(
                  event.nativeEvent.layout.width,
                )
              }
            >
              <Animated.Text
                onLayout={(event) =>
                  setMarqueeTextWidth(
                    event.nativeEvent.layout.width,
                  )
                }
                style={[
                  styles.appSubtitle,
                  {
                    transform: [
                      {
                        translateX: marqueeX,
                      },
                    ],
                  },
                ]}
                numberOfLines={1}
              >
                {displayedOwner}
              </Animated.Text>
            </View>

            <Text style={styles.appTitle}>
              CCTV Universal Monitor
            </Text>

            <Text style={styles.appSubtitle}>
              ONVIF • RTSP • HTTP
            </Text>
          </View>

          {displayedLogo ? (
            <Image
              source={{ uri: displayedLogo }}
              style={styles.headerLogo}
              resizeMode="contain"
            />
          ) : null}

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

  appTitle: {
    color: "#fff",
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
    paddingHorizontal: 9,
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
    fontSize: 10,
    fontWeight: "800",
  },

  topStatus: {
    marginHorizontal: 14,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
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
    color: "#fff",
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
    marginBottom: 12,
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
  },

  videoBox: {
    position: "relative",
    width: "100%",
    aspectRatio: 16 / 9,
    marginBottom: 8,
    overflow: "hidden",
    borderRadius: 12,
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
    marginBottom: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#25313e",
    backgroundColor: "#111923",
  },

  bigIcon: {
    marginBottom: 6,
    fontSize: 30,
  },

      emptyBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 28,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#273442",
    backgroundColor: "#121b25",
  },

  emptyIcon: {
    fontSize: 34,
    marginBottom: 8,
  },

  emptyTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center",
  },

  emptyText: {
    marginTop: 6,
    color: "#81909f",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },

  emptyVideo: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    backgroundColor: "#080d12",
  },

  bigIcon: {
    fontSize: 38,
    marginBottom: 10,
  },

  videoBox: {
    flex: 1,
    width: "100%",
    minHeight: 160,
    backgroundColor: "#000",
    overflow: "hidden",
  },

  video: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: "#000",
  },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    backgroundColor: "rgba(0,0,0,0.72)",
  },

  overlayTitle: {
    marginTop: 8,
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
  },

  overlayText: {
    marginTop: 6,
    color: "#d7dee5",
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
  },

  errorIcon: {
    color: "#ffb4b4",
    fontSize: 32,
    fontWeight: "900",
  },

  liveBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7,
    backgroundColor: "rgba(120,0,0,0.82)",
  },

  liveDot: {
    width: 7,
    height: 7,
    marginRight: 5,
    borderRadius: 4,
    backgroundColor: "#ff4040",
  },

  liveText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "900",
  },

  emptyTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center",
  },

  centerText: {
    marginTop: 6,
    color: "#8795a4",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },

  card: {
    marginBottom: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#24313e",
    backgroundColor: "#121b25",
  },

  cardTitle: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 10,
  },

  sectionTitle: {
    marginTop: 14,
    marginBottom: 8,
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
  },

  fieldLabel: {
    marginBottom: 6,
    color: "#9ba8b6",
    fontSize: 11,
    fontWeight: "700",
  },

  input: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#2a3947",
    backgroundColor: "#0d151e",
    color: "#fff",
    fontSize: 13,
  },

    multilineInput: {
    minHeight: 82,
    paddingTop: 10,
    textAlignVertical: "top",
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
  },

  buttonRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },

  primaryButton: {
    minHeight: 46,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 9,
    backgroundColor: "#1769aa",
  },

  primaryButtonSmall: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 13,
    borderRadius: 9,
    backgroundColor: "#1769aa",
  },

  primaryButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
  },

  secondaryButton: {
    minHeight: 46,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#354555",
    backgroundColor: "#17212c",
  },

  secondaryButtonSmall: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 13,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#354555",
    backgroundColor: "#17212c",
  },

  secondaryButtonText: {
    color: "#d8e0e8",
    fontSize: 12,
    fontWeight: "800",
  },

  flexButton: {
    flex: 1,
  },

  dangerButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 9,
    backgroundColor: "#8d2525",
  },

  dangerButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
  },

  statusBox: {
    marginTop: 10,
    padding: 11,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#283744",
    backgroundColor: "#0d151e",
  },

  statusText: {
    color: "#d5dde5",
    fontSize: 11,
    lineHeight: 16,
  },

  infoBox: {
    marginTop: 10,
    padding: 11,
    borderRadius: 9,
    backgroundColor: "#142231",
    borderWidth: 1,
    borderColor: "#28445b",
  },

  infoText: {
    color: "#aebdcb",
    fontSize: 11,
    lineHeight: 17,
  },

  cameraGrid: {
    flex: 1,
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    alignContent: "stretch",
    backgroundColor: "#05080b",
  },

  cameraSlot: {
    padding: 2,
  },

  cameraSlotOne: {
    width: "100%",
    height: "100%",
  },

  cameraSlotTwo: {
    width: "50%",
    height: "100%",
  },

  cameraSlotFour: {
    width: "50%",
    height: "50%",
  },

  cameraSlotSix: {
    width: "50%",
    height: "33.3333%",
  },

  cameraSlotNine: {
    width: "33.3333%",
    height: "33.3333%",
  },

  liveCameraFrame: {
    flex: 1,
    overflow: "hidden",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#28323c",
    backgroundColor: "#000",
  },

  cameraLabel: {
    position: "absolute",
    top: 6,
    left: 6,
    zIndex: 5,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.72)",
  },

  cameraLabelText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "800",
  },

  cameraStatusBadge: {
    position: "absolute",
    right: 6,
    top: 6,
    zIndex: 5,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(0,0,0,0.72)",
  },

  cameraStatusText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "800",
  },

  cameraControls: {
    position: "absolute",
    left: 6,
    right: 6,
    bottom: 6,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 7,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.78)",
  },

  cameraControlButton: {
    minWidth: 34,
    minHeight: 30,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 7,
    borderRadius: 6,
    backgroundColor: "#263544",
  },

  cameraControlText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
  },

  cameraControlSpacer: {
    flex: 1,
  },

  discoveredItem: {
    marginBottom: 8,
    padding: 11,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#2a3947",
    backgroundColor: "#0e1720",
  },

  discoveredName: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
  },

  discoveredAddress: {
    marginTop: 4,
    color: "#8998a7",
    fontSize: 10,
    lineHeight: 15,
  },

  historyItem: {
    marginBottom: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#263542",
    backgroundColor: "#0d151e",
  },

  historyType: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
  },

  historyUrl: {
    marginTop: 4,
    color: "#93a3b2",
    fontSize: 10,
  },

  historyTime: {
    marginTop: 4,
    color: "#697887",
    fontSize: 9,
  },

  logoActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  },

  logoHelpText: {
    color: "#8998a7",
    fontSize: 11,
    lineHeight: 16,
  },

  logoPreview: {
    width: "100%",
    height: 120,
    marginTop: 12,
    borderRadius: 9,
    backgroundColor: "#0b1118",
  },

  logoEmptyPreview: {
    height: 100,
    marginTop: 12,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#2a3947",
    backgroundColor: "#0b1118",
  },

  logoEmptyText: {
    color: "#6f7d8b",
    fontSize: 11,
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