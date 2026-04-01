import { timingSafeEqual } from 'crypto';
import { getConfig } from '../data/settings/configs.js';

let _secret = null;

export async function verifyIngestRequest(request, reply) {
  const secret = request.headers['x-ingest-secret'];
  if (!secret) {
    reply.code(401).send({ error: 'Missing x-ingest-secret header' });
    return;
  }

  if (!_secret) _secret = await getConfig('ingest_secret');
  const stored = _secret;
  if (!stored) {
    reply.code(500).send({ error: 'INGEST_SECRET not configured' });
    return;
  }

  try {
    const a = Buffer.from(secret);
    const b = Buffer.from(stored);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      reply.code(401).send({ error: 'Invalid ingest secret' });
      return;
    }
  } catch {
    reply.code(401).send({ error: 'Invalid ingest secret' });
    return;
  }
}
