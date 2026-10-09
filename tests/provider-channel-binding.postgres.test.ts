import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Client, Pool } from 'pg';
import { providerDatabaseOptions, createLazyProviderPool } from '../lib/provider-database-options';
import { RequiredChannelBindingClient } from '../lib/provider-channel-binding';

const url = process.env.UNET_CHANNEL_BINDING_TEST_DATABASE_URL;
test('disposable PostgreSQL: required PLUS, fallback rejection, verified TLS and pooled reconnects',
  { skip: !url, timeout: 60_000 }, async t => {
    const target = new URL(url!);
    assert.equal(target.hostname, '127.0.0.1');
    assert.equal(target.pathname, '/postgres');
    const ca = readFileSync(process.env.UNET_CHANNEL_BINDING_TEST_CA!, 'utf8');
    const config = providerDatabaseOptions(url + '?sslmode=require&channel_binding=require',
      { NODE_ENV: 'production', UNET_PROVIDER_DATABASE_CA: ca });
    assert.equal(config.Client, RequiredChannelBindingClient);

    await t.test('explicit prefer and disable retain verified TLS on real SCRAM connections', async () => {
      for (const mode of ['prefer', 'disable']) {
        const pool = new Pool(providerDatabaseOptions(url + '?sslmode=require&channel_binding=' + mode,
          { NODE_ENV: 'production', UNET_PROVIDER_DATABASE_CA: ca }));
        try {
          const client = await pool.connect();
          try {
            assert.ok(!(client instanceof RequiredChannelBindingClient));
            assert.equal((await client.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0].ssl, true);
          } finally { client.release(); }
        } finally { await pool.end(); }
      }
    });

    await t.test('real SCRAM-PLUS server proof permits callback and promise pool queries, including a replacement connection', async () => {
      const pool = new Pool({ ...config, max: 1, maxUses: 1 });
      try {
        for (let i = 0; i < 2; i++) {
          const client = await pool.connect();
          assert.ok(client instanceof RequiredChannelBindingClient);
          assert.equal((await client.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0].ssl, true);
          client.release();
        }
        await new Promise<void>((resolve, reject) => pool.query('SELECT 1 AS n', (error, result) => {
          if (error) return reject(error);
          assert.equal(result.rows[0].n, 1); resolve();
        }));
      } finally { await pool.end(); }
    });

    for (const user of ['binding_trust', 'binding_md5', 'binding_password']) {
      await t.test(user + ' cannot satisfy require, but explicit prefer retains pg compatibility', async () => {
        const roleUrl = new URL(url!); roleUrl.username = user;
        for (const mode of ['require', 'prefer']) {
          const pool = new Pool(providerDatabaseOptions(roleUrl + '?channel_binding=' + mode,
            { NODE_ENV: 'production', UNET_PROVIDER_DATABASE_CA: ca }));
          try {
            if (mode === 'require') await assert.rejects(pool.query('SELECT 1'), { message: 'provider_database_channel_binding_required' });
            else assert.equal((await pool.query('SELECT 1 AS n')).rows[0].n, 1);
          } finally { await pool.end(); }
        }
      });
    }

    await t.test('unknown CA, wrong hostname and wrong password fail rather than downgrade', async () => {
      const cases = [
        { config: { ...config, ssl: { rejectUnauthorized: true } }, code: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
        { config: providerDatabaseOptions(url!.replace('127.0.0.1', 'localhost') + '?channel_binding=require',
          { NODE_ENV: 'production', UNET_PROVIDER_DATABASE_CA: ca }), code: 'ERR_TLS_CERT_ALTNAME_INVALID' },
        { config: { ...config, connectionString: url!.replace(target.password, 'wrong-password') }, code: '28P01' },
      ];
      for (const value of cases) {
        const pool = new Pool(value.config);
        try { await assert.rejects(pool.query('SELECT 1'), { code: value.code }); }
        finally { await pool.end(); }
      }
    });

    await t.test('required client rejects ordinary SCRAM even on the actual unencrypted pg connection', async () => {
      const ordinary = new Client({ connectionString: url, ssl: false }) as Client & {
        connection: RequiredChannelBindingClient['connection'];
      };
      const guarded = new RequiredChannelBindingClient(config);
      // A real pg TCP/protocol connection without TLS advertises only SCRAM.
      guarded.connection = ordinary.connection;
      guarded.ssl = false;
      try { await assert.rejects(guarded.connect(), { message: 'provider_database_channel_binding_required' }); }
      finally { await guarded.end().catch(() => {}); }
    });

    await t.test('lazy production pool uses the required adapter, not ordinary pg.Client', async t => {
      const old = { NODE_ENV: process.env.NODE_ENV, UNET_PROVIDER_DATABASE_CA: process.env.UNET_PROVIDER_DATABASE_CA };
      t.after(() => { for (const [key, value] of Object.entries(old)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      } });
      Object.assign(process.env, { NODE_ENV: 'production', UNET_PROVIDER_DATABASE_CA: ca });
      const pool = createLazyProviderPool(() => url + '?channel_binding=require');
      try {
        assert.equal(pool.options.Client, RequiredChannelBindingClient);
        assert.equal((await pool.query('SELECT 1 AS n')).rows[0].n, 1);
      } finally { await pool.end(); }
    });
  });
