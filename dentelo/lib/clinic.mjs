/**
 * Clinic opening rules and booking validation (shared by server.mjs and the Vercel functions).
 *
 * All "today / now" logic runs on the clinic's wall clock, set with CLINIC_TZ
 * (an IANA zone such as "Asia/Karachi"). Vercel servers run on UTC, so set it there.
 */
import crypto from 'node:crypto';

export const CLINIC = {
  // 0 = Sunday … 6 = Saturday; matches the site footer (Mon–Sat, 9:00–22:00)
  openDays: [1, 2, 3, 4, 5, 6],
  open: '09:00',
  close: '22:00',
  slotMinutes: 30,
  bookAheadDays: 90,
  services: ['Check-up & Cleaning', 'Root Canal', 'Alignment Teeth', 'Cosmetic Teeth', 'Oral Hygiene', 'Cavity Inspection', 'Live Advisory', 'Other / Not sure']
};

export const STATUSES = ['pending', 'confirmed', 'cancelled', 'done'];

const TZ = process.env.CLINIC_TZ || undefined;

/**
 * A Date whose *local* getters (getFullYear, getHours, …) read the clinic's wall-clock time,
 * whatever timezone the server runs in. Only use it for calendar maths, never for timestamps.
 */
export function clinicWall(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(now).map(p => [p.type, p.value])
  );
  return new Date(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
}

const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export function allSlots() {
  const out = [];
  for (let t = toMin(CLINIC.open); t + CLINIC.slotMinutes <= toMin(CLINIC.close); t += CLINIC.slotMinutes) out.push(toHHMM(t));
  return out;
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Today's date (YYYY-MM-DD) at the clinic. */
export const clinicToday = (now = new Date()) => ymd(clinicWall(now));

/** Validate a YYYY-MM-DD date for booking. Returns an error string or null. */
export function checkDate(date, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return 'Choose a date.';
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(y, m - 1, d);
  if (day.getFullYear() !== y || day.getMonth() !== m - 1 || day.getDate() !== d) return 'That date does not exist.';
  const wall = clinicWall(now);
  const today = new Date(wall.getFullYear(), wall.getMonth(), wall.getDate());
  if (day < today) return 'That date has already passed.';
  const last = new Date(today); last.setDate(last.getDate() + CLINIC.bookAheadDays);
  if (day > last) return `Bookings open up to ${CLINIC.bookAheadDays} days ahead.`;
  if (!CLINIC.openDays.includes(day.getDay())) return 'The clinic is closed on Sundays.';
  return null;
}

/** Slots for a date, marking taken and already-past ones. */
export function availability(date, bookings, now = new Date()) {
  const taken = new Set(bookings.filter(b => b.type === 'appointment' && b.date === date && b.status !== 'cancelled').map(b => b.time));
  const wall = clinicWall(now);
  const isToday = date === ymd(wall);
  const nowMin = wall.getHours() * 60 + wall.getMinutes();
  return allSlots().map(time => ({
    time,
    available: !taken.has(time) && !(isToday && toMin(time) <= nowMin + 30)
  }));
}

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[+()\-.\s\d]{7,20}$/;

export const TAKEN_MSG = 'Sorry, that time was just taken. Please pick another.';

/** Validate a booking request body. Returns { errors } or { booking }. */
export function validate(body, bookings, now = new Date()) {
  const errors = {};
  const type = body.type === 'callback' ? 'callback' : 'appointment';
  const name = clean(body.name, 80);
  const phone = clean(body.phone, 20);
  const email = clean(body.email, 120);
  const notes = clean(body.notes, 500);

  if (type === 'appointment' && name.length < 2) errors.name = 'Please enter your name.';
  if (!PHONE.test(phone) || phone.replace(/\D/g, '').length < 7) errors.phone = 'Please enter a phone number we can call.';
  if (email && !EMAIL.test(email)) errors.email = 'That email address looks incomplete.';

  let service = null, date = null, time = null;
  if (type === 'appointment') {
    service = CLINIC.services.includes(body.service) ? body.service : null;
    if (!service) errors.service = 'Choose a service.';
    date = clean(body.date, 10);
    const dErr = checkDate(date, now);
    if (dErr) errors.date = dErr;
    time = clean(body.time, 5);
    if (!dErr) {
      const slot = availability(date, bookings, now).find(s => s.time === time);
      if (!slot) errors.time = 'Choose a time.';
      else if (!slot.available) errors.time = TAKEN_MSG;
    }
  }

  if (Object.keys(errors).length) return { errors };
  return {
    booking: {
      id: crypto.randomUUID(),
      ref: 'DA-' + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6),
      type, name: name || null, phone, email: email || null, service, date, time, notes: notes || null,
      status: 'pending',
      createdAt: now.toISOString()
    }
  };
}
