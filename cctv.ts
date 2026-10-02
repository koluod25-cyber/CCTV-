export const CCTV_VENDORS = ["Generic / ONVIF", "Hikvision", "Dahua", "Uniview", "Tiandy", "XMEye / XM", "Axis", "TP-Link VIGI"] as const;
export type CctvVendor = (typeof CCTV_VENDORS)[number];

export function isSupportedStreamUrl(url: string) {
  return /^(rtsp|http|https):\/\/\S+$/i.test(url.trim());
}

export function makeRtspUrl(vendor: CctvVendor, host: string, port = 554, channel = 1, substream = false) {
  const suffix = substream ? "02" : "01";
  switch (vendor) {
    case "Hikvision": return `rtsp://${host}:${port}/Streaming/Channels/${channel}${suffix}`;
    case "Dahua": return `rtsp://${host}:${port}/cam/realmonitor?channel=${channel}&subtype=${substream ? 1 : 0}`;
    case "Uniview": return `rtsp://${host}:${port}/media/video${substream ? 2 : 1}`;
    case "Tiandy": return `rtsp://${host}:${port}/stream${substream ? 2 : 1}`;
    case "XMEye / XM": return `rtsp://${host}:${port}/live`;
    case "Axis": return `rtsp://${host}:${port}/axis-media/media.amp`;
    case "TP-Link VIGI": return `rtsp://${host}:${port}/stream${substream ? "_sub" : ""}`;
    default: return `rtsp://${host}:${port}/`;
  }
}
