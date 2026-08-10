import { databases } from 'harper';
const { Item } = databases.demo;

const resolvers = {
	Query: {
		item: async (parent, args) => {
			return Item.get(args.id);
		},
		items: async () => {
			return Item.search({});
		},
	},
	Mutation: {
		putItem: async (parent, args) => {
			await Item.put(args);
			return args;
		},
		deleteItem: async (parent, args) => {
			const item = await Item.get(args.id);
			await Item.delete(args.id);
			return item ?? null;
		},
	},
};

export default resolvers;
