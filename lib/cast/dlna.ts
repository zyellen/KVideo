/**
 * DLNA / UPnP-AV 局域网投屏核心逻辑（仅服务端使用）
 *
 * 通过 SSDP 广播发现局域网内的媒体渲染设备（智能电视、盒子等），
 * 并使用 SOAP 调用其 AVTransport 服务实现播放 / 暂停 / 停止 / 跳转。
 * 全部基于 Node 内置模块实现，无需引入额外依赖。
 *
 * 注意：本模块必须在 Node.js 运行环境（runtime = 'nodejs'）下执行，
 * 且服务进程需与投屏设备处于同一局域网（容器部署时通常需要 host 网络）。
 */

import dgram from 'node:dgram';

/** 发现的局域网投屏设备 */
export interface DlnaDevice {
  /** 设备唯一标识（来自设备描述 XML 的 UDN） */
  id: string;
  /** 设备展示名称 */
  name: string;
  /** AVTransport 控制地址（绝对地址，用于 SOAP 调用） */
  controlUrl: string;
  /** 设备描述地址 */
  descriptionUrl: string;
  /** 设备型号（可选） */
  modelName?: string;
  /** 设备协议：dlna 为标准 DLNA/UPnP，airplay 为苹果 AirPlay */
  protocol?: 'dlna';
}

/** 控制动作的统一返回结构 */
export interface DlnaActionResult {
  ok: boolean;
  error?: string;
}

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const AV_TRANSPORT_SERVICE_TYPE = 'urn:schemas-upnp-org:service:AVTransport:1';

/**
 * 在 XML 中提取指定标签的文本内容
 */
function matchTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * 将可能为相对路径的 URL 基于基址解析为绝对地址
 */
function resolveUrl(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

/**
 * 转义 XML 特殊字符，用于构造 SOAP 请求体
 */
function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      default:
        return '&quot;';
    }
  });
}

/**
 * 将秒数格式化为 REL_TIME（HH:MM:SS）
 */
function formatRelTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return [hours, minutes, secs].map((n) => String(n).padStart(2, '0')).join(':');
}

/**
 * 解析 SSDP 响应 / NOTIFY 报文，提取 LOCATION 与 USN
 */
function parseSsdpMessage(data: Buffer): { location?: string; usn?: string } | null {
  const text = data.toString('utf8');
  const locationMatch = text.match(/LOCATION:\s*(.+)\r?\n/i);
  const usnMatch = text.match(/USN:\s*(.+)\r?\n/i);
  if (!locationMatch) return null;
  return {
    location: locationMatch[1].trim(),
    usn: usnMatch ? usnMatch[1].trim() : undefined,
  };
}

/**
 * 从设备描述 XML 中查找 AVTransport 服务的控制地址
 */
function findAvTransportControlUrl(xml: string, baseUrl: string): string | null {
  const serviceBlocks = xml.match(/<service>[\s\S]*?<\/service>/g) ?? [];
  for (const block of serviceBlocks) {
    if (block.includes('AVTransport')) {
      const control = matchTag(block, 'controlURL');
      if (control) return resolveUrl(control, baseUrl);
    }
  }
  return null;
}

/**
 * 构造 DIDL-Lite 元数据，用于向设备传递标题等信息
 */
function buildMetadata(mediaUrl: string, title: string): string {
  const didl = `<?xml version="1.0" encoding="utf-8"?>
<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
  <item id="0" parentID="-1" restricted="0">
    <dc:title>${title}</dc:title>
    <upnp:class>object.item.videoItem.movie</upnp:class>
    <res>${mediaUrl}</res>
  </item>
</DIDL-Lite>`;
  return didl;
}

/**
 * 解析单个设备描述地址，提取投屏所需信息
 */
