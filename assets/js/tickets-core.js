(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CamoTicketsCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const statuses = { pendiente: 'Pendiente', en_proceso: 'En proceso', resuelto: 'Resuelto' };
  const categories = { alumbrado: 'Alumbrado y luminarias', accesos: 'Portón y accesos', agua: 'Fugas de agua y riego', 'areas-verdes': 'Parques y áreas verdes', elevadores: 'Elevadores y mantenimiento', ruido: 'Ruido y convivencia', limpieza: 'Limpieza y basura', otro: 'Otra situación' };
  const urgencies = { normal: 'Normal', alta: 'Alta', urgente: 'Urgente' };

  function normalizePhone(value) {
    const raw = String(value || '').trim();
    if (!/^\+?[\d\s().-]+$/.test(raw)) throw new Error('Escribe un teléfono válido, con lada internacional si no es de México.');
    const digits = raw.replace(/\D/g, '');
    if (!raw.startsWith('+') && digits.length === 10) return '52' + digits;
    if (/^52\d{10}$/.test(digits)) return digits;
    if (raw.startsWith('+') && /^[1-9]\d{7,14}$/.test(digits)) return digits;
    throw new Error('Escribe 10 dígitos para México o usa + y la lada de tu país.');
  }

  function isConfigured(config) {
    if (!config || !config.publicKey) return false;
    try {
      const url = new URL(config.url);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return false;
      if (config.publicKey.startsWith('sb_publishable_')) return true;
      const part = config.publicKey.split('.')[1];
      const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
      return json.role === 'anon';
    } catch { return false; }
  }

  function whatsAppUrl(phone, message) {
    return 'https://wa.me/' + normalizePhone(phone.startsWith('+') ? phone : (/^52\d{10}$/.test(phone) || phone.replace(/\D/g, '').length === 10 ? phone : '+' + phone)) + '?text=' + encodeURIComponent(message);
  }

  function errorMessage(error) {
    if (error && error.safeMessage) return error.safeMessage;
    if (error?.code === '40001') return 'Otra persona actualizó este reporte. Cierra esta ventana, actualiza la lista y vuelve a intentarlo.';
    if (['42501', '28000', 'PGRST301', 'PGRST302'].includes(error?.code)) return 'Tu sesión no tiene permiso para esta acción. Vuelve a ingresar con una cuenta autorizada.';
    if (error?.code === '23505') return 'Ese registro ya existe. Revisa los datos antes de intentarlo de nuevo.';
    if (error?.code === '22023') return 'Revisa los campos: hay datos vacíos, demasiado largos o con formato incorrecto.';
    if (error?.code === 'P0001' && /rate|limit|límite|demasiad/i.test(error.message)) return 'Se alcanzó el límite de reportes para este teléfono. Espera una hora o contacta a CAMO.';
    if (error?.code === 'P0001') return 'No se pudo registrar el cambio. Actualiza la página y revisa los datos antes de intentarlo de nuevo.';
    if (/Invalid login|invalid_credentials|Email not confirmed/i.test((error?.message || '') + (error?.code || ''))) return 'No pudimos iniciar sesión. Revisa tu correo y contraseña.';
    return 'No pudimos conectar con el servicio. Tus datos siguen en el formulario; revisa tu conexión y vuelve a intentarlo.';
  }

  function createService(client) {
    const ticketFields = 'id,folio,property_id,unit,resident_name,phone,category,urgency,status,description,created_at,updated_at,archived_at,property:camo_properties(name),events:camo_ticket_events(id,status,note,created_at)';
    async function result(request) {
      let response;
      try { response = await request; } catch { throw new Error(errorMessage()); }
      if (response.error) {
        const error = new Error(errorMessage(response.error));
        error.safeMessage = error.message;
        error.code = response.error.code;
        throw error;
      }
      return response;
    }
    return {
      async properties(all = false) {
        let query = client.from('camo_properties').select('id,name,active').order('name');
        if (!all) query = query.eq('active', true);
        return (await result(query)).data;
      },
      async createTicket(values, requestId) {
        const args = { p_request_id: requestId };
        for (const key of ['property_id','unit','resident_name','phone','category','urgency','description']) args['p_' + key] = String(values[key] || '').trim();
        const receipt = (await result(client.rpc('camo_create_ticket', args))).data;
        if (!receipt?.folio) throw new Error(errorMessage());
        return receipt;
      },
      async track(folio, phone) { return (await result(client.rpc('camo_track_ticket', { p_folio: folio.trim().replace(/^#/, '').toUpperCase(), p_phone: phone.trim() }))).data; },
      async isAdmin() { return (await result(client.rpc('camo_is_admin'))).data === true; },
      async signIn(email, password) { return (await result(client.auth.signInWithPassword({ email: email.trim(), password }))).data; },
      async signOut() { await result(client.auth.signOut({ scope: 'local' })); },
      async session() { return (await result(client.auth.getSession())).data.session; },
      async list({ property = '', status = '', search = '', page = 0, pageSize = 12 } = {}) {
        let query = client.from('camo_tickets').select(ticketFields, { count: 'exact' }).is('archived_at', null);
        if (property) query = query.eq('property_id', property);
        if (status) query = query.eq('status', status);
        if (search.trim()) query = query.ilike('folio', '%' + search.trim().replace(/^#/, '').replace(/[\\%_]/g, '\\$&') + '%');
        return result(query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(page * pageSize, (page + 1) * pageSize - 1));
      },
      async metrics() {
        const keys = ['total', ...Object.keys(statuses)];
        const counts = await Promise.all(keys.map(async key => {
          let query = client.from('camo_tickets').select('id', { count: 'exact', head: true }).is('archived_at', null);
          if (key !== 'total') query = query.eq('status', key);
          return (await result(query)).count;
        }));
        return Object.fromEntries(keys.map((key, index) => [key, counts[index]]));
      },
      async update(ticket, status, note) { return (await result(client.rpc('camo_update_ticket', { p_ticket_id: ticket.id, p_status: status, p_note: note.trim(), p_expected_updated_at: ticket.updated_at }))).data; },
      async archive(ticket) { return (await result(client.rpc('camo_archive_ticket', { p_ticket_id: ticket.id, p_expected_updated_at: ticket.updated_at }))).data; },
      async addProperty(name) { return result(client.from('camo_properties').insert({ name: name.trim() })); },
      async setPropertyActive(id, active) { return result(client.from('camo_properties').update({ active }).eq('id', id)); }
    };
  }
  return { statuses, categories, urgencies, normalizePhone, isConfigured, whatsAppUrl, errorMessage, createService };
});
