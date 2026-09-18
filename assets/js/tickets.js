(function () {
  'use strict';
  const core = window.CamoTicketsCore;
  const config = window.CAMO_CONFIG || {};
  const $ = id => document.getElementById(id);
  const field = (form, name) => $(form).elements.namedItem(name);
  let service;
  let authorized = false;
  let currentUserId = null;
  let authEpoch = 0;
  let listEpoch = 0;
  let page = 0;
  let selectedTicket = null;
  let requestId = null;
  let submitting = false;
  let lastFolio = '';
  let propertyList = [];
  let refreshTimer;

  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }
  function feedback(id, message) {
    $(id).textContent = message || '';
    $(id).hidden = !message;
  }
  function message(error) { return core.errorMessage(error); }
  function date(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Chihuahua' }).format(parsed);
  }
  function badge(value, type = 'status') {
    const labels = type === 'status' ? core.statuses : core.urgencies;
    return node('span', type + '-badge ' + type + '-' + (Object.hasOwn(labels, value) ? value : 'normal'), labels[value] || value);
  }
  function button(label, handler, className = 'button button-secondary button-small') {
    const el = node('button', className, label);
    el.type = 'button';
    el.addEventListener('click', handler);
    return el;
  }
  function externalLink(label, href, className = 'button button-secondary button-small') {
    const el = node('a', className, label);
    el.href = href;
    el.target = '_blank';
    el.rel = 'noopener noreferrer';
    return el;
  }
  function busy(formId, active) {
    const form = $(formId);
    form.setAttribute('aria-busy', String(active));
    form.querySelectorAll('button').forEach(el => { el.disabled = active; });
  }
  function switchView(view, focus = false) {
    if (!['new', 'track', 'admin'].includes(view)) view = 'new';
    document.querySelectorAll('[data-view]').forEach(el => {
      const active = el.dataset.view === view;
      el.setAttribute('aria-selected', String(active));
      el.tabIndex = active ? 0 : -1;
      if (focus && active) el.focus();
    });
    ['new', 'track', 'admin'].forEach(name => { $('view-' + name).hidden = name !== view; });
  }
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', () => switchView(el.dataset.view));
    el.addEventListener('keydown', event => {
      const views = ['new', 'track', 'admin'];
      const index = views.indexOf(el.dataset.view);
      let next;
      if (event.key === 'ArrowRight') next = views[(index + 1) % 3];
      if (event.key === 'ArrowLeft') next = views[(index + 2) % 3];
      if (event.key === 'Home') next = views[0];
      if (event.key === 'End') next = views[2];
      if (next) { event.preventDefault(); switchView(next, true); }
    });
  });
  switchView(location.hash === '#administracion' ? 'admin' : location.hash === '#consultar' ? 'track' : 'new');

  function timeline(events) {
    const list = node('ol', 'timeline');
    [...(events || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).forEach(event => {
      const item = node('li', 'timeline-item');
      const time = node('time', 'timeline-date', date(event.created_at));
      time.dateTime = event.created_at;
      item.append(badge(event.status), time, node('p', 'timeline-note', event.note));
      list.append(item);
    });
    return list;
  }

  function updatePropertySelectors() {
    const active = propertyList.filter(property => property.active);
    [[$('report-property'), active, 'Selecciona tu residencial'], [$('filter-property'), propertyList, 'Todos los residenciales']].forEach(([select, properties, label]) => {
      const previous = select.value;
      const first = node('option', '', label);
      first.value = '';
      select.replaceChildren(first);
      properties.forEach(property => {
        const option = node('option', '', property.name + (property.active ? '' : ' (inactivo)'));
        option.value = property.id;
        select.append(option);
      });
      if (properties.some(property => property.id === previous)) select.value = previous;
    });
    $('report-fields').disabled = active.length === 0 || submitting;
    $('report-submit').disabled = active.length === 0 || submitting;
    if (!active.length) feedback('report-error', 'Aún no hay residenciales disponibles. Comunícate con CAMO al 614 216 1556 para registrar tu incidencia.');
    else feedback('report-error', '');
  }

  async function loadProperties(all = authorized) {
    const epoch = authEpoch;
    const properties = await service.properties(all);
    if (epoch !== authEpoch) return;
    propertyList = properties || [];
    updatePropertySelectors();
    $('connection-label').textContent = 'Atención residencial';
    feedback('global-feedback', '');
    if (authorized) renderProperties();
  }

  function renderProperties() {
    $('properties-list').replaceChildren();
    for (const property of propertyList) {
      const row = node('div', 'property-row');
      row.append(node('span', 'property-name', property.name + (property.active ? '' : ' · Inactivo')));
      const action = button(property.active ? 'Desactivar' : 'Activar', async () => {
        action.disabled = true;
        feedback('properties-error', '');
        try { await service.setPropertyActive(property.id, !property.active); await loadProperties(true); }
        catch (error) { feedback('properties-error', message(error)); action.disabled = false; }
      }, 'button button-ghost button-small');
      row.append(action);
      $('properties-list').append(row);
    }
  }

  $('report-form').addEventListener('input', event => {
    requestId = null;
    event.target.setCustomValidity?.('');
  });
  $('report-form').addEventListener('change', () => { requestId = null; });
  $('report-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!service || submitting) return;
    feedback('report-error', '');
    const values = Object.fromEntries(new FormData($('report-form')));
    if (values.website) { feedback('report-error', 'No se pudo enviar el formulario. Recarga la página e inténtalo de nuevo.'); return; }
    try { core.normalizePhone(values.phone); }
    catch (error) { field('report-form', 'phone').setCustomValidity(error.message); $('report-form').reportValidity(); return; }
    if (!$('report-form').reportValidity()) return;
    requestId ||= crypto.randomUUID();
    submitting = true;
    busy('report-form', true);
    $('report-fields').disabled = true;
    $('report-submit').textContent = 'Registrando incidencia…';
    try {
      const receipt = await service.createTicket(values, requestId);
      lastFolio = receipt.folio;
      $('success-folio').textContent = receipt.folio;
      $('success-date').textContent = date(receipt.created_at);
      const property = propertyList.find(item => item.id === values.property_id)?.name || '';
      $('success-whatsapp').href = core.whatsAppUrl(config.adminWhatsApp || '526142161556', `Hola, registré la incidencia #${receipt.folio} en ${property}, ${values.unit}. Categoría: ${core.categories[values.category]}. ${values.description}`);
      $('success-whatsapp').rel = 'noopener noreferrer';
      $('report-form').hidden = true;
      $('report-success').hidden = false;
      $('report-success').focus();
      field('track-form', 'folio').value = receipt.folio;
      field('track-form', 'phone').value = values.phone;
      $('report-form').reset();
      requestId = null;
    } catch (error) { feedback('report-error', message(error)); }
    finally {
      submitting = false;
      busy('report-form', false);
      $('report-fields').disabled = propertyList.filter(item => item.active).length === 0;
      $('report-submit').textContent = 'Registrar incidencia y generar folio';
    }
  });
  $('report-again').addEventListener('click', () => {
    $('report-success').hidden = true;
    $('report-form').hidden = false;
    $('report-property').focus();
  });
  $('success-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(lastFolio); $('success-copy').textContent = 'Folio copiado'; }
    catch { $('success-copy').textContent = 'Selecciona el folio para copiarlo'; }
  });
  $('track-form').addEventListener('input', event => { event.target.setCustomValidity?.(''); $('track-result').hidden = true; feedback('track-error', ''); });
  $('track-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!service || $('track-form').getAttribute('aria-busy') === 'true') return;
    feedback('track-error', '');
    $('track-result').hidden = true;
    const folio = field('track-form', 'folio').value;
    const phone = field('track-form', 'phone').value;
    try { core.normalizePhone(phone); } catch (error) { feedback('track-error', error.message); return; }
    busy('track-form', true);
    try {
      const ticket = await service.track(folio, phone);
      // No mostrar una respuesta de una búsqueda que el residente ya editó.
      if (folio !== field('track-form', 'folio').value || phone !== field('track-form', 'phone').value) return;
      if (!ticket) { feedback('track-error', 'No encontramos un reporte con ese folio y teléfono. Revisa ambos datos o comunícate con CAMO.'); return; }
      const header = node('div', 'ticket-top');
      header.append(node('h3', 'ticket-folio', '#' + ticket.folio), badge(ticket.status));
      $('track-result').replaceChildren(header, node('p', 'ticket-meta', ticket.property_name + ' · ' + date(ticket.created_at)), node('h4', '', core.categories[ticket.category] || ticket.category), node('p', 'ticket-description', ticket.description), node('h4', '', 'Seguimiento de tu reporte'), timeline(ticket.events));
      $('track-result').hidden = false;
      $('track-result').tabIndex = -1;
      $('track-result').focus();
    } catch (error) { feedback('track-error', message(error)); }
    finally { busy('track-form', false); }
  });

  function clearAdmin() {
    authorized = false;
    currentUserId = null;
    listEpoch++;
    clearInterval(refreshTimer);
    $('admin-dashboard').hidden = true;
    $('admin-gate').hidden = false;
    $('admin-list').replaceChildren();
    $('properties-list').replaceChildren();
    $('admin-email').textContent = '';
    ['total', ...Object.keys(core.statuses)].forEach(key => { $('kpi-' + key).textContent = '—'; });
    ['update-dialog', 'archive-dialog'].forEach(id => { if ($(id).open) $(id).close(); });
    selectedTicket = null;
  }
  async function syncSession(session) {
    // Supabase también emite SIGNED_IN al recuperar foco en la misma sesión.
    // Revalidar permisos sin destruir una nota que se está redactando.
    if (authorized && session?.user?.id === currentUserId) {
      const currentEpoch = authEpoch;
      try {
        const allowed = await service.isAdmin();
        if (currentEpoch === authEpoch && !allowed) {
          ++authEpoch;
          clearAdmin();
          feedback('login-error', 'Tu cuenta ya no tiene acceso a la administración de CAMO.');
        }
      } catch (error) { if (currentEpoch === authEpoch) feedback('admin-error', message(error)); }
      return;
    }
    const epoch = ++authEpoch;
    clearAdmin();
    if (!session) return;
    try {
      const isAdmin = await service.isAdmin();
      if (epoch !== authEpoch) return;
      if (!isAdmin) { feedback('login-error', 'Esta cuenta no tiene acceso a la administración de CAMO. Solicita que te autoricen.'); return; }
      authorized = true;
      currentUserId = session.user.id;
      page = 0;
      feedback('login-error', '');
      $('admin-email').textContent = session.user.email;
      $('admin-gate').hidden = true;
      $('admin-dashboard').hidden = false;
      await Promise.all([loadProperties(true), loadAdmin()]);
      if (epoch === authEpoch && authorized) refreshTimer = setInterval(() => {
        if (!document.hidden && !$('view-admin').hidden && !$('update-dialog').open && !$('archive-dialog').open) loadAdmin();
      }, 60000);
    } catch (error) { if (epoch === authEpoch) feedback(authorized ? 'admin-error' : 'login-error', message(error)); }
  }
  $('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!service || $('login-form').getAttribute('aria-busy') === 'true') return;
    feedback('login-error', '');
    busy('login-form', true);
    try {
      const { session } = await service.signIn(field('login-form', 'email').value, field('login-form', 'password').value);
      field('login-form', 'password').value = '';
      await syncSession(session);
    } catch (error) { feedback('login-error', message(error)); }
    finally { busy('login-form', false); }
  });
  $('logout-btn').addEventListener('click', async () => {
    ++authEpoch;
    clearAdmin();
    try { await service.signOut(); await loadProperties(false); }
    catch (error) { feedback('login-error', 'No se pudo cerrar la sesión por completo. Revisa la conexión y vuelve a ingresar para cerrarla.'); }
  });

  function ticketCard(ticket) {
    const card = node('article', 'ticket-card');
    const header = node('div', 'ticket-top');
    header.append(node('h3', 'ticket-folio', '#' + ticket.folio), badge(ticket.status));
    const category = node('div', 'ticket-top');
    category.append(node('h4', '', core.categories[ticket.category] || ticket.category), badge(ticket.urgency, 'urgency'));
    card.append(header, node('p', 'ticket-meta', (ticket.property?.name || '') + ' · ' + ticket.unit + ' · ' + date(ticket.created_at)), category, node('p', 'ticket-description', ticket.description), node('p', 'ticket-meta', ticket.resident_name + ' · +' + ticket.phone));
    const events = [...(ticket.events || [])].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    const latest = events[0]?.note || 'En espera de revisión.';
    const details = node('details', 'ticket-detail');
    details.append(node('summary', '', 'Ver historial de seguimiento (' + events.length + ')'), timeline(events));
    card.append(node('p', 'timeline-note', latest), details);
    const actions = node('div', 'ticket-actions');
    for (const [status, label] of Object.entries(core.statuses)) actions.append(button(label, () => openUpdate(ticket, status)));
    const text = `Hola ${ticket.resident_name}, le escribe la administración de CAMO. Su reporte #${ticket.folio} sobre ${core.categories[ticket.category]} en ${ticket.property?.name || ''} se encuentra: ${core.statuses[ticket.status]}. Nota: ${latest}`;
    actions.append(externalLink('Notificar por WhatsApp', core.whatsAppUrl('+' + ticket.phone, text)), button('Archivar', () => {
      selectedTicket = ticket;
      $('archive-folio').textContent = '#' + ticket.folio;
      feedback('archive-error', '');
      $('archive-dialog').showModal();
    }, 'button button-ghost button-small'));
    card.append(actions);
    return card;
  }
  async function loadAdmin() {
    if (!authorized) return;
    const epoch = ++listEpoch;
    const currentAuth = authEpoch;
    $('refresh-btn').disabled = true;
    $('admin-list').setAttribute('aria-busy', 'true');
    feedback('admin-error', '');
    try {
      const [result, metrics] = await Promise.all([
        service.list({ property: $('filter-property').value, status: $('filter-status').value, search: $('filter-search').value, page }), service.metrics()
      ]);
      if (epoch !== listEpoch || currentAuth !== authEpoch || !authorized) return;
      if (page > 0 && !result.data.length) { page--; return await loadAdmin(); }
      $('admin-list').replaceChildren(...result.data.map(ticketCard));
      if (!result.data.length) $('admin-list').append(node('div', 'empty-state', 'No hay incidencias con estos filtros. Los reportes que recibas aparecerán aquí.'));
      for (const [key, count] of Object.entries(metrics)) $('kpi-' + key).textContent = count;
      $('list-count').textContent = result.count + (result.count === 1 ? ' incidencia' : ' incidencias');
      $('page-label').textContent = 'Página ' + (page + 1) + ' de ' + Math.max(1, Math.ceil(result.count / 12));
      $('prev-page').disabled = page === 0;
      $('next-page').disabled = (page + 1) * 12 >= result.count;
    } catch (error) {
      if (epoch === listEpoch && currentAuth === authEpoch) {
        $('admin-list').replaceChildren();
        ['total', ...Object.keys(core.statuses)].forEach(key => { $('kpi-' + key).textContent = '—'; });
        feedback('admin-error', message(error));
      }
    } finally {
      if (epoch === listEpoch) { $('refresh-btn').disabled = false; $('admin-list').setAttribute('aria-busy', 'false'); }
    }
  }
  $('refresh-btn').addEventListener('click', () => loadAdmin());
  $('prev-page').addEventListener('click', () => { page = Math.max(0, page - 1); loadAdmin(); });
  $('next-page').addEventListener('click', () => { page++; loadAdmin(); });
  ['filter-property', 'filter-status'].forEach(id => $(id).addEventListener('change', () => { page = 0; loadAdmin(); }));
  let searchTimer;
  $('filter-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page = 0; loadAdmin(); }, 250); });
  $('properties-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!authorized || $('properties-form').getAttribute('aria-busy') === 'true') return;
    busy('properties-form', true);
    feedback('properties-error', '');
    try { await service.addProperty(field('properties-form', 'name').value); $('properties-form').reset(); await loadProperties(true); }
    catch (error) { feedback('properties-error', message(error)); }
    finally { busy('properties-form', false); }
  });
  function openUpdate(ticket, status) {
    selectedTicket = ticket;
    $('update-folio').textContent = '#' + ticket.folio;
    field('update-form', 'status').value = status;
    field('update-form', 'note').value = '';
    feedback('update-error', '');
    $('update-dialog').showModal();
  }
  ['update', 'archive'].forEach(type => {
    $('cancel-' + type).addEventListener('click', () => $(type + '-dialog').close());
    $(type + '-dialog').addEventListener('cancel', event => { if ($(type + '-form').getAttribute('aria-busy') === 'true') event.preventDefault(); });
    $(type + '-form').addEventListener('submit', async event => {
      event.preventDefault();
      const ticket = selectedTicket;
      if (!authorized || !ticket || $(type + '-form').getAttribute('aria-busy') === 'true') return;
      feedback(type + '-error', '');
      busy(type + '-form', true);
      try {
        if (type === 'update') await service.update(ticket, field('update-form', 'status').value, field('update-form', 'note').value);
        else await service.archive(ticket);
        $(type + '-dialog').close();
        selectedTicket = null;
        await loadAdmin();
      } catch (error) { feedback(type + '-error', message(error)); }
      finally { busy(type + '-form', false); }
    });
  });

  async function init() {
    if (!core.isConfigured(config) || !window.supabase?.createClient) {
      $('connection-label').textContent = 'Atención por teléfono o WhatsApp';
      feedback('global-feedback', 'El portal de incidencias aún no está disponible. Para reportar una falla, comunícate con CAMO al 614 216 1556.');
      ['report-form', 'track-form', 'login-form'].forEach(id => $(id).querySelectorAll('button[type="submit"], input, select, textarea').forEach(el => { el.disabled = true; }));
      return;
    }
    try {
      const client = window.supabase.createClient(config.url, config.publicKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage: window.sessionStorage, storageKey: 'camo-admin-auth' }
      });
      service = core.createService(client);
      client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') { ++authEpoch; clearAdmin(); }
        else if (event === 'SIGNED_IN' && $('login-form').getAttribute('aria-busy') !== 'true') setTimeout(() => syncSession(session), 0);
      });
      const session = await service.session();
      await syncSession(session);
      await loadProperties(authorized);
    } catch (error) {
      $('connection-label').textContent = 'Servicio no disponible';
      feedback('global-feedback', 'No pudimos conectar con atención residencial. Recarga la página para reintentar o llama al 614 216 1556.');
    }
  }
  init();
})();
