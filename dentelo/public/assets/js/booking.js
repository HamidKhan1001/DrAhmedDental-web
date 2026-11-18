'use strict';

/**
 * Appointment booking + call-back requests.
 * Talks to the booking API (lib/app.mjs):  GET /api/config, GET /api/availability, POST /api/bookings
 * Set window.BOOKING_API to point at another origin if the API is hosted elsewhere.
 */
(function () {
  const API = (window.BOOKING_API || '').replace(/\/$/, '');
  const DEFAULT_SERVICES = ['Check-up & Cleaning', 'Root Canal', 'Alignment Teeth', 'Cosmetic Teeth', 'Oral Hygiene', 'Cavity Inspection', 'Live Advisory', 'Other / Not sure'];
  let config = { services: DEFAULT_SERVICES, openDays: [1, 2, 3, 4, 5, 6], bookAheadDays: 90 };

  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const nice = (dateStr) => new Date(dateStr + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function nextOpenDay(from = new Date()) {
    const d = new Date(from);
    if (d.getHours() >= 21) d.setDate(d.getDate() + 1);
    while (!config.openDays.includes(d.getDay())) d.setDate(d.getDate() + 1);
    return d;
  }

  async function api(path, opts) {
    const r = await fetch(API + path, opts);
    let data = {};
    try { data = await r.json(); } catch (e) { /* non-JSON */ }
    return { status: r.status, data };
  }

  /* ---------------------------------------------------------------- dialog markup */

  const dlg = document.createElement('dialog');
  dlg.className = 'booking';
  dlg.setAttribute('aria-labelledby', 'booking-title');
  dlg.innerHTML = `
    <form class="booking-form" novalidate>
      <header class="booking-head">
        <div>
          <p class="booking-eyebrow">Book an appointment</p>
          <h2 class="booking-title" id="booking-title">Visit Dr. Ahmed</h2>
        </div>
        <button type="button" class="booking-close" data-close aria-label="Close">
          <ion-icon name="close-outline" aria-hidden="true"></ion-icon>
        </button>
      </header>

      <div class="booking-body">
        <label class="field">
          <span class="field-label">Service</span>
          <select name="service" required></select>
          <span class="field-error" data-err="service"></span>
        </label>

        <div class="field">
          <label class="field-label" for="booking-date">Date</label>
          <input type="date" id="booking-date" name="date" required>
          <span class="field-hint mono">Mon–Sat · 9:00–22:00</span>
          <span class="field-error" data-err="date"></span>
        </div>

        <fieldset class="field">
          <legend class="field-label">Time</legend>
          <div class="slots" role="radiogroup" aria-label="Available times"><p class="slots-msg">Choose a date to see open times.</p></div>
          <span class="field-error" data-err="time"></span>
        </fieldset>

        <div class="field-row">
          <label class="field">
            <span class="field-label">Your name</span>
            <input type="text" name="name" autocomplete="name" required maxlength="80">
            <span class="field-error" data-err="name"></span>
          </label>
          <label class="field">
            <span class="field-label">Phone</span>
            <input type="tel" name="phone" autocomplete="tel" required maxlength="20">
            <span class="field-error" data-err="phone"></span>
          </label>
        </div>

        <label class="field">
          <span class="field-label">Email <span class="optional">optional</span></span>
          <input type="email" name="email" autocomplete="email" maxlength="120">
          <span class="field-error" data-err="email"></span>
        </label>

        <label class="field">
          <span class="field-label">Anything we should know? <span class="optional">optional</span></span>
          <textarea name="notes" rows="2" maxlength="500" placeholder="e.g. tooth pain on the lower left, nervous patient, first visit"></textarea>
        </label>

        <label class="hp" aria-hidden="true">Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label>

        <p class="form-error" role="alert" hidden></p>
      </div>

      <footer class="booking-foot">
        <p class="booking-note">We'll call to confirm. No payment needed.</p>
        <button type="submit" class="btn booking-submit">Request appointment</button>
      </footer>
    </form>

    <div class="booking-done" hidden>
      <div class="done-mark"><ion-icon name="checkmark-outline" aria-hidden="true"></ion-icon></div>
      <p class="booking-eyebrow">Request received</p>
      <h2 class="booking-title">See you soon</h2>
      <p class="done-summary"></p>
      <p class="done-ref mono"></p>
      <p class="booking-note">The clinic will call you to confirm. Keep your reference in case you need to change it.</p>
      <button type="button" class="btn" data-close>Done</button>
    </div>`;
  document.body.appendChild(dlg);

  const form = dlg.querySelector('.booking-form');
  const done = dlg.querySelector('.booking-done');
  const sel = form.elements.service;
  const dateIn = form.elements.date;
  const slotsEl = dlg.querySelector('.slots');
  const formErr = dlg.querySelector('.form-error');
  const submitBtn = dlg.querySelector('.booking-submit');
  let chosenTime = null;

  function fillServices() {
    const keep = sel.value;
    sel.innerHTML = '<option value="">Choose a service…</option>' + config.services.map((s) => `<option>${esc(s)}</option>`).join('');
    if (keep && config.services.includes(keep)) sel.value = keep;
  }

  function setDateBounds() {
    const today = new Date();
    const max = new Date(); max.setDate(max.getDate() + config.bookAheadDays);
    dateIn.min = iso(today);
    dateIn.max = iso(max);
  }

  function showErrors(errors = {}) {
    dlg.querySelectorAll('[data-err]').forEach((el) => {
      const msg = errors[el.dataset.err] || '';
      el.textContent = msg;
      const input = el.parentElement.querySelector('input, select, textarea');
      if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    });
  }

  async function loadSlots() {
    chosenTime = null;
    showErrors({});
    const date = dateIn.value;
    if (!date) { slotsEl.innerHTML = '<p class="slots-msg">Choose a date to see open times.</p>'; return; }
    slotsEl.innerHTML = '<p class="slots-msg">Checking open times…</p>';
    try {
      const { data } = await api('/api/availability?date=' + encodeURIComponent(date));
      if (dateIn.value !== date) return; // user changed date meanwhile
      if (data.closed) { slotsEl.innerHTML = `<p class="slots-msg">${esc(data.reason)}</p>`; return; }
      const open = data.slots.filter((s) => s.available);
      if (!open.length) { slotsEl.innerHTML = '<p class="slots-msg">That day is fully booked. Please try another date.</p>'; return; }
      slotsEl.innerHTML = data.slots.map((s) =>
        `<button type="button" role="radio" aria-checked="false" class="slot" data-time="${s.time}" ${s.available ? '' : 'disabled aria-disabled="true" title="Taken"'}>${s.time}</button>`
      ).join('');
    } catch (e) {
      slotsEl.innerHTML = '<p class="slots-msg">Could not load times. Please check your connection or call the clinic.</p>';
    }
  }

  slotsEl.addEventListener('click', (e) => {
    const b = e.target.closest('.slot');
    if (!b || b.disabled) return;
    slotsEl.querySelectorAll('.slot').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    chosenTime = b.dataset.time;
    showErrors({});
  });

  dateIn.addEventListener('change', loadSlots);

  function open(service) {
    form.hidden = false; done.hidden = true;
    form.reset(); showErrors({}); formErr.hidden = true;
    if (service && config.services.includes(service)) sel.value = service;
    setDateBounds();
    dateIn.value = iso(nextOpenDay());
    loadSlots();
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    document.documentElement.classList.add('booking-open');
    setTimeout(() => (service ? dateIn : sel).focus(), 50);
  }

  function close() {
    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
  }

  dlg.addEventListener('close', () => document.documentElement.classList.remove('booking-open'));
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
    else if (e.target === dlg) close(); // click on backdrop
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formErr.hidden = true;
    const f = form.elements;
    const body = {
      type: 'appointment', service: f.service.value, date: f.date.value, time: chosenTime,
      name: f.name.value, phone: f.phone.value, email: f.email.value, notes: f.notes.value, website: f.website.value
    };

    // quick client-side checks; the server re-checks everything
    const errs = {};
    if (!body.service) errs.service = 'Choose a service.';
    if (!body.date) errs.date = 'Choose a date.';
    if (!body.time) errs.time = 'Choose a time.';
    if (body.name.trim().length < 2) errs.name = 'Please enter your name.';
    if (body.phone.replace(/\D/g, '').length < 7) errs.phone = 'Please enter a phone number we can call.';
    if (Object.keys(errs).length) { showErrors(errs); dlg.querySelector('[aria-invalid="true"], .slots')?.focus?.(); return; }

    submitBtn.disabled = true; submitBtn.textContent = 'Sending…';
    try {
      const { status, data } = await api('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (data.ok) {
        form.hidden = true; done.hidden = false;
        done.querySelector('.done-summary').textContent = `${data.service} on ${nice(data.date)} at ${data.time}.`;
        done.querySelector('.done-ref').textContent = 'Reference ' + data.ref;
        done.querySelector('[data-close]').focus();
      } else if (data.errors) {
        showErrors(data.errors);
        if (status === 409) loadSlots().then(() => showErrors(data.errors)); // someone took the slot: refresh
      } else {
        formErr.textContent = data.message || 'Something went wrong. Please try again or call the clinic.';
        formErr.hidden = false;
      }
    } catch (err) {
      formErr.textContent = 'Could not send your request. Please check your connection or call the clinic.';
      formErr.hidden = false;
    } finally {
      submitBtn.disabled = false; submitBtn.textContent = 'Request appointment';
    }
  });

  // every [data-book] opens the dialog; data-book="Root Canal" preselects the service
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-book]');
    if (!t) return;
    e.preventDefault();
    open(t.dataset.book || '');
  });

  // load clinic rules from the server (falls back to defaults if offline)
  api('/api/config').then(({ data }) => { if (data && data.services) config = data; fillServices(); }).catch(fillServices);
  fillServices();

  /* ---------------------------------------------------------------- call-back form */

  const cb = document.querySelector('[data-callback-form]');
  if (cb) {
    const msg = cb.parentElement.querySelector('[data-callback-msg]');
    const btn = cb.querySelector('button[type="submit"]');
    cb.addEventListener('submit', async (e) => {
      e.preventDefault();
      const phone = cb.elements.phone.value;
      const say = (text, ok) => { msg.textContent = text; msg.hidden = false; msg.classList.toggle('is-ok', !!ok); };
      if (phone.replace(/\D/g, '').length < 7) { say('Please enter a phone number we can call.'); cb.elements.phone.focus(); return; }
      btn.disabled = true;
      try {
        const { data } = await api('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'callback', phone, website: cb.elements.website.value }) });
        if (data.ok) { cb.reset(); say(`Thanks! Dr. Ahmed's clinic will call you back soon. Reference ${data.ref}.`, true); }
        else say((data.errors && data.errors.phone) || data.message || 'Something went wrong. Please try again.');
      } catch (err) {
        say('Could not send. Please check your connection or call the clinic.');
      } finally {
        btn.disabled = false;
      }
    });
  }
})();
