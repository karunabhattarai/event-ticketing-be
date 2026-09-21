import request from 'supertest';
import { createApp } from '../../src/app';

const CSRF_HEADER = 'event-ticketing-frontend';
const MUTATING_METHODS = ['post', 'patch', 'put', 'delete'] as const;

// Every non-safe request in the app now requires the X-Requested-With CSRF
// header (see src/middleware/requireCsrfHeader.ts). Rather than editing every
// one of the ~100+ existing test call sites, wrap the supertest instance so
// .post/.patch/.put/.delete automatically attach the header before handing
// back the request builder — callers can still chain further .set()/.send()
// exactly as before. .get() (and other safe methods) are left untouched.
export function testApp() {
  const agent = request(createApp());
  return new Proxy(agent, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function' && MUTATING_METHODS.includes(prop as (typeof MUTATING_METHODS)[number])) {
        return (...args: unknown[]) => {
          const req = (value as (...a: unknown[]) => ReturnType<typeof agent.post>).apply(target, args);
          return req.set('X-Requested-With', CSRF_HEADER);
        };
      }
      return value;
    },
  });
}
