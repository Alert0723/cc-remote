/**
 * QR 码连接功能
 * 生成二维码，手机端扫码连接
 */

import { networkInterfaces } from 'os';
import qrcode from 'qrcode-terminal';

/**
 * 判断是否为标准私有 IPv4 地址（家庭/企业局域网常见段）
 * 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12
 */
function isPrivateIPv4(addr: string): boolean {
  const parts = addr.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/**
 * 判断是否为应跳过的特殊/虚拟地址
 * - 169.254.x.x: APIPA 链路本地地址
 * - 198.18.0.0/15: RFC 2544 基准测试
 * - 100.64.0.0/10: CGNAT 共享地址
 */
function isSpecialPurposeIPv4(addr: string): boolean {
  const parts = addr.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  // 169.254.0.0/16 — APIPA / 链路本地
  if (a === 169 && b === 254) return true;
  // 198.18.0.0/15 — 基准测试
  if (a === 198 && (b === 18 || b === 19)) return true;
  // 100.64.0.0/10 — CGNAT
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/**
 * 获取局域网 IP 地址
 * 优先返回标准私有地址（192.168.x.x / 10.x.x.x / 172.16-31.x.x），
 * 跳过回环、链路本地（169.254）、基准测试（198.18）等特殊地址。
 */
export function getLocalIP(): string | null {
  const nets = networkInterfaces();
  let fallback: string | null = null;

  for (const name of Object.keys(nets)) {
    const netArray = nets[name];
    if (!netArray) continue;

    for (const net of netArray) {
      if (net.family !== 'IPv4') continue;
      if (net.internal) continue;
      if (isSpecialPurposeIPv4(net.address)) continue;

      // 标准私有地址优先返回
      if (isPrivateIPv4(net.address)) {
        return net.address;
      }
      // 非特殊也非私有的地址（如企业公网 IP 绑定在物理网卡上）作为备选
      if (!fallback) {
        fallback = net.address;
      }
    }
  }

  // 没有标准私有地址时，返回第一个非特殊的非内部地址
  return fallback;
}

/**
 * 生成连接 URL
 * URL 中同时携带 server 参数和 token，方便客户端直连
 */
export function generateConnectUrl(port: number, token: string): string {
  const ip = getLocalIP();
  if (!ip) {
    throw new Error('无法获取局域网 IP 地址');
  }

  return `http://${ip}:${port}?server=http://${ip}:${port}&token=${token}`;
}

/**
 * 在终端显示 QR 码
 */
export function displayQRCode(url: string): void {
  console.log('\n=== CC Remote ===\n');
  console.log('手机端扫码连接：\n');

  qrcode.generate(url, { small: true }, (qr: string) => {
    console.log(qr);
  });

  console.log(`\n或手动访问: ${url}\n`);
}

/**
 * 生成并显示 QR 码
 * 失败时不影响主服务运行，仅打印错误
 */
export function showConnectionQR(port: number, token: string): void {
  try {
    const url = generateConnectUrl(port, token);
    displayQRCode(url);
  } catch (err) {
    console.error('生成 QR 码失败:', err);
  }
}
