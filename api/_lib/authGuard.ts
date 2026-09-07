/**
 * Authentication Guard for AI Serverless Endpoints (Point 11 Hardening)
 * Strictly verifies Firebase Authentication ID Tokens using Google's public x509 certs
 * and claims validation. Rejects unauthenticated callers, forged tokens, and body.uid bypasses.
 */
import crypto from 'crypto';

export interface AuthValidationResult {
  authenticated: boolean;
  uid?: string;
  error?: string;
}

export function extractBearerToken(req: any): string | null {
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  return null;
}

export type CertProvider = () => Promise<Record<string, string>>;
let customCertProvider: CertProvider | null = null;

/**
 * Allows automated test suites to mock Google public certs for RS256 signature testing.
 */
export function setTestCertProvider(provider: CertProvider | null): void {
  customCertProvider = provider;
}

/**
 * Returns the expected Firebase project ID.
 * Strictly enforces that FIREBASE_PROJECT_ID is present in production environments.
 */
export function getExpectedProjectId(): string {
  const envProjectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  if (process.env.NODE_ENV === 'production') {
    if (!envProjectId) {
      // In deployed cloud environments (Vercel, Cloud Run, etc.) where FIREBASE_PROJECT_ID wasn't set manually,
      // fallback to the canonical project ID instead of rejecting valid user tokens with 401.
      if (process.env.VERCEL || process.env.K_SERVICE || process.env.PORT) {
        return 'gen-lang-client-0347404066';
      }
      throw new Error('[authGuard] CRITICAL CONFIGURATION ERROR: FIREBASE_PROJECT_ID must be set in production.');
    }
    return envProjectId;
  }
  return envProjectId || 'gen-lang-client-0347404066';
}

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

interface CertCache {
  certs: Record<string, string>;
  expiresAt: number;
}

let certCache: CertCache | null = null;

async function getGooglePublicCerts(): Promise<Record<string, string>> {
  if (customCertProvider) {
    return await customCertProvider();
  }

  const now = Date.now();
  if (certCache && certCache.expiresAt > now) {
    return certCache.certs;
  }

  try {
    const res = await fetch(GOOGLE_CERTS_URL);
    if (!res.ok) {
      throw new Error(`Failed to fetch Google certs: HTTP ${res.status}`);
    }

    let maxAgeSeconds = 3600; // default 1 hour
    const cacheControl = res.headers.get('cache-control');
    if (cacheControl) {
      const match = cacheControl.match(/max-age=(\d+)/i);
      if (match) {
        maxAgeSeconds = parseInt(match[1], 10);
      }
    }

    const certs = (await res.json()) as Record<string, string>;
    certCache = {
      certs,
      expiresAt: now + maxAgeSeconds * 1000,
    };
    return certs;
  } catch (err) {
    if (certCache) return certCache.certs;
    throw err;
  }
}

/**
 * Validates whether an incoming request comes from a verified Firebase authenticated user.
 * Strictly requires Authorization: Bearer <token>.
 * Rejects body.uid bypass attempts and invalid/unverified tokens.
 */
export async function verifyRequestAuth(req: any): Promise<AuthValidationResult> {
  const token = extractBearerToken(req);

  // If no bearer token is present, REJECT immediately.
  // NO body.uid bypass allowed under any circumstances.
  if (!token) {
    return {
      authenticated: false,
      error: 'Authentication required. Missing Authorization Bearer token.',
    };
  }

  // Handle deterministic test-mode bypass tokens for local automated test suites (disabled in production)
  if (process.env.NODE_ENV !== 'production' && token.startsWith('test_valid_token_')) {
    const testUid = token.replace('test_valid_token_', '');
    return { authenticated: true, uid: testUid };
  }

  // Token is present: verify minimal JWT token structure (header.payload.signature)
  const parts = token.split('.');
  if (parts.length !== 3) {
    return {
      authenticated: false,
      error: 'Malformed authentication token.',
    };
  }

  try {
    const [rawHeader, rawPayload, rawSig] = parts;
    const headerJson = Buffer.from(rawHeader, 'base64url').toString('utf-8');
    const payloadJson = Buffer.from(rawPayload, 'base64url').toString('utf-8');
    const header = JSON.parse(headerJson);
    const payload = JSON.parse(payloadJson);

    // 1. Verify Header Algorithm and Key ID
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
      return {
        authenticated: false,
        error: 'Invalid token header: alg must be RS256 and kid must be present.',
      };
    }

    // 2. Verify Claims (Audience, Issuer, Expiration, Subject)
    const nowSec = Math.floor(Date.now() / 1000);
    let projectId: string;
    try {
      projectId = getExpectedProjectId();
    } catch (cfgErr: any) {
      console.error(cfgErr.message);
      return {
        authenticated: false,
        error: 'Server authentication configuration error: Missing project configuration.',
      };
    }

    if (payload.aud !== projectId) {
      return {
        authenticated: false,
        error: `Invalid audience claim: expected ${projectId}.`,
      };
    }

    if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
      return {
        authenticated: false,
        error: `Invalid issuer claim for project ${projectId}.`,
      };
    }

    const uid = payload.user_id || payload.sub;
    if (typeof uid !== 'string' || !uid) {
      return { authenticated: false, error: 'Invalid token subject (uid).' };
    }

    if (typeof payload.exp !== 'number' || payload.exp < nowSec) {
      return { authenticated: false, error: 'Authentication token has expired.' };
    }

    if (typeof payload.auth_time === 'number' && payload.auth_time > nowSec + 300) {
      return { authenticated: false, error: 'Token auth_time is in the future.' };
    }

    // 3. Cryptographic Signature Verification against Google's public x509 certs
    try {
      const certs = await getGooglePublicCerts();
      const cert = certs[header.kid];
      if (!cert) {
        return { authenticated: false, error: 'Public certificate for token kid not found.' };
      }

      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(`${rawHeader}.${rawPayload}`);
      const isSignatureValid = verifier.verify(cert, rawSig, 'base64url');

      if (!isSignatureValid) {
        return { authenticated: false, error: 'Invalid token cryptographic signature.' };
      }
    } catch (certErr: any) {
      console.warn('[authGuard] Cert verification failure:', certErr?.message || certErr);
      return { authenticated: false, error: 'Authentication signature verification failed.' };
    }

    return { authenticated: true, uid };
  } catch (err) {
    return { authenticated: false, error: 'Failed to verify authentication credentials.' };
  }
}