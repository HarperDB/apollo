import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ApolloServer, HeaderMap } from '@apollo/server';
import fastGlob from 'fast-glob';

const { GraphQL } = databases.cache;

const BASE_SCHEMA = `#graphql
enum CacheControlScope {
  PUBLIC
  PRIVATE
}

directive @cacheControl(
  maxAge: Int
  scope: CacheControlScope
  inheritMaxAge: Boolean
) on FIELD_DEFINITION | OBJECT | INTERFACE | UNION

directive @table(
	database: String 
	table: String
	expiration: Int
	audit: Boolean
) on OBJECT

directive @export(
	name: String
) on OBJECT

directive @sealed on OBJECT
directive @primaryKey on FIELD_DEFINITION
directive @indexed on FIELD_DEFINITION
directive @updatedTime on FIELD_DEFINITION
directive @relationship(
	to: String
	from: String
) on FIELD_DEFINITION

scalar Long
scalar BigInt
scalar Date
scalar Any
`;

export function start(options = {}) {
	const config = {
		cache: options.cache,
		port: options.port,
		resolvers: options.resolvers ?? './resolvers.js',
		schemas: options.schemas ?? './schemas.graphql',
		securePort: options.securePort,
		plugins: options.plugins,
	};

	logger.debug('@harperdb/apollo extension configuration:\n' + JSON.stringify(config, null, 2));

	return {
		async handleDirectory(_, componentPath) {
			// Load the resolvers
			const resolversPath = join(componentPath, config.resolvers);
			const resolvers = await import(pathToFileURL(resolversPath));

			// Load the schemas
			// posix.join is necessary so that `/` are retained, otherwise they get normalized to the platform
			const schemasPath = posix.join(componentPath, config.schemas);
			let typeDefs = BASE_SCHEMA;
			for (const filePath of fastGlob.sync(schemasPath, { onlyFiles: true })) {
				typeDefs += '\n' + readFileSync(filePath, 'utf-8');
			}

			// Get the custom cache or use the default
			const Cache = config.cache ? await import(pathToFileURL(join(componentPath, config.cache))) : HarperDBCache;

			// Load the plugins
			let plugins;
			if (config.plugins) {
				const pluginsPath = join(componentPath, config.plugins);
				 ({ default: plugins } = await import(pathToFileURL(pluginsPath)));
			}

			// Set up Apollo Server
			const apollo = new ApolloServer({
				typeDefs,
				resolvers: resolvers.default || resolvers,
				cache: new Cache(),
				plugins
			});

			await apollo.start();

			server.http(
				async (request, next) => {
					// Parse the incoming request url so that the `pathname` and `search` can be used
					const url = new URL(request.url, `http://${process.env.HOST ?? 'localhost'}`);
					if (url.pathname === '/graphql') {
						const body = await streamToBuffer(request.body);

						const httpGraphQLRequest = {
							method: request.method,
							headers: new HeaderMap(request.headers),
							body: JSON.parse(body),
							search: url.search,
						};

						const response = await apollo.executeHTTPGraphQLRequest({
							httpGraphQLRequest: httpGraphQLRequest,
							context: () => httpGraphQLRequest,
						});
						response.body = response.body.string;
						return response;
					} else {
						return next(request);
					}
				},
				{ port: config.port, securePort: config.securePort }
			);

			return true;
		},
	};
}

function streamToBuffer(stream) {
	return new Promise((resolve, reject) => {
		const buffers = [];
		stream.on('data', (data) => buffers.push(data));
		stream.on('end', () => resolve(Buffer.concat(buffers)));
		stream.on('error', reject);
	});
}

class HarperDBCache extends Resource {
	async get(key) {
		let data = await GraphQL.get(key);
		return data?.get('query');
	}

	async set(key, value, options) {
		let context = this.getContext();
		if (options?.ttl) {
			if (!context) {
				context = {};
			}
			//the ttl is in seconds
			context.expiresAt = Date.now() + options.ttl * 1000;
		}

		await GraphQL.put({ id: key, query: value }, context);
	}

	async delete(key) {
		await GraphQL.delete(key);
	}
}
