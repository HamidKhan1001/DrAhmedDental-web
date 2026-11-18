// Vercel function → /admin and /admin/api/bookings/:id (rewritten here by vercel.json; logic in lib/app.mjs)
import { handle } from '../lib/app.mjs';

const run = (req) => handle('admin', req, { id: new URL(req.url).searchParams.get('id') || null });
export { run as GET, run as POST };
