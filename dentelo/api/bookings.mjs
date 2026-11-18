// Vercel function → /api/bookings (logic in lib/app.mjs)
import { handle } from '../lib/app.mjs';

const run = (req) => handle('bookings', req);
export { run as GET, run as POST, run as HEAD };