async function resolveDevice(location: string): Promise<DlnaDevice | null> {
  try {
    const response = await fetch(location, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const xml = await response.text();
    const name = matchTag(xml, 'friendlyName') ?? '未知设备';
    const modelName = matchTag(xml, 'modelName') ?? undefined;
    const controlUrl = findAvTransportControlUrl(xml, location);
    if (!controlUrl) return null;
    const id = matchTag(xml, 'UDN') ?? location;
    return { id, name, controlUrl, descriptionUrl: location, modelName, protocol: 'dlna' };
  } catch (error) {
    console.warn('[DLNA] 解析设备失败:', location, error);
    return null;
  }
}

/**
 * 投屏设备发现选项
 */
export interface DiscoverOptions {
  /**
   * 兼容模式：使用更多 ST 类型、更积极的重试与更长超时，
   * 以命中仅响应特定广播类型（如 upnp:rootdevice / MediaRenderer）或
   * 响应较慢的 DLNA 设备（如部分电视 / 盒子品牌）。
   */
  compatibility?: boolean;
}

/** 默认搜索类型：标准 DLNA 媒体渲染服务 */
const SSDP_DEFAULT_ST_TYPES = [AV_TRANSPORT_SERVICE_TYPE];

/** 兼容模式下追加的搜索类型，覆盖更多厂商实现 */
const SSDP_COMPAT_ST_TYPES = [
  'ssdp:all',
  'upnp:rootdevice',
  'urn:schemas-upnp-org:device:MediaRenderer:1',
  'urn:schemas-upnp-org:service:AVTransport:1',
];

/**
 * 构造一条针对指定 ST 的 SSDP M-SEARCH 报文
 */
function buildMSearch(st: string): Buffer {
  return Buffer.from(
    [
      'M-SEARCH * HTTP/1.1',
      `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
      'MAN: "ssdp:discover"',
      'MX: 3',
      `ST: ${st}`,
      '',
      '',
    ].join('\r\n'),
  );
}

/**
 * 发送 SSDP M-SEARCH 广播并收集局域网内的投屏设备
 *
 * 兼容模式下会针对多种 ST 类型广播，显著提升难发现设备的命中率。
 *
 * @param timeoutMs 设备发现超时时间（毫秒）
 * @param options 发现选项（兼容模式开关）
 * @returns 去重后的设备列表
 */
export function discoverDlnaDevices(
  timeoutMs = 5000,
  options: DiscoverOptions = {},
): Promise<DlnaDevice[]> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    // 以 location 为键去重，避免重复响应 / NOTIFY
    const found = new Map<string, string>();

    const stTypes = options.compatibility ? SSDP_COMPAT_ST_TYPES : SSDP_DEFAULT_ST_TYPES;
    const repeats = options.compatibility ? 3 : 2;

    socket.on('message', (msg) => {
      const parsed = parseSsdpMessage(msg);
      if (parsed?.location) {
        found.set(parsed.location, parsed.usn ?? parsed.location);
      }
    });

    socket.on('error', (err) => {
      console.error('[DLNA] SSDP 套接字错误:', err);
    });

    const finish = async () => {
      try {
        socket.close();
      } catch {
        // 忽略关闭异常
      }
      const locations = [...found.keys()];
      const devices = await Promise.all(locations.map(resolveDevice));
      resolve(devices.filter((device): device is DlnaDevice => device !== null));
    };

    socket.bind(0, () => {
      // 针对每种 ST 重复发送若干次以提升发现成功率
      for (const st of stTypes) {
        const message = buildMSearch(st);
        for (let i = 0; i < repeats; i += 1) {
          socket.send(message, SSDP_PORT, SSDP_ADDRESS, (err) => {
            if (err) console.error('[DLNA] 发送 M-SEARCH 失败:', err);
          });
        }
      }
    });

    setTimeout(finish, timeoutMs);
  });
}

/**
 * 发送一次 AVTransport SOAP 请求
 */
async function soapRequest(
  controlUrl: string,
  action: string,
  argsXml: string,
): Promise<DlnaActionResult> {
  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="${AV_TRANSPORT_SERVICE_TYPE}">
      ${argsXml}
    </u:${action}>
  </s:Body>
</s:Envelope>`;

  try {
    const response = await fetch(controlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPACTION: `"${AV_TRANSPORT_SERVICE_TYPE}#${action}"`,
        Connection: 'close',
      },
      body: envelope,
      signal: AbortSignal.timeout(8000),
    });
    const text = await response.text();
    const fault = matchTag(text, 'faultstring') ?? matchTag(text, 'errorDescription');
    if (!response.ok || fault) {
      return { ok: false, error: fault ?? `HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 设置播放地址并立即播放（可指定起始秒数）
 */
export async function dlnaSetAndPlay(
  controlUrl: string,
  mediaUrl: string,
  title: string,
  seekSeconds = 0,
): Promise<DlnaActionResult> {
  const metadata = escapeXml(buildMetadata(mediaUrl, title));
  const setResult = await soapRequest(
    controlUrl,
    'SetAVTransportURI',
    `<InstanceID>0</InstanceID>
      <CurrentURI>${escapeXml(mediaUrl)}</CurrentURI>
      <CurrentURIMetaData>${metadata}</CurrentURIMetaData>`,
  );
  if (!setResult.ok) return setResult;

  if (seekSeconds > 0) {
    await soapRequest(
      controlUrl,
      'Seek',
      `<InstanceID>0</InstanceID>
        <Unit>REL_TIME</Unit>
        <Target>${formatRelTime(seekSeconds)}</Target>`,
    );
  }

  return soapRequest(
    controlUrl,
    'Play',
    `<InstanceID>0</InstanceID>
      <Speed>1</Speed>`,
  );
}

/**
 * 暂停播放
 */
export async function dlnaPause(controlUrl: string): Promise<DlnaActionResult> {
  return soapRequest(controlUrl, 'Pause', `<InstanceID>0</InstanceID>`);
}

/**
 * 继续播放（从设备当前位置）
 */
export async function dlnaResume(controlUrl: string): Promise<DlnaActionResult> {
  return soapRequest(
    controlUrl,
    'Play',
    `<InstanceID>0</InstanceID>
      <Speed>1</Speed>`,
  );
}

/**
 * 停止播放
 */
export async function dlnaStop(controlUrl: string): Promise<DlnaActionResult> {
  return soapRequest(controlUrl, 'Stop', `<InstanceID>0</InstanceID>`);
}

/**
 * 跳转到指定秒数
 */
export async function dlnaSeek(controlUrl: string, seekSeconds: number): Promise<DlnaActionResult> {
  return soapRequest(
    controlUrl,
    'Seek',
    `<InstanceID>0</InstanceID>
      <Unit>REL_TIME</Unit>
      <Target>${formatRelTime(seekSeconds)}</Target>`,
  );
}
