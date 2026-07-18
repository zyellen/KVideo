/**
 * AirPlay 设备发现（仅服务端使用）
 *
 * 苹果设备（Apple TV 等）使用 AirPlay 协议，基于 mDNS/Bonjour 广播，
 * 并不响应 DLNA/SSDP 搜索，因此标准 SSDP 发现无法找到它们。
 *
 * 本模块通过向 mDNS 组播地址发送 `_airplay._tcp.local` 的 PTR 查询，
 * 解析局域网内的 AirPlay 接收端，使兼容模式下能在投屏列表中呈现苹果设备。
 *
 * 注意：AirPlay 实际投屏使用独立的 RTSP 协议（非 DLNA SOAP），
 * 本模块仅负责「发现」，控制请引导用户使用设备自带屏幕镜像功能。
 *
 * 必须运行在 Node.js 运行时（runtime = 'nodejs'），且与设备处于同一局域网。
 */

import dgram from 'node:dgram';

/** 发现的 AirPlay 设备 */
export interface AirPlayDevice {
  /** 设备唯一标识 */
  id: string;
  /** 设备展示名称 */
  name: string;
  /** 设备 IP 地址 */
  address: string;
  /** 设备端口（AirPlay 默认 7000） */
  port: number;
  /** 标记用的控制地址（airplay:// 协议，仅供识别） */
  controlUrl: string;
  /** 协议标识 */
  protocol: 'airplay';
}

const MDNS_ADDRESS = '224.0.0.251';
const MDNS_PORT = 5353;
const AIRPLAY_SERVICE = '_airplay._tcp.local';
const AIRPLAY_DEFAULT_PORT = 7000;

/**
 * 解码 DNS 报文中的长度前缀域名（兼容压缩指针）
 */
function decodeName(msg: Buffer, offset: number): { name: string; next: number } {
  const labels: string[] = [];
  let pos = offset;
  // 记录已访问的指针偏移，避免压缩指针造成的死循环
  const visited = new Set<number>();
  while (pos < msg.length) {
    const len = msg[pos];
    if (len === 0) {
      return { name: labels.join('.'), next: pos + 1 };
    }
    if ((len & 0xc0) === 0xc0) {
      const pointer = ((len & 0x3f) << 8) | msg[pos + 1];
      if (visited.has(pointer)) break;
      visited.add(pointer);
      const { name } = decodeName(msg, pointer);
      labels.push(name);
      return { name: labels.join('.'), next: pos + 2 };
    }
    labels.push(msg.slice(pos + 1, pos + 1 + len).toString('utf8'));
    pos += len + 1;
  }
  return { name: labels.join('.'), next: pos + 1 };
}

/**
 * 构造查询 `_airplay._tcp.local` 的 mDNS PTR 报文
 *
 * 使用 IN 类别（非单播响应），使响应以组播形式发出，便于本套接字接收。
 */
function buildPtrQuery(service: string): Buffer {
  const parts: Buffer[] = [];
  for (const label of service.split('.')) {
    const buf = Buffer.from(label, 'utf8');
    parts.push(Buffer.from([buf.length]), buf);
  }
  parts.push(Buffer.from([0])); // 根标签结束
  const nameBuf = Buffer.concat(parts);

  const header = Buffer.from([
    0x00, 0x00, // 事务 ID（占位）
    0x00, 0x00, // 标准查询，期望递归
    0x00, 0x01, // 1 个问题
    0x00, 0x00, // 回答数
    0x00, 0x00, // 权威数
    0x00, 0x00, // 附加数
  ]);
  const question = Buffer.concat([
    nameBuf,
    Buffer.from([0x00, 0x0c]), // TYPE = PTR
    Buffer.from([0x00, 0x01]), // CLASS = IN
  ]);
  return Buffer.concat([header, question]);
}

/**
 * 从 mDNS 响应中解析 AirPlay 设备实例
 *
 * 响应源地址即为设备 IP；PTR 记录的 RDATA 为实例名，形如
 * `客厅的 Apple TV._airplay._tcp.local`，去掉服务后缀即得展示名。
 */
function parseAirPlayResponse(msg: Buffer, rinfo: dgram.RemoteInfo): AirPlayDevice | null {
  try {
    let pos = 12; // 跳过 12 字节 DNS 头
    const qdcount = msg.readUInt16BE(4);
    const ancount = msg.readUInt16BE(6);

    // 跳过问题段
    for (let i = 0; i < qdcount; i += 1) {
      const { next } = decodeName(msg, pos);
      pos = next + 4; // 跳过 TYPE + CLASS
    }

    for (let i = 0; i < ancount; i += 1) {
      const { name, next } = decodeName(msg, pos);
      const type = msg.readUInt16BE(next);
      const rdataOffset = next + 10; // 跳过 TYPE(2)+CLASS(2)+TTL(4)+RDLENGTH(2)
      const rdlen = msg.readUInt16BE(next + 8);

      if (type === 12 && name.toLowerCase().endsWith(AIRPLAY_SERVICE)) {
        const { name: instance } = decodeName(msg, rdataOffset);
        const friendlyName = instance.replace(/\._airplay\._tcp\.local$/i, '');
        return {
          id: `${friendlyName}@${rinfo.address}`,
          name: friendlyName,
          address: rinfo.address,
          port: AIRPLAY_DEFAULT_PORT,
          controlUrl: `airplay://${rinfo.address}:${AIRPLAY_DEFAULT_PORT}`,
          protocol: 'airplay',
        };
      }
      pos = rdataOffset + rdlen;
    }
  } catch (err) {
    console.warn('[AirPlay] 解析 mDNS 响应失败:', err);
  }
  return null;
}

/**
 * 通过 mDNS 发现局域网内的 AirPlay 设备
 *
 * @param timeoutMs 发现超时时间（毫秒）
 * @returns 去重后的 AirPlay 设备列表
 */
export function discoverAirPlayDevices(timeoutMs = 4000): Promise<AirPlayDevice[]> {
  return new Promise((resolve) => {
    let socket: dgram.Socket;
    try {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    } catch (err) {
      console.error('[AirPlay] 创建 mDNS 套接字失败:', err);
      resolve([]);
      return;
    }

    const found = new Map<string, AirPlayDevice>();
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      try {
        socket.close();
      } catch {
        // 忽略关闭异常
      }
      resolve([...found.values()]);
    };

    socket.on('error', (err) => {
      console.error('[AirPlay] mDNS 套接字错误:', err);
    });

    socket.on('message', (msg, rinfo) => {
      const device = parseAirPlayResponse(msg, rinfo);
      if (device) found.set(device.id, device);
    });

    socket.on('listening', () => {
      try {
        socket.addMembership(MDNS_ADDRESS);
      } catch (err) {
        console.warn('[AirPlay] 加入 mDNS 组播组失败:', err);
      }
      const query = buildPtrQuery(AIRPLAY_SERVICE);
      const send = () =>
        socket.send(query, MDNS_PORT, MDNS_ADDRESS, (err) => {
          if (err) console.error('[AirPlay] 发送 mDNS 查询失败:', err);
        });
      // 立即发送，并在超时中段重试一次以提升命中率
      send();
      setTimeout(send, Math.floor(timeoutMs / 2));
    });

    try {
      socket.bind(MDNS_PORT);
    } catch (err) {
      console.error('[AirPlay] 绑定 mDNS 端口失败（可能被系统 mDNS 服务占用）:', err);
      resolve([]);
      return;
    }

    setTimeout(finish, timeoutMs);
  });
}
