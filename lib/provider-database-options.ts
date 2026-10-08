import { Pool, type PoolConfig } from 'pg';

type DatabaseEnvironment = {
  NODE_ENV?: string;
  NEXT_PHASE?: string;
  UNET_PROVIDER_DATABASE_CA?: string;
};

// Do not pass TLS query options through to pg: its URL parser overrides ssl.
export function providerDatabaseOptions(connectionString: string | undefined, env: DatabaseEnvironment = process.env): PoolConfig {
  const production = env.NODE_ENV === 'production';
  if (!connectionString && production) {
    throw new Error('provider_database_configuration_missing');
  }
  let url: URL;
  try { url = new URL(connectionString || 'postgresql://postgres:postgres@127.0.0.1:5432/unet_supermarket'); }
  catch { throw new Error('provider_database_configuration_invalid'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.hash) {
    throw new Error('provider_database_configuration_invalid');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const plaintext = loopback && !production;
  const allowed = new Set(['sslmode', 'ssl', 'application_name', 'connect_timeout', 'options']);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new Error('provider_database_configuration_invalid');
    }
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
  const ca = env.UNET_PROVIDER_DATABASE_CA?.replace(/\\n/g, '\n').trim();
  if (ca && !/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----$/.test(ca)) {
    throw new Error('provider_database_ca_invalid');
  }
  const tlsRequired = !plaintext || (sslmode !== null && sslmode !== 'disable') || ssl === 'true' || ssl === '1' || Boolean(ca);
  return {
    connectionString: url.toString(),
    ssl: tlsRequired ? { rejectUnauthorized: true, ...(ca ? { ca } : {}) } : false,
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
