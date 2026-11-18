// Vercel function → /api/config (logic in lib/app.mjs)
import { handle } from '../lib/app.mjs';

const run = (req) => handle('config', req);
export { run as GET, run as POST, run as HEAD };
