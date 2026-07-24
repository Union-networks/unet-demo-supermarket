import { createDomainAdminSignerFromEnv } from '@union-networks/issuer';
import { createPrivateKey } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const decodeEnvString = (value: string): string => {
  let decoded = value.trim();
  for (let index = 0; index < 2; index += 1) {
    if (!decoded.startsWith('"') || !decoded.endsWith('"')) break;
    try {
      const parsed = JSON.parse(decoded);
      if (typeof parsed !== 'string') break;
      decoded = parsed.trim();
    } catch {
      break;
    }
  }
  return decoded.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n?/g, '\n').trim();
};

const normalizePrivateKey = (value: string, type: 'ed25519' | 'secp256k1'): string => {
  const decoded = decodeEnvString(value);
  const key = createPrivateKey(decoded);
  const valid = type === 'ed25519'
    ? key.asymmetricKeyType === 'ed25519'
    : key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'secp256k1';
  if (!valid) throw new Error(type === 'ed25519' ? 'domain_admin_private_key_invalid' : 'domain_admin_credential_private_key_invalid');
  return key.export({ type: 'pkcs8', format: 'pem' }).toString();
};

export const configureCredentialRuntime = (): string => {
  if (process.env.BB_WASM_PATH?.trim()) return process.env.BB_WASM_PATH.trim();
  const wasmPath = join(process.cwd(), 'server-assets', 'barretenberg-threads.wasm.gz');
  if (!existsSync(wasmPath)) throw new Error('issuer_credential_runtime_wasm_missing');
  process.env.BB_WASM_PATH = wasmPath;
  return wasmPath;
};

export const domainAdminSigner = () => {
  const signer = createDomainAdminSignerFromEnv();
  if (!signer.credentialKeyId || !signer.credentialPrivateKeyPem) throw new Error('domain_admin_credential_signing_key_required');
  return {
    ...signer,
    privateKeyPem: normalizePrivateKey(signer.privateKeyPem, 'ed25519'),
    credentialKeyId: signer.credentialKeyId,
    credentialPrivateKeyPem: normalizePrivateKey(signer.credentialPrivateKeyPem, 'secp256k1'),
  };
};
