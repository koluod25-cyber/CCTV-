# CCTV Universal Monitor

Aplikasi Android Expo untuk menemukan kamera CCTV yang mendukung ONVIF melalui jaringan lokal.

## Fitur tahap ini

- Tombol **Cari CCTV**
- ONVIF WS-Discovery
- UDP multicast `239.255.255.250:3702`
- Deteksi `XAddrs`, IP/host, port, Types, dan Scopes
- Dukungan multicast Android melalui `@isvend/expo-udp`
- GitHub Actions untuk membangun APK release

## Catatan

HP Android dan CCTV harus berada pada jaringan LAN/Wi-Fi yang sama. Kamera harus mengaktifkan ONVIF/WS-Discovery jika fitur tersebut tersedia.

Tahap berikutnya dapat menambahkan login ONVIF, pengambilan profile/media URI, dan live view RTSP.
