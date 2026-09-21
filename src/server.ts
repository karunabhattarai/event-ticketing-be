import { createApp } from './app';
import { env } from './env';

const app = createApp();
app.listen(env.port, () => {
  console.log(`event-ticketing backend listening on :${env.port}`);
});
