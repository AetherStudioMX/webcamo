// Menú móvil: mantener el estado visual y accesible sincronizado.
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const mobileMenu = document.getElementById('mobileMenu');
const siteHeader = document.querySelector('header');

function updateMobileMenuHeight() {
  const menuTop = Math.max(0, siteHeader.getBoundingClientRect().bottom);
  mobileMenu.style.setProperty('--mobile-menu-top', `${menuTop}px`);
}

function setMobileMenuOpen(isOpen) {
  mobileMenu.classList.toggle('hidden', !isOpen);
  mobileMenuBtn.setAttribute('aria-expanded', String(isOpen));
  mobileMenuBtn.setAttribute('aria-label', isOpen ? 'Cerrar menú' : 'Abrir menú');
  document.body.classList.toggle('mobile-menu-open', isOpen);
  if (isOpen) updateMobileMenuHeight();
}

mobileMenuBtn.addEventListener('click', () => {
  setMobileMenuOpen(mobileMenuBtn.getAttribute('aria-expanded') !== 'true');
});

document.querySelectorAll('header a').forEach(link => {
  link.addEventListener('click', () => setMobileMenuOpen(false));
});

document.addEventListener('focusin', event => {
  if (mobileMenuBtn.getAttribute('aria-expanded') === 'true' && !siteHeader.contains(event.target)) {
    setMobileMenuOpen(false);
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && mobileMenuBtn.getAttribute('aria-expanded') === 'true') {
    setMobileMenuOpen(false);
    mobileMenuBtn.focus();
  }
});

window.matchMedia('(min-width: 1280px)').addEventListener('change', event => {
  if (event.matches) setMobileMenuOpen(false);
});

['resize', 'scroll'].forEach(eventName => {
  window.addEventListener(eventName, () => {
    if (mobileMenuBtn.getAttribute('aria-expanded') === 'true') updateMobileMenuHeight();
  }, { passive: true });
});

// En estas secciones ya hay contacto directo; el acceso flotante no debe taparlo.
const floatingWhatsApp = document.getElementById('floatingWhatsApp');
const contactSections = Array.from(document.querySelectorAll('#cotizador, #contacto, footer'));
const visibleContactSections = new Map();

function updateFloatingWhatsApp(activeElement = document.activeElement) {
  const contactIsVisible = Array.from(visibleContactSections.values()).some(Boolean);
  floatingWhatsApp.hidden = contactIsVisible && !floatingWhatsApp.contains(activeElement);
}

function measureContactSections() {
  contactSections.forEach(section => {
    const bounds = section.getBoundingClientRect();
    visibleContactSections.set(section, bounds.top < window.innerHeight && bounds.bottom > 0);
  });
  updateFloatingWhatsApp();
}

measureContactSections();
if (typeof window.IntersectionObserver === 'function') {
  const contactObserver = new window.IntersectionObserver(entries => {
    entries.forEach(entry => visibleContactSections.set(entry.target, entry.isIntersecting));
    updateFloatingWhatsApp();
  });
  contactSections.forEach(section => contactObserver.observe(section));
} else {
  ['scroll', 'resize'].forEach(eventName => window.addEventListener(eventName, measureContactSections, { passive: true }));
}

floatingWhatsApp.addEventListener('focusout', event => updateFloatingWhatsApp(event.relatedTarget));

// Conservar una salida visible cuando el navegador bloquea una pestaña nueva.
function clearWhatsAppFeedback(prefix) {
  document.getElementById(`${prefix}WhatsAppFeedback`).hidden = true;
  document.getElementById(`${prefix}WhatsAppLink`).removeAttribute('href');
}

function openWhatsApp(url, prefix) {
  clearWhatsAppFeedback(prefix);
  try {
    const popup = window.open(url, '_blank');
    if (popup) {
      try { popup.opener = null; } catch { /* Algunos navegadores aíslan la pestaña automáticamente. */ }
      return;
    }
  } catch {
    // El enlace normal permite continuar incluso si window.open está bloqueado.
  }
  const fallbackLink = document.getElementById(`${prefix}WhatsAppLink`);
  fallbackLink.setAttribute('href', url);
  document.getElementById(`${prefix}WhatsAppFeedback`).hidden = false;
  fallbackLink.focus();
}

