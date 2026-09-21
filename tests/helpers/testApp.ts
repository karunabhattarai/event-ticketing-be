import request from 'supertest';
import { createApp } from '../../src/app';

export function testApp() {
  return request(createApp());
}
