// Vercel function → /api/availability (logic in lib/app.mjs)
import { handle } from '../lib/app.mjs';

const run = (req) => handle('availability', req);
export { run as GET, run as POST, run as HEAD };