// FAQ: solo una respuesta abierta a la vez.
const faqButtons = document.querySelectorAll('.faq-btn');
faqButtons.forEach(button => {
  button.addEventListener('click', () => {
    const shouldOpen = button.getAttribute('aria-expanded') !== 'true';
    faqButtons.forEach(otherButton => {
      const isOpen = otherButton === button && shouldOpen;
      otherButton.setAttribute('aria-expanded', String(isOpen));
      document.getElementById(otherButton.getAttribute('aria-controls')).classList.toggle('hidden', !isOpen);
    });
  });
});

// CALCULADORA / COTIZADOR INTERACTIVO
const propertyTypeButtons = document.querySelectorAll('.prop-type-btn');
let selectedType = Array.from(propertyTypeButtons).find(button => button.getAttribute('aria-pressed') === 'true')?.getAttribute('data-type') || 'Fraccionamiento';
const unitsInput = document.getElementById('unitsInput');
const unitsRange = document.getElementById('unitsRange');
const unitsDisplay = document.getElementById('unitsDisplay');
const unitsMaxLabel = document.getElementById('unitsMaxLabel');
const unitsError = document.getElementById('unitsError');
const calcPlanTitle = document.getElementById('calcPlanTitle');
const calcPlanSummary = document.getElementById('calcPlanSummary');
const sendCalcToWhatsApp = document.getElementById('sendCalcToWhatsApp');

function selectPropertyType(type) {
  clearWhatsAppFeedback('calc');
  selectedType = type;
  propertyTypeButtons.forEach(button => {
    const isSelected = button.getAttribute('data-type') === selectedType;
    button.setAttribute('aria-pressed', String(isSelected));
    ['border-brand-teal', 'bg-brand-teal/5', 'text-brand-tealDark'].forEach(className => button.classList.toggle(className, isSelected));
    ['border-slate-200', 'text-slate-600'].forEach(className => button.classList.toggle(className, !isSelected));
  });
  updateCalcPlan();
}

propertyTypeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    selectPropertyType(btn.getAttribute('data-type'));
  });
});

unitsInput.addEventListener('input', () => {
  clearWhatsAppFeedback('calc');
  updateCalcPlan({ recalibrateRange: true });
});
unitsRange.addEventListener('input', () => {
  clearWhatsAppFeedback('calc');
  unitsInput.value = unitsRange.value;
  updateCalcPlan();
});

document.querySelectorAll('.amenity-check').forEach(checkbox => {
  checkbox.addEventListener('change', () => clearWhatsAppFeedback('calc'));
});

// El campo numérico conserva la cantidad exacta; el rango es un control auxiliar.
function updateCalcPlan({ recalibrateRange = false } = {}) {
  const rawUnits = unitsInput.value.trim();
  const units = Number(rawUnits);
  const isValid = /^\d+$/.test(rawUnits) && Number.isSafeInteger(units) && units > 0;
  const errorMessage = isValid ? '' : 'Ingresa una cantidad entera válida, mayor que cero.';
  unitsInput.setAttribute('aria-invalid', String(!isValid));
  unitsInput.setCustomValidity(errorMessage);
  unitsError.textContent = errorMessage;
  unitsError.classList.toggle('hidden', isValid);
  sendCalcToWhatsApp.disabled = !isValid;

  if (!isValid) {
    unitsDisplay.textContent = 'Cantidad pendiente';
    calcPlanTitle.textContent = 'Completa la cantidad de unidades';
    calcPlanSummary.textContent = 'Ingresa el número de unidades para consultar el plan recomendado.';
    return null;
  }

  // Recalibrar al escribir; conservar la escala al mover el rango con las flechas.
  unitsRange.max = String(Math.max(300, units, recalibrateRange ? 300 : Number(unitsRange.max)));
  unitsRange.value = String(units);
  unitsMaxLabel.textContent = unitsRange.max;
  const quantityText = `${units} ${units === 1 ? 'unidad' : 'unidades'}`;
  unitsDisplay.textContent = quantityText;
  if (units < 40) {
    calcPlanTitle.textContent = `Plan CAMO Esencial (${selectedType})`;
    calcPlanSummary.textContent = `Ideal para comunidades boutique de hasta ${quantityText}. Administración contable precisa y atención directa.`;
  } else if (units < 120) {
    calcPlanTitle.textContent = `Plan CAMO Integral (${selectedType})`;
    calcPlanSummary.textContent = `Gestión completa de ${quantityText} con conciliaciones bancarias, supervisión de proveedores y cobranza activa.`;
  } else {
    calcPlanTitle.textContent = `Plan CAMO Corporativo (${selectedType})`;
    calcPlanSummary.textContent = `Para grandes desarrollos de ${quantityText} con alta rotación, supervisión continua de caseta y mantenimiento mayor.`;
  }
  return units;
}

