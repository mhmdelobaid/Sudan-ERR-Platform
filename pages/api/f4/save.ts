/**
 * MAP-parity F4 save into the launch database (see services/f4SaveCore.ts).
 * Auth: the caller's session. Writes: service role, after the project access check.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { validateSession } from '../../../services/auth';
import { saveF4 } from '../../../services/f4SaveCore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
  const accessToken = authHeader.replace('Bearer ', '');
  const user = await validateSession(accessToken);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const out = await saveF4({ accessToken, user, input: req.body || {} });
  return res.status(out.status).json(out.json);
}
