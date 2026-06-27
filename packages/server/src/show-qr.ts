/**
 * QR 码显示 CLI
 * 用法：node dist/show-qr.js
 * 独立入口，可在任何地方调用
 * 输出：终端 URL + PNG 文件 (~/.cc-remote/qr.png)
 */

import { networkInterfaces, homedir } from 'os';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import QRCode from 'qrcode';

function isPrivateIPv4(addr: string): boolean {
  const parts = addr.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isSpecialPurposeIPv4(addr: string): boolean {
  const parts = addr.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  if (a === 169 && b === 254) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function getLocalIP(): string | null {
  const nets = networkInterfaces();
  let fallback: string | null = null;
  for (const name of Object.keys(nets)) {
    const netArray = nets[name];
    if (!netArray) continue;
    for (const net of netArray) {
      if (net.family !== 'IPv4') continue;
      if (net.internal) continue;
      if (isSpecialPurposeIPv4(net.address)) continue;

      if (isPrivateIPv4(net.address)) {
        return net.address;
      }
      if (!fallback) {
        fallback = net.address;
      }
    }
  }
  return fallback;
}

async function main() {
  const ip = getLocalIP();
  if (!ip) {
    console.error('无法获取局域网 IP');
    process.exit(1);
  }

  let token = '';
  const configDir = join(homedir(), '.cc-remote');
  try {
    const configPath = join(configDir, 'config.json');
    token = JSON.parse(readFileSync(configPath, 'utf-8')).token;
  } catch {
    console.error('无法读取 token，请先启动 cc-remote server');
    process.exit(1);
  }

  const port = 8420;
  const url = `http://${ip}:${port}?server=http://${ip}:${port}&token=${token}`;

  // 生成 QR 码 PNG
  const qrPath = join(configDir, 'qr.png');
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  await QRCode.toFile(qrPath, url, {
    width: 300,
    margin: 2,
    color: { dark: '#000000', light: '#ffffff' },
  });

  console.log(JSON.stringify({
    status: 'ok',
    url,
    qrImage: qrPath,
  }));
}

main().catch((err) => {
  console.error('生成 QR 码失败:', err);
  process.exit(1);
});