selectPropertyType(selectedType);

// Enviar estimación a WhatsApp
sendCalcToWhatsApp.addEventListener('click', () => {
  const units = updateCalcPlan();
  if (units === null) {
    unitsInput.focus();
    return;
  }
  const selectedAmenities = Array.from(document.querySelectorAll('.amenity-check:checked')).map(c => c.value);
  const amenitiesText = selectedAmenities.length > 0 ? selectedAmenities.join(', ') : 'Servicios generales';

  const text = `Hola CAMO Administración Residencial! 🏢 Me gustaría una cotización formal:\n\n` +
               `• Inmueble: ${selectedType}\n` +
               `• Cantidad: ${units} ${units === 1 ? 'unidad/lote' : 'unidades/lotes'}\n` +
               `• Amenidades/Servicios: ${amenitiesText}\n\n` +
               `¿Cuándo podríamos platicar sobre una propuesta para nuestra comunidad?`;

  const encoded = encodeURIComponent(text);
  openWhatsApp(`https://wa.me/526142161556?text=${encoded}`, 'calc');
});

// Formulario de Contacto
const contactForm = document.getElementById('contactForm');
['input', 'change'].forEach(eventName => {
  contactForm.addEventListener(eventName, () => clearWhatsAppFeedback('contact'));
});
const contactFields = [
  { id: 'formName', message: 'Escribe tu nombre.', isValid: value => value.length > 0 },
  {
    id: 'formPhone',
    message: 'Escribe un teléfono de 10 a 15 dígitos; puedes usar +, espacios, paréntesis, puntos o guiones.',
    isValid: value => /^\+?[\d\s().-]+$/.test(value) && /^\d{10,15}$/.test(value.replace(/\D/g, ''))
  },
  { id: 'formProperty', message: 'Escribe el nombre del residencial o inmueble.', isValid: value => value.length > 0 }
].map(field => ({ ...field, element: document.getElementById(field.id), error: document.getElementById(`${field.id}Error`) }));

function validateContactField(field) {
  const isValid = field.isValid(field.element.value.trim());
  field.element.setAttribute('aria-invalid', String(!isValid));
  field.element.setCustomValidity(isValid ? '' : field.message);
  field.error.textContent = isValid ? '' : field.message;
  field.error.classList.toggle('hidden', isValid);
  return isValid;
}

contactFields.forEach(field => {
  field.element.addEventListener('blur', () => validateContactField(field));
  field.element.addEventListener('input', () => {
    if (field.element.getAttribute('aria-invalid') === 'true') validateContactField(field);
  });
});

contactForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const invalidFields = contactFields.filter(field => !validateContactField(field));
  if (invalidFields.length > 0) {
    invalidFields[0].element.focus();
    return;
  }

  const name = document.getElementById('formName').value.trim();
  const phone = document.getElementById('formPhone').value.trim();
  const property = document.getElementById('formProperty').value.trim();
  const type = document.getElementById('formPropType').value.trim();
  const message = document.getElementById('formMessage').value.trim();

  const text = `Hola CAMO! Mi nombre es ${name}.\n\n` +
               `• Celular: ${phone}\n` +
               `• Inmueble: ${property} (${type})\n` +
               `• Mensaje: ${message || 'Solicito información y propuesta de administración.'}`;

  const encoded = encodeURIComponent(text);
  openWhatsApp(`https://wa.me/526142161556?text=${encoded}`, 'contact');
});

// Los iconos son decorativos: su CDN no debe impedir las interacciones.
try {
  if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
  }
} catch {
  // Los controles y sus nombres accesibles ya están disponibles sin Lucide.
}
