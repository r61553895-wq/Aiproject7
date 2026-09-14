import { app } from '../server/app';

export default function handler(req: any, res: any) {
  // Normalize req.url so Express router matches '/api/chat' or '/chat'
  if (!req.url || req.url === '/' || req.url.startsWith('/?')) {
    req.url = '/api/chat' + (req.url.startsWith('/?') ? req.url.slice(1) : '');
  }
  return app(req, res);
}
