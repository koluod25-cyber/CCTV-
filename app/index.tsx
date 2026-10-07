import {
  useCallback,
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

type TabName =
  | "live"
  | "cctv"
  | "history"
  | "settings";

type HistoryItem = {
  id: string;
  url: string;
  action:
    | "connected"
    | "disconnected"
    | "error";
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
          const errorObject =
            videoError?.error;

          const errorCode =
            errorObject?.errorCode ||
            "";

          const errorString =
            errorObject?.errorString ||
            "";

          const errorException =
            errorObject?.errorException ||
            "";

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

        onPanResponderGrant: (
          event,
        ) => {
          startX.current =
            event.nativeEvent.pageX;

          startY.current =
            event.nativeEvent.pageY;
        },

        onPanResponderRelease: (
          event,
        ) => {
          if (!enabled) {
            return;
          }

          const dx =
            event.nativeEvent.pageX -
            startX.current;

          const dy =
            event.nativeEvent.pageY -
            startY.current;

          const threshold = 25;

          if (
            Math.abs(dx) < threshold &&
            Math.abs(dy) < threshold
          ) {
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
        },

        onPanResponderTerminate: () => {
          if (enabled) {
            onStop();
          }
        },
      }),
    [enabled, onMove, onStop],
  );

  return (
    <View
      {...responder.panHandlers}
      style={[
        styles.ptzSwipeOverlay,
        !enabled &&
          styles.ptzDisabledBox,
      ]}
    >
      <Text
        style={styles.ptzSwipeHintText}
      >
        Geser untuk PTZ
      </Text>
    </View>
  );
}

type TabButtonProps = {
  icon: string;
  label: string;
  active: boolean;
  onPress: () => void;
};

