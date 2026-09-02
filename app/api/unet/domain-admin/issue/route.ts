import { NextResponse } from 'next/server';
import {
  anchorLedgerV2CredentialFromEnv,
  createCredentialEnvelopeV2,
  createDomainAdminCallbackHandlerV2,
  encryptCredentialEnvelopeV2,
} from '@u-net/issuer';
import { PUBLIC_SITE_ORIGIN, SERVICE_ID } from '../../../../../lib/config';
import { configureCredentialRuntime, domainAdminSigner } from '../../../../../lib/domain-admin-issuer';
import { domainAdminControlAuthorization } from '../../../../../lib/control-authorization';

export const runtime = 'nodejs';

const consumedChallenges = new Set<string>();

const consumeChallenge = async (challenge: string): Promise<boolean> => {
  if (!challenge || consumedChallenges.has(challenge)) return false;
  consumedChallenges.add(challenge);
  if (consumedChallenges.size > 1000) consumedChallenges.delete(consumedChallenges.values().next().value!);
  return true;
};

export async function POST(request: Request) {
  try {
    configureCredentialRuntime();
    const control = await domainAdminControlAuthorization();
    const handler = createDomainAdminCallbackHandlerV2({
      serviceId: SERVICE_ID,
      origin: PUBLIC_SITE_ORIGIN,
      signer: domainAdminSigner(),
      controlPublicKeys: control.publicKeys,
      consumeControlNonce: control.consumeNonce,
      consumeChallenge,
      issueCredential: async (domainRequest) => {
        const signer = domainAdminSigner();
        const nowEpoch = Math.floor(Date.now() / 1000);
        const validUntilEpoch = nowEpoch + 2 * 365 * 24 * 60 * 60;
        const credential = await createCredentialEnvelopeV2({
          requestType: domainRequest.requestType,
          schemaId: domainRequest.schemaId,
          issuerId: signer.issuerId,
          issuerKeyId: signer.keyId,
          issuerCredentialKeyId: signer.credentialKeyId,
          credentialPrivateKeyPem: signer.credentialPrivateKeyPem,
          holderBinding: domainRequest.holderBinding,
          validFromEpoch: nowEpoch,
          validUntilEpoch,
          statusEpoch: 1,
          claims: [
            { path: 'domain_role', type: 'string', value: `${SERVICE_ID}:${domainRequest.role}` },
            { path: 'service_id', type: 'string', value: SERVICE_ID },
            { path: 'role', type: 'string', value: domainRequest.role },
            { path: 'valid_until', type: 'u64', value: validUntilEpoch },
          ],
        });
        const ledgerV2 = domainRequest.version === 2
          ? await anchorLedgerV2CredentialFromEnv({
              issuerId: signer.issuerId,
              attestationHash: credential.attestationCommitment,
              holderRevocationSigner: domainRequest.holderRevocationSigner!,
              requestId: `domain-admin-${domainRequest.invitationId}`,
              signerEnvPrefix: 'UNET_DOMAIN_ADMIN_LEDGER',
            })
          : undefined;
        return {
          attestationCommitment: credential.attestationCommitment,
          encryptedCredentialEnvelope: encryptCredentialEnvelopeV2(credential, domainRequest.deliveryPublicKey) as unknown as Record<string, unknown>,
          credentialPublicMetadata: {
            version: 2,
            schemaId: credential.schemaId,
            schemaIdField: credential.schemaIdField,
            issuerCredentialKeyId: credential.issuerCredentialKeyId,
            issuerKeyHash: credential.issuerKeyHash,
            statusEpoch: credential.statusEpoch,
          },
          expiresAt: new Date(validUntilEpoch * 1000).toISOString(),
          ...(ledgerV2 ? {
            ledgerV2TransactionHash: ledgerV2.transactionHash,
            ledgerV2IssuerIdHash: ledgerV2.issuerIdHash,
            holderRevocationSigner: domainRequest.holderRevocationSigner,
          } : {}),
        };
      },
    });
    const response = await handler(await request.json(), {
      'x-unet-domain-admin-challenge': request.headers.get('x-unet-domain-admin-challenge') ?? '',
      'x-unet-control-authorization': request.headers.get('x-unet-control-authorization') ?? '',
    });
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'domain_admin_issue_failed';
    return NextResponse.json({ success: false, errorCode: message, message }, { status: 400 });
  }
}
