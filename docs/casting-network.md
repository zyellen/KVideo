# 投屏（DLNA / AirPlay）网络与部署说明

KVideo 的「投屏到设备」功能依赖局域网组播/广播来发现电视、盒子等设备：

- **DLNA / UPnP（当贝、小米、索尼等电视/盒子）**：使用 **SSDP** 协议，向组播地址 `239.255.255.250:1900` 发送 `M-SEARCH` 广播并等待设备响应。
- **Apple AirPlay（Apple TV 等）**：使用 **mDNS / Bonjour** 协议，向组播地址 `224.0.0.251:5353` 发送 `_airplay._tcp.local` 查询。

> 关键点：**这两种发现机制都依赖 UDP 组播，且要求「运行发现的进程」与「投屏设备」处于同一广播域（同一局域网、同一网段）。** 只要中间隔了一层虚拟网络（VM / NAT），组播包就到不了真机，设备列表就会为空。

---

## 一、哪些情况可以投屏，哪些不行

| 运行方式 | 能否发现设备 | 原因 |
|---|---|---|
| 本机原生运行 `pnpm dev`（Mac / Win / Linux） | ✅ 可以 | Node 进程直接在宿主机网卡上收发组播，和电视在同一局域网 |
| 本机原生运行 `pnpm build && pnpm start`（Mac / Win / Linux） | ✅ 可以 | 同上，只要进程在宿主机网络上 |
| Linux 主机 / NAS 上的 Docker + `network_mode: host` | ✅ 可以 | 容器共享宿主真实网络命名空间，宿主网卡就在局域网内 |
| macOS 上的 Docker Desktop | ❌ 不行 | 容器跑在 LinuxKit 虚拟机里，`host` 网络只到 VM，到不了 Mac 的局域网 |
| Windows 上的 Docker Desktop（WSL2 / Hyper-V 后端） | ❌ 不行 | 容器跑在 WSL2 / Moby VM 里，Docker Desktop 不支持把 `host` 网络映射到宿主机 LAN |
| 任意平台 Docker 默认 `bridge` 网络（含 `ports:` 映射） | ❌ 不行 | 容器有独立私有 IP，和局域网不在同一广播域，组播出不去 |

---

## 二、为什么「Docker 不行，但本地 dev 行」

- 本地 `pnpm dev`：Node 进程直接跑在你的电脑上，电脑网卡连着局域网，组播能直接发给电视。
- Docker（macOS / Windows）：Docker Desktop 实际是在一个 **隐藏的 Linux 虚拟机（VM）** 里跑容器。即便写了 `network_mode: host`，这个 "host" 指的是 **那个 VM 的网络**，不是你电脑的局域网。组播从 VM 发出去就停在了 VM 内，客厅的电视收不到。
- 这不是配置没配对，是 **平台架构限制**：多了一层 VM 隔离，组播就跨不过去。

> 常见误解：「NAS 上不也是 Docker 吗，为什么能投屏？」
> NAS 本身是 Linux，Docker 直接运行在宿主内核上，**没有中间 VM**。`network_mode: host` 让容器共享 NAS 真实的局域网网卡，所以组播能到达电视。区别在「容器里的 host 网络是不是真的局域网」。

---

## 三、各平台部署建议

### ✅ macOS / Windows（开发或本机使用）
不要走 Docker，直接原生运行：

```bash
# Mac / Windows 终端
ALLOW_LAN_ACCESS=true pnpm dev
```

- `ALLOW_LAN_ACCESS=true` 会把服务绑定到 `0.0.0.0`，使同局域网设备能访问。
- 电视回源拉流地址为 `http://<本机局域网IP>:3000/...`，确保该端口对局域网可访问。
- 兼容模式（见第四节）默认在投屏菜单内可开启，用于搜索难发现的当贝 / 苹果设备。

### ✅ Linux 主机 / NAS（推荐做常驻服务）
修改部署配置，让容器共享宿主网络：

```yaml
# docker-compose.yml（Linux 适用）
services:
  redis-rest:
    image: hiett/serverless-redis-http:latest
    container_name: kvideo-redis-rest
    restart: always
    environment:
      - SRH_MODE=env
      - SRH_TOKEN=local-dev-token
      - SRH_CONNECTION_STRING=redis://redis:6379
      - PORT=80
    ports:
      - "18080:80"          # 暴露到宿主机，供 host 模式的 kvideo 访问
    depends_on:
      - redis

  kvideo:
    container_name: kvideo
    build:
      context: .
      dockerfile: Dockerfile
    restart: always
    network_mode: host       # 关键：共享宿主真实网络，组播可达局域网
    env_file:
      - .env.local
    environment:
      - NODE_ENV=production
      # host 模式下容器不在 compose 网络内，需用宿主机回环访问 redis-rest
      - UPSTASH_REDIS_REST_URL=http://127.0.0.1:18080
      - UPSTASH_REDIS_REST_TOKEN=local-dev-token
    depends_on:
      - redis-rest
```

注意事项：
- `network_mode: host` 下 `ports:` 映射会被忽略，`kvideo` 直接使用宿主的 `3000`。
- 群晖 Container Manager / 威联通 Container Station 即原生 Linux Docker，对应选项为「使用与 Docker Host 相同的网络」。
- `host` 模式不走端口映射，需在 NAS 防火墙/控制台确认 `3000`、`1900(UDP)`、`5353(UDP)` 对局域网开放。

### ❌ macOS / Windows 上的 Docker Desktop
**无法用于投屏发现**，无论怎么改 `docker-compose.yml` 都没用（因为中间那层 VM）。
如需在 Docker 中常驻，请把服务部署到一台 **Linux 机器**（NAS、小主机、同局域网云服务器）。

---

## 四、兼容模式（提升设备发现率）

投屏菜单内提供「兼容模式」开关（偏好持久化到浏览器 `localStorage`）：

- **关闭（默认）**：仅发送标准 DLNA 搜索 `ST: urn:schemas-upnp-org:service:AVTransport:1`，速度快、负载低。
- **开启**：
  1. 对多种 SSDP 搜索类型广播（`ssdp:all`、`upnp:rootdevice`、`MediaRenderer`、`AVTransport`），显著提升对**当贝等仅响应特定广播类型的设备**的命中率，并加大重试与超时。
  2. 额外通过 **mDNS 发现 Apple AirPlay 设备**，使 Apple TV 等出现在列表中（带 `AirPlay` 徽标）。

> 说明：AirPlay 使用独立的 RTSP 协议（非 DLNA SOAP），当前版本仅做「发现与列出」，点击后会提示「请使用设备自带的屏幕镜像功能完成投屏」。DLNA 设备（含当贝）开启兼容模式后可正常直接投屏。

---

## 五、排查清单

发现列表为空时，按顺序确认：

1. 电视/盒子已开启投屏，且与运行 KVideo 的机器在**同一局域网、同一网段**。
2. 运行方式属于上表「✅ 可以」的情况（原生运行 或 Linux Docker host 模式）。
3. 已开启「兼容模式」并点「刷新」。
4. 防火墙未阻断 `1900/UDP`（SSDP）与 `5353/UDP`（mDNS）。
5. 投屏后电视能访问 `http://<服务器IP>:3000/...`（HLS 流部分电视/盒子不支持，建议投 MP4）。
