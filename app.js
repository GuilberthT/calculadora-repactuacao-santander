"use strict";

/* ===== TRAVAMENTO DE ARMAZENAMENTO ===== */
(function lockStorage() {
  const noop = {
    getItem()  { return null; },
    setItem()  {},
    removeItem(){},
    clear()    {},
    key()      { return null; },
    get length(){ return 0; }
  };
  try {
    Object.defineProperty(window, 'localStorage',  { value: noop, configurable: false, writable: false });
    Object.defineProperty(window, 'sessionStorage', { value: noop, configurable: false, writable: false });
  } catch(e) {}
  try {
    Object.defineProperty(document, 'cookie', {
      get() { return ''; },
      set() { return true; },
      configurable: false
    });
  } catch(e) {}
})();

/* ===== LIMPEZA AO SAIR ===== */
function wipe() {
  FIELD_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}
window.addEventListener('beforeunload', wipe);
window.addEventListener('pagehide', wipe);

/* ===== WORKER PDF.JS ===== */
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/* ===== CONSTANTES ===== */
const FIELD_IDS = ['financiado', 'pagoTotal', 'seguro', 'meses', 'parcela'];
const F = id => document.getElementById(id);

/* ===== HELPERS ===== */
function parseNum(s) {
  if (!s) return 0;
  s = String(s).replace(/[^\d.,]/g, '').trim();
  if (s.indexOf(',') > -1) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function brl(n) {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function setStatus(t) { F('status').textContent = t; }

function setBar(p) {
  const b = F('bar');
  b.classList.add('on');
  F('barfill').style.width = Math.round(p * 100) + '%';
}

function hideBar() {
  F('bar').classList.remove('on');
  F('barfill').style.width = '0';
}

/* ===== CALCULO ===== */
function calc() {
  const fin   = parseNum(F('financiado').value);
  const pago  = parseNum(F('pagoTotal').value);
  const seg   = parseNum(F('seguro').value);
  const meses = parseNum(F('meses').value);
  const parc  = parseNum(F('parcela').value);

  const anyFilled = FIELD_IDS.some(id => F(id).value.trim() !== '');
  if (anyFilled) {
    [['financiado', fin], ['pagoTotal', pago], ['seguro', seg], ['meses', meses], ['parcela', parc]]
      .forEach(([id, v]) => {
        const el = F(id);
        if (el.value.trim() !== '' && v === 0) el.classList.add('invalid');
        else el.classList.remove('invalid');
      });
  }

  const sp = fin   > 0 ? (seg * pago) / fin : 0;
  const sm = meses > 0 ? sp / meses         : 0;
  const np = parc - sm;

  F('rSeguroProp').textContent = 'R$ ' + brl(sp);
  F('rSeguroMes').textContent  = 'R$ ' + brl(sm);
  F('rParcela').textContent    = 'R$ ' + brl(np);
  F('rDelta').textContent      = sm > 0 ? ('↓ R$ ' + brl(sm) + ' de reducao mensal') : '';
}

/* ===== EVENTOS DE INPUT ===== */
FIELD_IDS.forEach(id => {
  F(id).addEventListener('input', () => {
    F(id).classList.remove('filled', 'invalid');
    calc();
  });
});

F('reset').addEventListener('click', () => {
  FIELD_IDS.forEach(id => {
    F(id).value = '';
    F(id).classList.remove('filled', 'invalid');
    F('t-' + id).classList.remove('show');
  });
  F('filename').textContent = '';
  setStatus('');
  calc();
});

F('print').addEventListener('click', () => window.print());

/* ===== DRAG & DROP / FILE INPUT ===== */
const drop      = F('drop');
const fileInput = F('file');

drop.addEventListener('click', () => fileInput.click());

['dragover', 'dragenter'].forEach(e =>
  drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('over'); })
);
['dragleave', 'drop'].forEach(e =>
  drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove('over'); })
);

drop.addEventListener('drop',         ev => { if (ev.dataTransfer.files[0]) handleFile(ev.dataTransfer.files[0]); });
fileInput.addEventListener('change',  ev => { if (ev.target.files[0])       handleFile(ev.target.files[0]); });

