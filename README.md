# @harperdb/apollo

A [HarperDB Component](https://docs.harperdb.io/docs/developers/components) for running and developing Apollo GraphQL backend services.

![NPM Version](https://img.shields.io/npm/v/%40harperdb%2Fapollo)

Most Apollo features are supported as this component relies on the `ApolloServer` provided by `@apollo/server`.

If you don't know where to get started, check out the [apollo-example](https://github.com/HarperDB/apollo-example) starter project.

## Options

### Required

### `files: string`

Specifies the directory that contains your configuration files.

### Optional

### `cache: string`

Specify a path to a custom Apollo cache implementation.

Must be set to a path of a JavaScript file with a default export of an [Apollo cache backend implementing the `KeyValueCache` interface](https://www.apollographql.com/docs/apollo-server/performance/cache-backends#implementing-your-own-cache-backend).

For example:

```js
class CustomCache {
	// ...
}

export default CustomCache;
```

### `port: number`

Specify a port for the Apollo server. Defaults to the HarperDB default port (generally `9926`).

### `resolvers: string`

Specify a path to the Apollo resolvers JavaScript file.

Must be set to a singular path of a JavaScript file containing a default export of Apollo resolver functions.

For example:

```js
const resolvers = {
	Query: {
		dog: //...
	},
}

export default resolvers;
```

### `plugins: string`

Specify a path to an Apollo plugins JavaScript file.

Must be set to a singular path of a JavaScript file containing a default export of Apollo plugins.

For example:

```js
// Example setting custom response headers
const customPlugin = {
	async requestDidStart() {
		return {
			async willSendResponse(requestContext) {
				const { response } = requestContext;
				response.http.headers.set('x-foo', 'bar');
			},
		};
	},
};

const plugins = [customPlugin];

export default plugins;
```

### `schemas: string`

Specify a glob path to Apollo schema files.

Can be a singular path or a glob pattern. All schemas will be concatenated together and passed to the Apollo server.

For example, if all schemas are located in `src/schemas/`, the setting here would be `./src/schemas/*.graphql`

### `securePort: number`

Specify a secure port for the Apollo server. Defaults to the HarperDB default secure port.