function TabButton({
  icon,
  label,
  active,
  onPress,
}: TabButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.tab,
        active && styles.tabActive,
      ]}
    >
      <Text
        style={[
          styles.tabText,
          active &&
            styles.tabTextActive,
        ]}
      >
        {icon}
      </Text>

      <Text
        style={[
          styles.tabText,
          active &&
            styles.tabTextActive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

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
      marqueeX.stopAnimation();
    };
  }, [
    marqueeClipWidth,
    marqueeTextWidth,
    marqueeX,
    displayedOwner,
  ]);

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

  const addHistory = useCallback(
    (
      action:
        | "connected"
        | "disconnected"
        | "error",
      url: string,
      message: string,
    ) => {
      const item: HistoryItem = {
        id:
          `${Date.now()}-${Math.random()}`,
        url,
        action,
        message,
        time:
          new Date().toLocaleString(
            "id-ID",
          ),
      };

      setHistory((current) => [
        item,
        ...current,
      ]);
    },
    [],
  );

  const updateCameraCount = useCallback(
    (count: number) => {
      const safeCount = Math.max(
        1,
        Math.min(MAX_CAMERAS, count),
      );

      setCameraCount(safeCount);

      setCameraStreams((current) =>
        Array.from(
          { length: safeCount },
          (_, index) =>
            current[index] || "",
        ),
      );

      setCameraConnected((current) =>
        Array.from(
          { length: safeCount },
          (_, index) =>
            current[index] || false,
        ),
      );

      setCameraMuted((current) =>
        Array.from(
          { length: safeCount },
          (_, index) =>
            current[index] || false,
        ),
      );

      setCameraZoom((current) =>
        Array.from(
          { length: safeCount },
          (_, index) =>
            current[index] || 1,
        ),
      );

      setCameraControlsVisible(
        (current) =>
          Array.from(
            { length: safeCount },
            (_, index) =>
              current[index] || false,
          ),
      );

      setCameraPtzConfig((current) =>
        Array.from(
          { length: safeCount },
          (_, index) =>
            current[index] || null,
        ),
      );
    },
    [],
  );

  useEffect(() => {
    updateCameraCount(1);
  }, [updateCameraCount]);

  const setCameraStream = useCallback(
    (
      index: number,
      value: string,
    ) => {
      setCameraStreams((current) => {
        const next = [
          ...current,
        ];

        while (
          next.length <
          cameraCount
        ) {
          next.push("");
        }

        next[index] = value;

        return next;
      });
    },
    [cameraCount],
  );

  const setCameraConnectedAt =
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

            while (
              next.length <
              cameraCount
            ) {
              next.push(false);
            }

            next[index] = value;

            return next;
          },
        );
      },
      [cameraCount],
    );

  const setCameraMutedAt =
    useCallback(
      (
        index: number,
        value: boolean,
      ) => {
        setCameraMuted(
          (current) => {
            const next = [
              ...current,
            ];

            while (
              next.length <
              cameraCount
            ) {
              next.push(false);
            }

            next[index] = value;

            return next;
          },
        );
      },
      [cameraCount],
    );

  const setCameraZoomAt =
    useCallback(
      (
        index: number,
        value: number,
      ) => {
            setCameraZoom((current) => {
      const next = [...current];

      while (next.length < cameraCount) {
        next.push(1);
      }

      next[index] = Math.max(
1,
Math.min(
3,
(next[index] || 1) + delta,
),
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
        current < requiredLayout
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

      next[slot] = connected;

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
              −
            </Text>
          </Pressable>

          <Text
            style={
              styles.ptzPanelStatus
            }
          >
            Zoom PTZ
          </Text>

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
              +
            </Text>
          </Pressable>
        </View>
      </View>
    );
  };
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
            onValueChange={(
              enabled,
            ) =>
              setMuted(!enabled)
            }
          />
        </View>
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
                        ▶ Hubungkan Kamera
                      </Text>
                    )}
                  </Pressable>
        <View
          style={
            styles.logoPreviewBox
          }
        >
          {displayedLogo ? (
            <Image
              source={{
                uri: displayedLogo,
              }}
              style={
                styles.logoPreview
              }
              resizeMode="contain"
            />
          ) : (
            <Text
              style={
                styles.logoPlaceholder
              }
            >
              Belum ada logo
            </Text>
          )}
        </View>

        <View
          style={styles.buttonRow}
        >
          <Pressable
            style={[
              styles.secondaryButton,
              styles.flexButton,
            ]}
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

          <Pressable
            style={[
              styles.secondaryButton,
              styles.flexButton,
            ]}
            onPress={
              clearLogo
            }
            disabled={
              !displayedLogo
            }
          >
            <Text
              style={[
                styles.secondaryButtonText,
                !displayedLogo &&
                  styles.disabledText,
              ]}
            >
              Hapus Logo
            </Text>
          </Pressable>
        </View>

        <Pressable
          style={
            styles.primaryButton
          }
          onPress={
            saveSettings
          }
        >
          <Text
            style={
              styles.primaryButtonText
            }
          >
            💾 Simpan Pengaturan
          </Text>
        </Pressable>

        {settingsSaved ? (
          <Text
            style={
              styles.saveHint
            }
          >
            Pengaturan sudah
            disimpan.
          </Text>
        ) : null}
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
              Kontrol bawaan
            </Text>

            <Text
              style={
                styles.switchDescription
              }
            >
              Tampilkan kontrol
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
              Aktifkan suara kamera
              secara default.
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

      <View style={styles.card}>
        <Text
          style={styles.cardTitle}
        >
          Informasi Aplikasi
        </Text>

        <Text
          style={
            styles.switchDescription
          }
        >
          CCTV Universal Monitor
        </Text>

        <Text
          style={
            styles.switchDescription
          }
        >
          Mendukung kamera ONVIF
          dan stream RTSP.
        </Text>

        <Text
          style={
            styles.switchDescription
          }
        >
          Maksimal 9 kamera.
        </Text>
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

  const renderContent = () => {
    switch (activeTab) {
      case "cctv":
        return renderCctv();

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
    <SafeAreaView
      style={styles.app}
    >
      <View
        style={styles.header}
      >
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
            <Animated.View
              style={{
                transform: [
                  {
                    translateX:
                      marqueeX,
                  },
                ],
              }}
            >
              <Text
                style={
                  styles.headerTitle
                }
                numberOfLines={1}
                onLayout={(event) =>
                  setMarqueeTextWidth(
                    event.nativeEvent
                      .layout.width,
                  )
                }
              >
                {displayedOwner}
              </Text>
            </Animated.View>
          </View>

          <Text
            style={
              styles.appSubtitle
            }
          >
            CCTV Universal Monitor
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
      </View>

      <View
        style={styles.topStatus}
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
            styles.topStatusText
          }
        >
          {playerConnected
            ? "Live terhubung"
            : activeStream
              ? "Membuka stream..."
              : "Belum ada stream aktif"}
        </Text>
      </View>

      <View
        style={styles.main}
      >
        {renderContent()}
      </View>

      <View
        style={styles.bottomTabs}
      >
        <TabButton
          label="Live"
          icon="▶"
          active={
            activeTab === "live"
          }
          onPress={() =>
            setActiveTab("live")
          }
        />

        <TabButton
          label="CCTV"
          icon="📹"
          active={
            activeTab === "cctv"
          }
          onPress={() =>
            setActiveTab("cctv")
          }
        />

        <TabButton
          label="Riwayat"
          icon="🕘"
          active={
            activeTab === "history"
          }
          onPress={() =>
            setActiveTab("history")
          }
        />

        <TabButton
          label="Pengaturan"
          icon="⚙"
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
        <TextInput
          value={manualUrl}
          editable={false}
          style={styles.input}
        />

        <Text
          style={
            styles.saveHint
          }
        >
          Gunakan menu Live untuk
          memasukkan URL RTSP kamera
          secara manual.
        </Text>
      </View>

      <View style={styles.card}>
        <Text
          style={styles.cardTitle}
        >
          Tentang
        </Text>

        <Text
          style={
            styles.switchDescription
          }
        >
          CCTV Universal Monitor
        </Text>

        <Text
          style={
            styles.saveHint
          }
        >
          Aplikasi pemantauan CCTV
          dengan dukungan ONVIF dan
          RTSP.
        </Text>
      </View>
    </ScrollView>
  );

  return (
    <SafeAreaView
      style={styles.app}
    >
      <View
        style={styles.header}
      >
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
            <Animated.View
              style={{
                transform: [
                  {
                    translateX:
                      marqueeX,
                  },
                ],
              }}
            >
              <Text
                style={
                  styles.headerTitle
                }
                numberOfLines={1}
                onLayout={(event) =>
                  setMarqueeTextWidth(
                    event.nativeEvent
                      .layout.width,
                  )
                }
              >
                {displayedOwner}
              </Text>
            </Animated.View>
          </View>

          <Text
            style={
              styles.appSubtitle
            }
          >
            CCTV Universal Monitor
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
      </View>

      {showInfo ? (
        <View
          style={styles.topStatus}
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
              styles.topStatusText
            }
          >
            {playerConnected
              ? "Live terhubung"
              : activeStream
                ? "Membuka stream..."
                : "Belum ada stream aktif"}
          </Text>
        </View>
      ) : null}

      <View
        style={styles.main}
      >
        {renderContent()}
      </View>

      <View
        style={styles.bottomTabs}
      >
        <TabButton
          label="Live"
          icon="▶"
          active={
            activeTab === "live"
          }
          onPress={() =>
            setActiveTab("live")
          }
        />

        <TabButton
          label="CCTV"
          icon="📹"
          active={
            activeTab === "cctv"
          }
          onPress={() =>
            setActiveTab("cctv")
          }
        />

        <TabButton
          label="Riwayat"
          icon="🕘"
          active={
            activeTab === "history"
          }
          onPress={() =>
            setActiveTab("history")
          }
        />

        <TabButton
          label="Pengaturan"
          icon="⚙️"
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
          <TabButton
            icon="⚙️"
            label="Pengaturan"
            active={
              activeTab ===
              "settings"
            }
            onPress={() =>
              setActiveTab(
                "settings",
              )
            }
          />
        </View>
      </View>
    </SafeAreaView>
  );
};
  cameraBottomBar: {
    position: "absolute",
    left: 7,
    right: 7,
    bottom: 7,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  cameraBottomText: {
    color: "#dce8f3",
    fontSize: 10,
    fontWeight: "700",
  },

  cameraControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  cameraControlButton: {
    minWidth: 34,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(10,25,42,0.88)",
    borderWidth: 1,
    borderColor: "#29415b",
  },

  cameraControlButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },

  layoutRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },

  layoutButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#13243a",
    borderWidth: 1,
    borderColor: "#29415b",
  },

  layoutButtonActive: {
    backgroundColor: "#1b5d91",
    borderColor: "#3986c5",
  },

  layoutButtonText: {
    color: "#9db2c5",
    fontSize: 
  flexButton: {
    flex: 1,
  },

  disabledText: {
    opacity: 0.45,
  },

  infoBox: {
    backgroundColor: "#0d2032",
    borderWidth: 1,
    borderColor: "#24435c",
    borderRadius: 9,
    padding: 10,
    marginTop: 10,
  },

  infoText: {
    color: "#9db4c7",
    fontSize: 11,
    lineHeight: 17,
  },

  topStatus: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: "#12253b",
    marginBottom: 10,
  },

  topStatusText: {
    color: "#9db2c5",
    fontSize: 11,
    lineHeight: 16,
  },

  headerStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 5,
  },

  headerStatusOnline: {
    backgroundColor: "#52d38a",
  },

  headerStatusOffline: {
    backgroundColor: "#d66a6a",
  },

  app: {
    flex: 1,
    backgroundColor: "#07111f",
  },

  main: {
    flex: 1,
    backgroundColor: "#07111f",
  },

  headerTitleWrap: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },

  marqueeClip: {
    height: 22,
    overflow: "hidden",
    marginTop: 2,
  },

  appSubtitle: {
    color: "#8fa6bd",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },

  centerText: {
    color: "#8297aa",
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
  },

  saveHint: {
    marginTop: 8,
    color: "#6f7d8b",
    fontSize: 11,
    lineHeight: 16,
  },

  logoActionRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    marginTop: 8,
  },

  logoPreview: {
    width: 120,
    height: 80,
    marginTop: 10,
    alignSelf: "center",
  },

  logoEmptyPreview: {
    height: 80,
    marginTop: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#20364d",
    backgroundColor: "#07111d",
    alignItems: "center",
    justifyContent: "center",
  },

  logoEmptyText: {
    color: "#667483",
    fontSize: 11,
  },

  logoUriText: {
    color: "#667f94",
    fontSize: 9,
    lineHeight: 14,
    marginTop: 7,
  },

  saveButton: {
    minHeight: 44,
    marginTop: 10,
    borderRadius: 9,
    backgroundColor: "#1c587f",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 15,
  },

  saveButtonSaved: {
    backgroundColor: "#245f46",
  },

  saveButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 10,
  },

  sectionHeaderText: {
    flex: 1,
    minWidth: 0,
  },

  cameraMeta: {
    color: "#6f8599",
    fontSize: 9,
    marginTop: 4,
  },

  endpointText: {
    color: "#7890a5",
    fontSize: 10,
    lineHeight: 15,
    marginTop: 5,
  },

  primaryButtonSmall: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#1c587f",
    alignItems: "center",
    justifyContent: "center",
  },

  secondaryButtonSmall: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#13253a",
    borderWidth: 1,
    borderColor: "#29425a",
    alignItems: "center",
    justifyContent: "center",
  },

  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: "#152a40",
  },

  switchTextWrap: {
    flex: 1,
    paddingRight: 12,
  },

  switchTitle: {
    color: "#d3e0eb",
    fontSize: 12,
    fontWeight: "800",
  },

  switchDescription: {
    color: "#71869a",
    fontSize: 10,
    lineHeight: 15,
    marginTop: 3,
  },

  logoHelpText: {
    color: "#71869a",
    fontSize: 10,
    lineHeight: 15,
    marginBottom: 8,
  },

  layoutHint: {
    color: "#71869a",
    fontSize: 10,
    lineHeight: 15,
  },

  contentContainer: {
    paddingBottom: 90,
  },

  sectionHeaderTextWrap: {
    flex: 1,
    minWidth: 0,
  },

  cameraIconBox: {
    width: 38,
    height: 38,
    borderRadius: 9,
    backgroundColor: "#13263b",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 9,
  },

  cameraIcon: {
    fontSize: 18,
  },

  cameraHeaderText: {
    flex: 1,
    minWidth: 0,
  },

  cameraTitle: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
  },

  cameraSubtitle: {
    color: "#71869a",
    fontSize: 9,
    marginTop: 2,
  },

  cameraStatus: {
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#12253b",
  },

  cameraStatusText: {
    color: "#8fa6bd",
    fontSize: 9,
    fontWeight: "800",
  },

  cameraStatusOnline: {
    color: "#67d39a",
  },

  cameraStatusOffline: {
    color: "#d98787",
  },

  cameraVideoWrap: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#02070d",
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#1b2e44",
  },

  cameraVideo: {
    width: "100%",
    height: "100%",
    backgroundColor: "#000000",
  },

  cameraLoading: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
  },

  cameraLoadingText: {
    color: "#c8d9e7",
    fontSize: 10,
    marginTop: 7,
  },

  cameraControls: {
    position: "absolute",
    left: 7,
    right: 7,
    bottom: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  cameraControlButton: {
    minWidth: 34,
    height: 32,
    paddingHorizontal: 8,
    borderRadius: 7,
    backgroundColor: "rgba(0,0,0,0.75)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },

  cameraControlText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
  },

  cameraControlGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },

  cameraZoomText: {
    color: "#b5c7d7",
    fontSize: 9,
    fontWeight: "800",
    marginHorizontal: 4,
  },

  cameraFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 7,
  },

  cameraFooterText: {
    flex: 1,
    color: "#71869a",
    fontSize: 9,
  },

  cameraFooterStatus: {
    color: "#77c99b",
    fontSize: 9,
    fontWeight: "800",
  },

  cameraFooterStatusOffline: {
    color: "#d98787",
  },

  urlText: {
    color: "#667f94",
    fontSize: 9,
    lineHeight: 14,
  },

  cardTitle: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 8,
  },

  cardDescription: {
    color: "#71869a",
    fontSize: 10,
    lineHeight: 15,
    marginBottom: 8,
  },

  searchButton: {
    minHeight: 42,
    paddingHorizontal: 15,
    borderRadius: 9,
    backgroundColor: "#1c587f",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },

  searchButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
  },
  cameraIcon: {
    fontSize: 19,
  },

  cameraCardInfo: {
    flex: 1,
    minWidth: 0,
  },

  cameraName: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },

  cameraMeta: {
    color: "#71869a",
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },

  endpointText: {
    color: "#60768a",
    fontSize: 9,
    lineHeight: 14,
    marginTop: 3,
  },

  logoHelpText: {
    color: "#71869a",
    fontSize: 10,
    lineHeight: 15,
    marginTop: 5,
    marginBottom: 8,
  },

  logoActionRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 8,
  },

  logoEmptyPreview: {
    width: 80,
    height: 80,
    borderRadius: 10,
    backgroundColor: "#07111d",
    borderWidth: 1,
    borderColor: "#223b53",
    alignItems: "center",
    justifyContent: "center",
  },

  logoEmptyText: {
    color: "#62788c",
    fontSize: 10,
    textAlign: "center",
    paddingHorizontal: 8,
  },

  logoUriText: {
    color: "#60768a",
    fontSize: 9,
    lineHeight: 14,
    marginTop: 6,
  },

  saveButtonSaved: {
    backgroundColor: "#216448",
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


