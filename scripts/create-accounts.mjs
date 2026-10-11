import { AccountStore } from '../apps/api/dist/accounts/store.js';
import { fileURLToPath } from 'node:url';

// Read credentials through stdin; never put them in repository configuration.
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 16384) throw new Error('Input too large');
}
let users;
try {
  users = JSON.parse(input);
} catch {
  throw new Error('Expected valid JSON account input through stdin.');
}
if (!Array.isArray(users) || users.length > 20)
  throw new Error('Expected an array of accounts');
const store = new AccountStore(
  process.env.MUSICBIT_DB_PATH ??
    fileURLToPath(new URL('../data/musicbit.sqlite', import.meta.url)),
);
try {
  for (const user of users) {
    if (typeof user.username !== 'string' || typeof user.password !== 'string')
      throw new Error('Invalid account');
    try {
      const account = await store.createUser(
        user.username,
        user.password,
        true,
      );
      console.log(`Created account: ${account.username}`);
    } catch (error) {
      if (error.code === 'USERNAME_TAKEN')
        console.log(`Account already exists: ${user.username}`);
      else throw error;
    }
  }
} finally {
  store.close();
}
