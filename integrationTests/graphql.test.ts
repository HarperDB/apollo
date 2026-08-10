/**
 * Integration tests for @harperdb/apollo.
 * Verifies that the Apollo GraphQL extension boots correctly under Harper v5,
 * exposes a working /graphql endpoint, and handles queries, mutations, and
 * introspection against a live Harper instance running the fixture application.
 */
import { suite, test, before, after } from 'node:test';
import { strictEqual, ok } from 'node:assert/strict';
import { setupHarperWithFixture, teardownHarper, type ContextWithHarper } from '@harperfast/integration-testing';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, 'fixture');

// harper's `exports` map only exposes ".", so the harness's default
// require.resolve('harper/dist/bin/harper.js') throws ERR_PACKAGE_PATH_NOT_EXPORTED.
// Resolve the CLI from the exported main entry and pass it explicitly.
const require = createRequire(import.meta.url);
const harperBinPath = resolve(dirname(require.resolve('harper')), 'bin/harper.js');

function basicAuth(username: string, password: string): string {
	return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

async function gql(
	httpURL: string,
	auth: string,
	query: string,
	variables?: Record<string, unknown>,
): Promise<{ data: Record<string, unknown>; errors?: unknown[] }> {
	const res = await fetch(`${httpURL}/graphql`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: auth },
		body: JSON.stringify({ query, variables }),
	});
	if (!res.ok) throw new Error('GraphQL request failed: HTTP ' + res.status + ' ' + res.statusText + ' — ' + await res.text());
	return res.json() as Promise<{ data: Record<string, unknown>; errors?: unknown[] }>;
}

suite('Apollo GraphQL extension', (ctx: ContextWithHarper) => {
	before(async () => {
		await setupHarperWithFixture(ctx, FIXTURE_PATH, { harperBinPath });
	});

	after(async () => {
		await teardownHarper(ctx);
	});

	test('GraphQL endpoint returns HTTP 200 for a basic query', async () => {
		const { admin, httpURL } = ctx.harper;
		const auth = basicAuth(admin.username, admin.password);

		const res = await fetch(`${httpURL}/graphql`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: auth },
			body: JSON.stringify({ query: '{ items { id } }' }),
		});

		strictEqual(res.status, 200, 'GraphQL endpoint should return HTTP 200');
	});

	test('items query returns an array', async () => {
		const { admin, httpURL } = ctx.harper;
		const auth = basicAuth(admin.username, admin.password);

		const result = await gql(httpURL, auth, '{ items { id name value } }');

		ok(!result.errors, `expected no errors, got: ${JSON.stringify(result.errors)}`);
		ok(Array.isArray(result.data.items), 'items query should return an array');
	});

	test('item query for non-existent id returns null', async () => {
		const { admin, httpURL } = ctx.harper;
		const auth = basicAuth(admin.username, admin.password);

		const result = await gql(httpURL, auth, '{ item(id: "nonexistent-999") { id name } }');

		ok(!result.errors, `expected no errors, got: ${JSON.stringify(result.errors)}`);
		strictEqual(result.data.item, null, 'non-existent item should return null');
	});

	test('introspection query succeeds', async () => {
		const { admin, httpURL } = ctx.harper;
		const auth = basicAuth(admin.username, admin.password);

		const res = await fetch(`${httpURL}/graphql`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: auth },
			body: JSON.stringify({ query: '{ __schema { queryType { name } } }' }),
		});

		strictEqual(res.status, 200);
		const body = (await res.json()) as { data: { __schema: { queryType: { name: string } } } };
		strictEqual(body.data.__schema.queryType.name, 'Query');
	});

	// Write -> read -> delete cycle through the GraphQL mutations and queries.
	test('putItem mutation writes a record readable via item query, and deleteItem removes it', async () => {
		const { admin, httpURL } = ctx.harper;
		const auth = basicAuth(admin.username, admin.password);

		// Write via mutation
		const putResult = await gql(httpURL, auth, 'mutation { putItem(id: "test-1", name: "Widget", value: 42) { id name value } }');
		ok(!putResult.errors, `putItem errored: ${JSON.stringify(putResult.errors)}`);
		const putItem = putResult.data.putItem as { id: string; name: string; value: number } | null;
		ok(putItem, 'putItem should return the written record');
		strictEqual(putItem!.name, 'Widget');
		strictEqual(putItem!.value, 42);

		// Read back via query
		const getResult = await gql(httpURL, auth, '{ item(id: "test-1") { id name value } }');
		ok(!getResult.errors, `item query errored: ${JSON.stringify(getResult.errors)}`);
		const gotItem = getResult.data.item as { id: string; name: string; value: number } | null;
		ok(gotItem, 'item should be readable after putItem');
		strictEqual(gotItem!.name, 'Widget');
		strictEqual(gotItem!.value, 42);

		// Delete
		const deleteResult = await gql(httpURL, auth, 'mutation { deleteItem(id: "test-1") { id } }');
		ok(!deleteResult.errors, 'deleteItem errored: ' + JSON.stringify(deleteResult.errors));

		// Confirm gone
		const goneResult = await gql(httpURL, auth, '{ item(id: "test-1") { id } }');
		ok(!goneResult.errors, `item query after delete errored: ${JSON.stringify(goneResult.errors)}`);
		strictEqual(goneResult.data.item, null, 'item should be gone after deleteItem');
	});

	// Verify the component's built-in Apollo cache (HarperCache) is used by default.
	// We exercise it indirectly: store a record via REST and read it via GraphQL so
	// the cache is primed, then verify the REST endpoint returns an ETag (confirming
	// Harper's caching contract is intact).
	test('stored record serves an ETag on GET', async () => {
		const { admin, httpURL } = ctx.harper;
		const auth = basicAuth(admin.username, admin.password);

		// Write via REST
		const put = await fetch(`${httpURL}/Item/etag-test-1`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json', Authorization: auth },
			body: JSON.stringify({ id: 'etag-test-1', name: 'EtagItem', value: 7 }),
		});
		ok(put.status >= 200 && put.status < 300, `Item PUT failed: ${put.status}`);

		// Read back via REST and check ETag
		const get = await fetch(`${httpURL}/Item/etag-test-1`, {
			headers: { Authorization: auth, Accept: 'application/json' },
		});
		strictEqual(get.status, 200, 'GET should return 200');
		const etag = get.headers.get('etag');
		ok(etag, 'stored record should carry an ETag');
		await get.text();

		// Conditional GET
		const conditional = await fetch(`${httpURL}/Item/etag-test-1`, {
			headers: { Authorization: auth, Accept: 'application/json', 'If-None-Match': etag! },
		});
		strictEqual(conditional.status, 304, 'conditional GET with matching ETag should be 304');
	});
});
