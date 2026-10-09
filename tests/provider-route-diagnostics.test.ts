import assert from 'node:assert/strict';
import { format } from 'node:util';
import test from 'node:test';
import { recordProviderFailure, runProviderRoute } from '../lib/provider-route';
import { providerDatabaseOptions } from '../lib/provider-database-options';

test('provider route failure categories are fixed and never log backend canaries', async t => {
  const canary = 'CANARY_PASSWORD_SQL_URL_PROOF';
  const captured: string[] = [];
  const warn = t.mock.method(console, 'warn', (...args: unknown[]) => captured.push(format(...args)));
  const cases: [unknown, string][] = [
    ...['provider_database_configuration_missing', 'provider_database_configuration_invalid',
      'provider_database_tls_required', 'provider_database_ca_invalid', 'provider_database_channel_binding_required',
      'provider_database_channel_binding_driver_unsupported'].map(message => [new Error(message), message] as [Error, string]),
    ...['malformed_url', 'invalid_target', 'invalid_channel_binding', 'unsupported_parameter', 'duplicate_parameter']
      .map(reason => [Object.assign(new Error('provider_database_configuration_invalid'), { configurationReason: reason }),
        'provider_database_configuration_invalid_' + reason] as [Error, string]),
    ...Object.entries({
      '28P01': 'database_authentication_failed', '28000': 'database_authentication_failed',
      '42501': 'database_permission_denied', '42P01': 'database_schema_invalid', '42703': 'database_schema_invalid',
      '42710': 'database_schema_invalid', '23514': 'database_schema_invalid',
      'CERT_HAS_EXPIRED': 'database_tls_verification_failed', 'DEPTH_ZERO_SELF_SIGNED_CERT': 'database_tls_verification_failed',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE': 'database_tls_verification_failed', 'ERR_TLS_CERT_ALTNAME_INVALID': 'database_tls_verification_failed',
      'SELF_SIGNED_CERT_IN_CHAIN': 'database_tls_verification_failed', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY': 'database_tls_verification_failed',
      'ETIMEDOUT': 'dependency_timeout', 'ECONNREFUSED': 'database_connection_failed',
      'ENOTFOUND': 'database_connection_failed', 'ECONNRESET': 'database_connection_failed',
    }).map(([code, category]) => [Object.assign(new Error(canary), { code }), category] as [Error, string]),
    [new Error(canary), 'dependency_unavailable'],
    [Object.assign(new Error(canary), { code: canary }), 'dependency_unavailable'],
    [Object.assign(new Error(canary), { code: { toString() { throw new Error(canary); } } }), 'dependency_unavailable'],
    [Object.assign(new Error('provider_database_configuration_invalid'), { configurationReason: canary }), 'provider_database_configuration_invalid'],
    [canary, 'dependency_unavailable'], [{ message: canary, code: canary }, 'dependency_unavailable'],
    [null, 'dependency_unavailable'],
  ];
  for (const [failure, category] of cases) {
    if (failure instanceof Error) Object.assign(failure, {
      cause: new Error(canary), detail: canary, query: canary, url: canary, value: canary,
    });
    const response = await runProviderRoute('account_retire', async () => { throw failure; });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { success: false, error: 'provider_temporarily_unavailable' });
    const record = warn.mock.calls.at(-1)!.arguments[0] as Record<string, unknown>;
    assert.deepEqual(Object.keys(record).sort(), ['diagnosticId', 'event', 'failureCategory', 'operation', 'outcome']);
    assert.equal(record.event, 'provider_route_failed');
    assert.equal(record.operation, 'account_retire');
    assert.equal(record.outcome, 'unavailable');
    assert.equal(record.failureCategory, category);
  }
  recordProviderFailure(canary as never, canary as never, new Error(canary));
  assert.equal((warn.mock.calls.at(-1)!.arguments[0] as Record<string, unknown>).operation, 'unknown');
  assert.ok(!captured.join('\n').includes(canary));
  assert.ok(!captured.join('\n').includes('Error:'));
});

test('actual parser failures reach provider diagnostics only as sanitized reasons', async t => {
  const warn = t.mock.method(console, 'warn', () => {});
  for (const [query, reason] of [
    ['channel_binding=CANARY_VALUE', 'invalid_channel_binding'],
    ['CANARY_PARAMETER=CANARY_VALUE', 'unsupported_parameter'],
    ['channel_binding=require&channel_binding=disable', 'duplicate_parameter'],
  ]) {
    await runProviderRoute('account_retire', async () => {
      providerDatabaseOptions('postgresql://fixture:CANARY_PASSWORD@database.invalid/provider?' + query, { NODE_ENV: 'production' });
      throw new Error('unexpected_parser_success');
    });
    const record = warn.mock.calls.at(-1)!.arguments[0] as Record<string, unknown>;
    assert.equal(record.failureCategory, 'provider_database_configuration_invalid_' + reason);
    assert.ok(!JSON.stringify(record).includes('CANARY'));
  }
});
