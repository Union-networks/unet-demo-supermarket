import { sign } from 'node:crypto';
import { privateJson, privateFailure, readPrivateBody } from '../../../../../lib/private-route-response';
import { revokeLedgerV2CredentialFromEnv } from '@u-net/issuer';
import { SERVICE_ID } from '../../../../../lib/config';
import { configureCredentialRuntime, domainAdminSigner } from '../../../../../lib/domain-admin-issuer';
import { verifyControlAuthorization } from '../../../../../lib/control-authorization';

export const runtime = 'nodejs';

type RevokeRequest = {
  version?: number;
  action?: string;
  serviceId?: string;
  issuerId?: string;
  attestationHash?: string;
  requestId?: string;
  reason?: string;
  challenge?: string;
  expiresAt?: string;
};

const consumedChallenges = new Set<string>();
const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
};

export async function POST(request: Request) {
  try {
    const body = await readPrivateBody<RevokeRequest>(request);
    if (body.version === 1) throw new Error('protocol_upgrade_required');
    const challengeHeader = request.headers.get('x-unet-domain-admin-challenge') ?? '';
    if (body.version !== 2 || body.action !== 'domain-admin.revoke') throw new Error('domain_admin_callback_action_invalid');
    if (body.serviceId !== SERVICE_ID) throw new Error('domain_admin_callback_service_mismatch');
    if (!body.challenge || challengeHeader.includes(',') || body.challenge !== challengeHeader || consumedChallenges.has(body.challenge)) throw new Error('domain_admin_challenge_invalid');
    if (typeof body.expiresAt !== 'string' || !Number.isFinite(Date.parse(body.expiresAt)) || Date.parse(body.expiresAt) <= Date.now()) throw new Error('domain_admin_callback_expired');
    if (!/^[a-f0-9]{64}$/i.test(body.attestationHash ?? '') || !body.requestId || !body.reason) throw new Error('domain_admin_callback_invalid');
    if (!(await verifyControlAuthorization({
      body,
      authorization: request.headers.get('x-unet-control-authorization') ?? undefined,
      path: '/api/unet/domain-admin/revoke',
      audience: SERVICE_ID,
    }))) throw new Error('domain_admin_control_authorization_invalid');
    configureCredentialRuntime();
    const signer = domainAdminSigner();
    if (body.issuerId !== signer.issuerId) throw new Error('domain_admin_callback_service_mismatch');
    consumedChallenges.add(body.challenge);
    if (consumedChallenges.size > 1000) consumedChallenges.delete(consumedChallenges.values().next().value!);
    const ledgerV2 = await revokeLedgerV2CredentialFromEnv({
      issuerId: signer.issuerId,
      attestationHash: body.attestationHash!.toLowerCase(),
      requestId: body.requestId,
      reason: body.reason,
      signerEnvPrefix: 'UNET_DOMAIN_ADMIN_LEDGER',
    });
    const payload = {
      challenge: body.challenge,
      serviceId: SERVICE_ID,
      attestationHash: body.attestationHash!.toLowerCase(),
      requestId: body.requestId,
      status: 'revoked',
      ledgerV2TransactionHash: ledgerV2.transactionHash,
      ledgerV2IssuerIdHash: ledgerV2.issuerIdHash,
    };
    return privateJson({ keyId: signer.keyId, payload, signature: sign(null, Buffer.from(canonicalJson(payload), 'utf8'), signer.privateKeyPem).toString('base64url') });
  } catch (error) {
    return privateFailure(error, 'domain');
  }
}
