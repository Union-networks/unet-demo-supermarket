import type { EventEmitter } from 'node:events';
import type { TLSSocket } from 'node:tls';
import { Client, type ClientConfig } from 'pg';
import pgPackage from 'pg/package.json';

type SASLMessage = { mechanisms: string[] };
type SASLData = { data: string };
type ReadyMessage = { status: string };

// These hooks are internal to the pinned pg release. No SCRAM or certificate
// cryptography is implemented here; pg owns mechanism negotiation and proofs.
type AuthenticationClient = Client & {
  connection: EventEmitter & { stream: TLSSocket };
  saslSession: { mechanism: string; message: string } | null;
  _connectionError: boolean;
  _handleAuthSASL(message: SASLMessage): void;
  _handleAuthSASLContinue(message: SASLData): Promise<void>;
  _handleAuthSASLFinal(message: SASLData): void;
  _handleReadyForQuery(message: ReadyMessage): void;
  _handleErrorEvent(error: Error): void;
};
const AuthenticationClient = Client as unknown as new (config?: ClientConfig) => AuthenticationClient;

export class RequiredChannelBindingClient extends AuthenticationClient {
  private bindingState: 'new' | 'initial' | 'continuing' | 'response' | 'verified' | 'failed' = 'new';

  constructor(config?: ClientConfig) {
    if (pgPackage.version !== '8.22.0') throw new Error('provider_database_channel_binding_driver_unsupported');
    super({ ...config, enableChannelBinding: true } as ClientConfig);
    const ssl = this.ssl as ClientConfig['ssl'];
    if (!ssl || typeof ssl !== 'object' || ssl.rejectUnauthorized !== true ||
      typeof this.password !== 'string' || !this.password) {
      throw new Error('provider_database_channel_binding_required');
    }
  }

  private rejectBinding(): void {
    this._handleErrorEvent(new Error('provider_database_channel_binding_required'));
  }

  _handleErrorEvent(error: Error): void {
    if (this.bindingState === 'failed') return;
    this.bindingState = 'failed';
    this.connection.stream.destroy();
    super._handleErrorEvent(error);
  }

  _handleAuthCleartextPassword(): void { this.rejectBinding(); }
  _handleAuthMD5Password(): void { this.rejectBinding(); }

  _handleAuthSASL(message: SASLMessage): void {
    const stream = this.connection.stream;
    if (this.bindingState !== 'new' || this._connectionError || !stream.encrypted || stream.authorized !== true ||
      typeof stream.getPeerCertificate !== 'function' || !stream.getPeerCertificate().raw?.length ||
      !message.mechanisms.includes('SCRAM-SHA-256-PLUS')) {
      return this.rejectBinding();
    }
    this.bindingState = 'initial';
    // Restrict the offer, so pg cannot select its ordinary SCRAM fallback.
    super._handleAuthSASL({ ...message, mechanisms: ['SCRAM-SHA-256-PLUS'] });
  }

  async _handleAuthSASLContinue(message: SASLData): Promise<void> {
    if (this.bindingState !== 'initial' || this.saslSession?.mechanism !== 'SCRAM-SHA-256-PLUS' ||
      this.saslSession.message !== 'SASLInitialResponse') return this.rejectBinding();
    this.bindingState = 'continuing';
    await super._handleAuthSASLContinue(message);
    if (!this._connectionError && (this.saslSession?.message as string) === 'SASLResponse') this.bindingState = 'response';
  }

  _handleAuthSASLFinal(message: SASLData): void {
    if (this.bindingState !== 'response' || this.saslSession?.mechanism !== 'SCRAM-SHA-256-PLUS' ||
      this.saslSession.message !== 'SASLResponse') return this.rejectBinding();
    super._handleAuthSASLFinal(message);
    // pg clears the session only after successfully verifying the server proof.
    if (!this._connectionError && this.saslSession === null) this.bindingState = 'verified';
  }

  _handleReadyForQuery(message: ReadyMessage): void {
    if (this._connectionError || this.bindingState === 'failed') return;
    if (this.bindingState !== 'verified') return this.rejectBinding();
    super._handleReadyForQuery(message);
  }
}
