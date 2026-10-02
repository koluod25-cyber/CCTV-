import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Video from "react-native-video";

import {
  discoverOnvifCameras,
  type DiscoveredCamera,
} from "../onvif-discovery";

type Tab = "live" | "cameras" | "history" | "settings";

type HistoryItem = {
  id: string;
  url: string;
  time: string;
};

function getCameraUrl(camera: DiscoveredCamera): string {
  if (camera.xaddrs.length > 0) {
    return camera.xaddrs[0];
  }

  return `http://${camera.host}:${camera.port}`;
}

function getHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function isValidStreamUrl(url: string): boolean {
  const value = url.trim();

  return (
    value.startsWith("rtsp://") ||
    value.startsWith("http://") ||
    value.startsWith("https://")
  );
}

export default function HomeScreen() {
  const [activeTab, setActiveTab] = useState<Tab>("live");

  const [cameras, setCameras] = useState<DiscoveredCamera[]>([]);
  const [searching, setSearching] = useState(false);

  const [streamUrl, setStreamUrl] = useState("");
  const [activeStream, setActiveStream] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryItem[]>([]);

  const [showPasswordHint, setShowPasswordHint] = useState(false);

  const cameraCountText = useMemo(() => {
    if (cameras.length === 0) {
      return "Belum ada CCTV ditemukan";
    }

    return `${cameras.length} CCTV ditemukan`;
  }, [cameras.length]);

  async function searchCameras() {
    if (searching) return;

    setSearching(true);

    try {
      const result = await discoverOnvifCameras(7000);

      setCameras(result);

      if (result.length === 0) {
        Alert.alert(
          "CCTV tidak ditemukan",
          "Pastikan HP dan kamera CCTV berada pada jaringan Wi-Fi/LAN yang sama dan kamera mendukung ONVIF."
        );
      } else {
        Alert.alert(
          "Pencarian selesai",
          `${result.length} CCTV berhasil ditemukan.`
        );
      }
    } catch (error) {
      console.error("ONVIF discovery error:", error);

      Alert.alert(
        "Gagal mencari CCTV",
        "Terjadi masalah saat mengakses jaringan lokal. Pastikan izin jaringan sudah diberikan."
      );
    } finally {
      setSearching(false);
    }
  }

  function playStream(url: string) {
    const value = url.trim();

    if (!value) {
      Alert.alert(
        "URL belum diisi",
        "Masukkan alamat RTSP, HTTP, atau HTTPS kamera CCTV."
      );
      return;
    }

    if (!isValidStreamUrl(value)) {
      Alert.alert(
        "URL tidak valid",
        "Gunakan format seperti:\n\nrtsp://user:password@192.168.1.20:554/stream\n\natau\n\nhttp://192.168.1.20:8080/video"
      );
      return;
    }

    setVideoError(null);
    setActiveStream(value);
    setActiveTab("live");

    const item: HistoryItem = {
      id: `${Date.now()}-${Math.random()}`,
      url: value,
      time: new Date().toLocaleString("id-ID"),
    };

    setHistory((previous) => {
      const filtered = previous.filter((entry) => entry.url !== value);

      return [item, ...filtered].slice(0, 20);
    });
  }

  function stopStream() {
    setActiveStream(null);
    setVideoError(null);
  }

  function useDiscoveredCamera(camera: DiscoveredCamera) {
    const url = getCameraUrl(camera);

    setStreamUrl(url);

    Alert.alert(
      "CCTV ditemukan",
      `Alamat perangkat:\n${camera.host}:${camera.port}\n\nXAddr ONVIF sudah dimasukkan ke kolom alamat.\n\nCatatan: XAddr ONVIF biasanya adalah alamat layanan ONVIF, bukan otomatis alamat video RTSP. Jika video tidak tampil, masukkan RTSP URL kamera secara manual.`
    );

    setActiveTab("live");
  }

  function openHistory(item: HistoryItem) {
    setStreamUrl(item.url);
    playStream(item.url);
  }

  function clearHistory() {
    Alert.alert(
      "Hapus riwayat?",
      "Semua riwayat alamat stream akan dihapus.",
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
  }

  function renderLive() {
    return (
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>Live CCTV</Text>
            <Text style={styles.sectionSubtitle}>
              Pantau kamera secara langsung
            </Text>
          </View>

          {activeStream ? (
            <Pressable style={styles.stopButton} onPress={stopStream}>
              <Text style={styles.stopButtonText}>Stop</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.videoContainer}>
          {activeStream ? (
            <>
              <Video
                source={{ uri: activeStream }}
                style={styles.video}
                controls
                resizeMode="contain"
                paused={false}
                playInBackground={false}
                playWhenInactive={false}
                onLoadStart={() => {
                  setVideoError(null);
                }}
                onError={(error) => {
                  console.error("Video playback error:", error);

                  setVideoError(
                    "Video tidak dapat diputar. Periksa URL RTSP/HTTP, username/password, port, dan pastikan kamera dapat diakses dari jaringan HP."
                  );
                }}
              />

              {videoError ? (
                <View style={styles.videoErrorOverlay}>
                  <Text style={styles.videoErrorTitle}>
                    Gagal menampilkan video
                  </Text>

                  <Text style={styles.videoErrorText}>{videoError}</Text>

                  <Pressable
                    style={styles.retryButton}
                    onPress={() => {
                      const current = activeStream;

                      setActiveStream(null);
                      setVideoError(null);

                      setTimeout(() => {
                        setActiveStream(current);
                      }, 150);
                    }}
                  >
                    <Text style={styles.retryButtonText}>Coba Lagi</Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          ) : (
            <View style={styles.emptyVideo}>
              <Text style={styles.emptyVideoIcon}>◉</Text>

              <Text style={styles.emptyVideoTitle}>
                Belum ada Live CCTV
              </Text>

              <Text style={styles.emptyVideoText}>
                Masukkan alamat stream CCTV di bawah, atau cari kamera ONVIF.
              </Text>
            </View>
          )}
        </View>

        {activeStream ? (
          <View style={styles.currentStreamCard}>
            <Text style={styles.cardLabel}>STREAM AKTIF</Text>

            <Text style={styles.currentStream} numberOfLines={2}>
              {activeStream}
            </Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Alamat Live CCTV</Text>

          <Text style={styles.helpText}>
            Masukkan URL video CCTV. Untuk kamera IP, format yang umum adalah
            RTSP.
          </Text>

          <TextInput
            value={streamUrl}
            onChangeText={setStreamUrl}
            placeholder="rtsp://user:password@192.168.1.20:554/stream"
            placeholderTextColor="#697386"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.input}
          />

          <View style={styles.buttonRow}>
            <Pressable
              style={[styles.primaryButton, styles.flexButton]}
              onPress={() => playStream(streamUrl)}
            >
              <Text style={styles.primaryButtonText}>Tampilkan Live</Text>
            </Pressable>

            <Pressable
              style={[styles.secondaryButton, styles.flexButton]}
              onPress={() => setActiveTab("cameras")}
            >
              <Text style={styles.secondaryButtonText}>Cari CCTV</Text>
            </Pressable>
          </View>

          <Pressable
            onPress={() => setShowPasswordHint((value) => !value)}
            style={styles.hintButton}
          >
            <Text style={styles.hintButtonText}>
              {showPasswordHint
                ? "Sembunyikan contoh"
                : "Lihat contoh URL kamera"}
            </Text>
          </Pressable>

          {showPasswordHint ? (
            <View style={styles.exampleBox}>
              <Text style={styles.exampleTitle}>Contoh</Text>

              <Text style={styles.exampleText}>
                rtsp://admin:password@192.168.1.20:554/stream
              </Text>

              <Text style={styles.exampleText}>
                rtsp://admin:password@192.168.1.20:554/h264Preview_01_main
              </Text>

              <Text style={styles.exampleNote}>
                Path RTSP berbeda-beda menurut merek dan model CCTV.
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Status</Text>

          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                activeStream ? styles.statusOnline : styles.statusOffline,
              ]}
            />

            <Text style={styles.statusText}>
              {activeStream
                ? `Mencoba memutar ${getHost(activeStream)}`
                : "Tidak ada stream aktif"}
            </Text>
          </View>
        </View>
      </ScrollView>
    );
  }

  function renderCameras() {
    return (
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
      >
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>CCTV</Text>
            <Text style={styles.sectionSubtitle}>{cameraCountText}</Text>
          </View>

          <Pressable
            style={styles.searchButton}
            onPress={searchCameras}
            disabled={searching}
          >
            {searching ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.searchButtonText}>Cari CCTV</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Deteksi ONVIF</Text>

          <Text style={styles.infoText}>
            Tekan "Cari CCTV" untuk mencari kamera ONVIF pada jaringan lokal.
            HP dan CCTV harus terhubung ke jaringan yang sama.
          </Text>
        </View>

        {cameras.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>⌁</Text>

            <Text style={styles.emptyTitle}>
              Belum ada kamera ditemukan
            </Text>

            <Text style={styles.emptyText}>
              Jalankan pencarian ONVIF. Jika kamera terdeteksi tetapi Live tidak
              tampil, gunakan alamat RTSP kamera secara manual pada menu Live.
            </Text>

            <Pressable
              style={styles.primaryButton}
              onPress={searchCameras}
              disabled={searching}
            >
              {searching ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.primaryButtonText}>Cari Sekarang</Text>
              )}
            </Pressable>
          </View>
        ) : (
          cameras.map((camera, index) => (
            <View
              key={`${camera.host}:${camera.port}-${index}`}
              style={styles.cameraCard}
            >
              <View style={styles.cameraHeader}>
                <View style={styles.cameraIcon}>
                  <Text style={styles.cameraIconText}>CCTV</Text>
                </View>

                <View style={styles.cameraHeaderText}>
                  <Text style={styles.cameraName}>
                    Kamera {index + 1}
                  </Text>

                  <Text style={styles.cameraAddress}>
                    {camera.host}:{camera.port}
                  </Text>
                </View>

                <View style={styles.detectedBadge}>
                  <Text style={styles.detectedBadgeText}>TERDETEKSI</Text>
                </View>
              </View>

              <View style={styles.detailBlock}>
                <Text style={styles.detailLabel}>XADDR ONVIF</Text>

                {camera.xaddrs.length > 0 ? (
                  camera.xaddrs.map((xaddr, xaddrIndex) => (
                    <Text
                      key={`${xaddr}-${xaddrIndex}`}
                      style={styles.detailValue}
                      numberOfLines={2}
                    >
                      {xaddr}
                    </Text>
                  ))
                ) : (
                  <Text style={styles.detailValue}>Tidak tersedia</Text>
                )}
              </View>

              <View style={styles.detailBlock}>
                <Text style={styles.detailLabel}>TYPES</Text>

                <Text style={styles.detailValue} numberOfLines={3}>
                  {camera.types || "Tidak tersedia"}
                </Text>
              </View>

              <View style={styles.detailBlock}>
                <Text style={styles.detailLabel}>SCOPES</Text>

                <Text style={styles.detailValue} numberOfLines={4}>
                  {camera.scopes || "Tidak tersedia"}
                </Text>
              </View>

              <View style={styles.cameraActions}>
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => useDiscoveredCamera(camera)}
                >
                  <Text style={styles.primaryButtonText}>Atur Live</Text>
                </Pressable>

                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => {
                    setStreamUrl(`rtsp://${camera.host}:554/`);
                    setActiveTab("live");
                  }}
                >
                  <Text style={styles.secondaryButtonText}>
                    Isi RTSP
                  </Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    );
  }

  function renderHistory() {
    return (
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
      >
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>Riwayat</Text>
            <Text style={styles.sectionSubtitle}>
              Alamat stream yang pernah digunakan
            </Text>
          </View>

          {history.length > 0 ? (
            <Pressable style={styles.dangerButton} onPress={clearHistory}>
              <Text style={styles.dangerButtonText}>Hapus</Text>
            </Pressable>
          ) : null}
        </View>

        {history.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>◷</Text>

            <Text style={styles.emptyTitle}>
              Belum ada riwayat
            </Text>

            <Text style={styles.emptyText}>
              Stream yang berhasil Anda masukkan akan muncul di sini.
            </Text>
          </View>
        ) : (
          history.map((item) => (
            <Pressable
              key={item.id}
              style={styles.historyCard}
              onPress={() => openHistory(item)}
            >
              <View style={styles.historyIcon}>
                <Text style={styles.historyIconText}>▶</Text>
              </View>

              <View style={styles.historyBody}>
                <Text style={styles.historyUrl} numberOfLines={2}>
                  {item.url}
                </Text>

                <Text style={styles.historyTime}>{item.time}</Text>
              </View>

              <Text style={styles.historyArrow}>›</Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    );
  }

  function renderSettings() {
    return (
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
      >
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>Pengaturan</Text>
            <Text style={styles.sectionSubtitle}>
              Pengaturan koneksi dan Live CCTV
            </Text>
          </View>
        </View>

        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>Jaringan</Text>

          <View style={styles.settingsRow}>
            <Text style={styles.settingsLabel}>ONVIF Discovery</Text>
            <Text style={styles.settingsValue}>Aktif</Text>
          </View>

          <View style={styles.settingsRow}>
            <Text style={styles.settingsLabel}>UDP Multicast</Text>
            <Text style={styles.settingsValue}>Port 3702</Text>
          </View>

          <View style={styles.settingsRow}>
            <Text style={styles.settingsLabel}>Jaringan lokal</Text>
            <Text style={styles.settingsValue}>Diperlukan</Text>
          </View>
        </View>

        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>Live Video</Text>

          <Text style={styles.settingsDescription}>
            Pemutaran RTSP menggunakan native video player Android. Karena itu,
            APK harus dibuat ulang setelah konfigurasi native video diterapkan.
          </Text>

          <View style={styles.settingsRow}>
            <Text style={styles.settingsLabel}>RTSP</Text>
            <Text style={styles.settingsValue}>Didukung</Text>
          </View>

          <View style={styles.settingsRow}>
            <Text style={styles.settingsLabel}>HTTP / HTTPS</Text>
            <Text style={styles.settingsValue}>Didukung</Text>
          </View>
        </View>

        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>Catatan Penting</Text>

          <Text style={styles.settingsDescription}>
            Hasil pencarian ONVIF memberikan alamat layanan kamera (XAddr).
            XAddr tidak selalu merupakan alamat video. Untuk menampilkan
            gambar, aplikasi membutuhkan URI stream media, biasanya berupa
            alamat RTSP.
          </Text>

          <Text style={styles.settingsDescription}>
            Jika kamera Anda mempunyai username dan password, masukkan keduanya
            pada URL RTSP sesuai format yang didukung kamera.
          </Text>
        </View>
      </ScrollView>
    );
  }

  function renderContent() {
    switch (activeTab) {
      case "live":
        return renderLive();

      case "cameras":
        return renderCameras();

      case "history":
        return renderHistory();

      case "settings":
        return renderSettings();

      default:
        return renderLive();
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.app}>
        <View style={styles.header}>
          <View>
            <Text style={styles.appTitle}>CCTV Universal Monitor</Text>
            <Text style={styles.appSubtitle}>
              ONVIF • RTSP • Live Monitor
            </Text>
          </View>

          <View style={styles.headerStatus}>
          
