/**
 * Serverless API endpoint to extract and return client public IP.
 * Used by Cognify's Security Tracker for DevTools / Element Inspect tracking.
 */

export function extractClientIp(req: any): string {
  const forwarded = req.headers?.['x-forwarded-for'];
  const realIp = req.headers?.['x-real-ip'];
  const socketIp = req.socket?.remoteAddress || req.connection?.remoteAddress;

  let ip = '127.0.0.1';
  if (typeof forwarded === 'string') {
    ip = forwarded.split(',')[0].trim();
  } else if (Array.isArray(forwarded) && forwarded.length > 0) {
    ip = forwarded[0].trim();
  } else if (typeof realIp === 'string') {
    ip = realIp.trim();
  } else if (socketIp) {
    ip = socketIp.trim();
  }

  if (ip.startsWith('::ffff:')) {
    ip = ip.replace('::ffff:', '');
  }

  // Regex extraction: find valid IPv4
  const ipv4Match = ip.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  if (ipv4Match) {
    return ipv4Match[0];
  }

  // Regex extraction: find valid IPv6
  const ipv6Match = ip.match(/\b(?:[a-fA-F0-9]{1,4}:){1,7}[a-fA-F0-9]{1,4}\b/);
  if (ipv6Match) {
    return ipv6Match[0];
  }

  if (ip === '::1' || ip === '0.0.0.0' || !ip) {
    return '127.0.0.1 (Local)';
  }

  return ip;
}

export default async function handler(req: any, res: any) {
  try {
    const ip = extractClientIp(req);

    res.setHeader?.('Cache-Control', 'no-store, max-age=0');
    res.setHeader?.('Access-Control-Allow-Origin', '*');

    return res.status(200).json({
      success: true,
      ip,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(200).json({
      success: true,
      ip: '127.0.0.1 (Fallback)',
      error: err.message,
    });
  }
}