/* ===== LEITURA DO PDF ===== */
async function handleFile(file) {
  F('filename').textContent = file.name;
  if (file.type !== 'application/pdf') { setStatus('⚠️ Envie um arquivo PDF.'); return; }

  let buf = null;
  try {
    setStatus('Lendo o PDF...'); setBar(0.05);
    buf = await file.arrayBuffer();

    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let text = '';
    const n = pdf.numPages;

    for (let i = 1; i <= n; i++) {
      const page = await pdf.getPage(i);
      const tc   = await page.getTextContent();
      text += ' ' + tc.items.map(x => x.str).join(' ');
      setBar(0.05 + 0.45 * (i / n));
    }

    if (text.replace(/\s/g, '').length < 40) {
      setStatus('PDF escaneado detectado. Aplicando OCR (pode levar ~30s)...');
      text = await ocrPdf(pdf);
    }

    setStatus('Procurando os valores no contrato...'); setBar(0.95);
    const found = extract(text);
    applyFound(found);
    hideBar();

    const c = Object.values(found).filter(Boolean).length;
    setStatus(c
      ? ('✅ ' + c + ' valor(es) preenchido(s). Confira antes de calcular.')
      : '⚠️ Nenhum valor reconhecido. Preencha manualmente.'
    );
    text = null;
  } catch(err) {
    hideBar();
    setStatus('⚠️ Erro ao ler o PDF: ' + (err && err.message ? err.message : String(err)));
    console.error(err);
  } finally {
    buf = null;
  }
}

/* ===== OCR (PDFs ESCANEADOS) ===== */
async function ocrPdf(pdf) {
  const worker = await Tesseract.createWorker('por');
  let out = '';
  const n = Math.min(pdf.numPages, 6);

  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i);
    const vp   = page.getViewport({ scale: 2 });
    const cv   = document.createElement('canvas');
    cv.width   = vp.width;
    cv.height  = vp.height;
    await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    const { data } = await worker.recognize(cv);
    out += ' ' + data.text;
    cv.width = 0; cv.height = 0;
    setBar(0.5 + 0.4 * (i / n));
    setStatus('OCR pagina ' + i + ' de ' + n + '...');
  }

  await worker.terminate();
  return out;
}

/* ===== EXTRAÇÃO DE VALORES ===== */
const MONEY = '([\\d][\\d.\\s]*,\\d{2})';
const INT   = '(\\d{1,3})';

function rx(labels, val) {
  return new RegExp('(?:' + labels.join('|') + ')[^\\d]{0,40}' + val, 'i');
}

const PATTERNS = {
  financiado: rx(['valor\\s+total\\s+financiado','valor\\s+financiado','valor\\s+do\\s+cr[ée]dito','valor\\s+l[ií]quido\\s+liberado'], MONEY),
  pagoTotal:  rx(['valor\\s+total\\s+(?:a\\s+pagar|devido)','total\\s+a\\s+pagar','montante\\s+total','valor\\s+total\\s+do\\s+financiamento'], MONEY),
  seguro:     rx(['seguro\\s+prestamista','seguro\\s+prote[çc][ãa]o','pr[êe]mio.{0,10}seguro','valor\\s+do\\s+seguro','tarifa.{0,6}seguro'], MONEY),
  meses:      rx(['prazo\\s*(?:total)?\\s*\\(?(?:em\\s*)?meses\\)?','quantidade\\s+de\\s+parcelas','n[º°o]?\\s*de\\s+parcelas','prazo\\s+de\\s+pagamento'], INT),
  parcela:    rx(['valor\\s+da\\s+(?:primeira\\s+)?parcela','valor\\s+da\\s+presta[çc][ãa]o','parcela\\s+mensal','valor\\s+parcela'], MONEY)
};

function extract(t) {
  t = t.replace(/\s+/g, ' ');
  console.log('TEXTO EXTRAÍDO DO PDF:', t);
  const r = {};
  for (const k in PATTERNS) {
    const m = t.match(PATTERNS[k]);
    r[k] = m ? m[1].replace(/\s/g, '') : null;
    console.log(`CAMPO [${k}]:`, r[k] || 'NÃO ENCONTRADO');
  }
  return r;
}

function applyFound(f) {
  for (const k in f) {
    if (f[k]) {
      F(k).value = f[k];
      F(k).classList.add('filled');
      F('t-' + k).classList.add('show');
    }
  }
  calc();
}

/* ===== INIT ===== */
calc();
