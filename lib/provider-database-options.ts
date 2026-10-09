import { Pool, type PoolConfig } from 'pg';
import { checkServerIdentity } from 'node:tls';
import { RequiredChannelBindingClient } from './provider-channel-binding';

type DatabaseEnvironment = {
  NODE_ENV?: string;
  NEXT_PHASE?: string;
  UNET_PROVIDER_DATABASE_CA?: string;
};

function invalidConfiguration(reason: 'malformed_url' | 'invalid_target' | 'invalid_channel_binding' | 'unsupported_parameter' | 'duplicate_parameter'): Error {
  return Object.assign(new Error('provider_database_configuration_invalid'), { configurationReason: reason });
}

// Do not pass TLS query options through to pg: its URL parser overrides ssl.
export function providerDatabaseOptions(connectionString: string | undefined, env: DatabaseEnvironment = process.env): PoolConfig & { enableChannelBinding: boolean } {
  const production = env.NODE_ENV === 'production';
  if (!connectionString && production) {
    throw new Error('provider_database_configuration_missing');
  }
  let url: URL;
  try { url = new URL(connectionString || 'postgresql://postgres:postgres@127.0.0.1:5432/unet_supermarket'); }
  catch { throw invalidConfiguration('malformed_url'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.hash) {
    throw invalidConfiguration('invalid_target');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const plaintext = loopback && !production;
  const allowed = new Set(['sslmode', 'ssl', 'channel_binding', 'application_name', 'connect_timeout', 'options']);
  for (const key of url.searchParams.keys()) {
    if (url.searchParams.getAll(key).length !== 1) throw invalidConfiguration('duplicate_parameter');
    if (!allowed.has(key)) throw invalidConfiguration('unsupported_parameter');
  }
  const channelBinding = url.searchParams.get('channel_binding');
  if (channelBinding !== null && !['require', 'prefer', 'disable'].includes(channelBinding)) {
    throw invalidConfiguration('invalid_channel_binding');
  }
  const sslmode = url.searchParams.get('sslmode');
  const ssl = url.searchParams.get('ssl');
  if (sslmode !== null && !['require', 'verify-ca', 'verify-full', ...(plaintext ? ['disable'] : [])].includes(sslmode)) {
    throw new Error('provider_database_tls_required');
  }
  if (ssl !== null && !['true', '1', ...(plaintext ? ['false', '0'] : [])].includes(ssl)) {
    throw new Error('provider_database_tls_required');
  }
  url.searchParams.delete('sslmode');
  url.searchParams.delete('ssl');
  url.searchParams.delete('channel_binding');
  const ca = env.UNET_PROVIDER_DATABASE_CA?.replace(/\\n/g, '\n').trim();
  if (ca && !/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----$/.test(ca)) {
    throw new Error('provider_database_ca_invalid');
  }
  const tlsRequired = channelBinding === 'require' || !plaintext || (sslmode !== null && sslmode !== 'disable') || ssl === 'true' || ssl === '1' || Boolean(ca);
  if (channelBinding === 'require' && (sslmode === 'disable' || ssl === 'false' || ssl === '0')) {
    throw new Error('provider_database_tls_required');
  }
  return {
    connectionString: url.toString(),
    ssl: tlsRequired ? { rejectUnauthorized: true, ...(ca ? { ca } : {}),
      // pg supplies SNI for DNS names, but not IP literals. Bind identity checks
      // to the URL target, never Node's fallback hostname for socket-based TLS.
      checkServerIdentity: (_host, certificate) => checkServerIdentity(url.hostname.replace(/^\[|\]$/g, ''), certificate),
    } : false,
    enableChannelBinding: channelBinding === 'require' || channelBinding === 'prefer',
    ...(channelBinding === 'require' ? { Client: RequiredChannelBindingClient } : {}),
    connectionTimeoutMillis: 10_000,
    max: 5,
  };
}

// Static route collection imports this handle without requiring database access.
export function createLazyProviderPool(connectionString: () => string | undefined): Pool {
  let pool: Pool | undefined;
  return new Proxy({} as Pool, {
    get(_target, property) {
      pool ??= new Pool(providerDatabaseOptions(connectionString()));
      const value = Reflect.get(pool, property, pool);
      return typeof value === 'function' ? value.bind(pool) : value;
    },
  });
}
