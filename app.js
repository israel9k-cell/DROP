'use strict';

// ============ CONSTANTES ============
const STORAGE_KEYS = {
    CONFIG: 'sg_config_v1',
    HISTORIAL: 'sg_historial_v1',
};

const CONFIG_DEFAULT = {
    taxPct: 7,
    tasaDolar: 4200,
    categorias: [
        'Zapato Outlet',
        'Zapato Golden Goose',
        'Zapato Nike / Jordan',
        'Zapato Premium',
        'Bolso',
        'iPhone',
        'Otros',
    ],
    marcas: [
        'Dolce & Gabbana',
        'Stella McCartney',
        'Golden Goose',
        'Nike',
        'Jordan',
        'Apple',
        'Valentino',
        'Gucci',
        'Balenciaga',
    ],
};

// ============ ESTADO ============
const state = {
    tab: 'calc',
    config: { ...CONFIG_DEFAULT },
    historial: [],
    calc: {
        costoUsd: '',
        categoria: '',
        marca: '',
        descripcion: '',
        tipoMargen: 'fijo',
        valorMargen: '',
        taxLocal: '',
        tasaLocal: '',
    },
    cfg: { cfgTaxPct: '', cfgTasaDolar: '', nuevaCat: '', nuevaMarca: '' },
    hist: { filtro: 'todas', expandidos: new Set() },
};

let toastTimer = null;

// ============ UTILIDADES ============
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const fmtCOP = (v) => {
    if (v === null || v === undefined || isNaN(v)) return '$0';
    return '$' + Math.round(v).toLocaleString('es-CO');
};
const fmtUSD = (v) => {
    if (v === null || v === undefined || isNaN(v)) return '$0.00';
    return '$' + Number(v).toFixed(2);
};
const redondear1000 = (v) => Math.ceil(v / 1000) * 1000;

const escapeHtml = (s) => String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// ============ PERSISTENCIA ============
function cargar() {
    try {
        const c = localStorage.getItem(STORAGE_KEYS.CONFIG);
        if (c) state.config = { ...CONFIG_DEFAULT, ...JSON.parse(c) };
    } catch (e) { /* primera vez */ }
    try {
        const h = localStorage.getItem(STORAGE_KEYS.HISTORIAL);
        if (h) state.historial = JSON.parse(h);
    } catch (e) { /* primera vez */ }
}

function guardarConfig(nuevo) {
    state.config = nuevo;
    try {
        localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(nuevo));
    } catch (e) {
        toast('Error guardando configuración', 'error');
    }
}

function guardarHistorial(nuevo) {
    state.historial = nuevo;
    try {
        localStorage.setItem(STORAGE_KEYS.HISTORIAL, JSON.stringify(nuevo));
    } catch (e) {
        toast('Error guardando historial', 'error');
    }
}

// ============ TOAST ============
function toast(msg, tipo) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (tipo === 'error' ? ' error' : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

// ============ CÁLCULO ============
function calcular() {
    const c = state.calc;
    const costo = parseFloat(c.costoUsd) || 0;
    const tax = parseFloat(c.taxLocal) || 0;
    const tasa = parseFloat(c.tasaLocal) || 0;
    const margen = parseFloat(c.valorMargen) || 0;

    const costoConTax = costo * (1 + tax / 100);
    const costoCop = costoConTax * tasa;
    let montoMargen = 0;
    let pctEfectivo = 0;

    if (c.tipoMargen === 'fijo') {
        montoMargen = margen;
        pctEfectivo = costoCop > 0 ? (montoMargen / costoCop) * 100 : 0;
    } else {
        montoMargen = costoCop * (margen / 100);
        pctEfectivo = margen;
    }

    const subtotal = costoCop + montoMargen;
    const precioFinal = redondear1000(subtotal);
    const ganancia = precioFinal - costoCop;

    return {
        costo, costoConTax, costoCop, montoMargen, subtotal,
        precioFinal, ganancia, pctEfectivo, tax, tasa,
    };
}

// ============ TABS ============
function setTab(t) {
    state.tab = t;
    $$('.tab-content').forEach((el) => {
        el.classList.toggle('hidden', el.dataset.tab !== t);
    });
    $$('.nav-btn').forEach((el) => {
        el.classList.toggle('active', el.dataset.val === t);
    });
    if (t === 'hist') renderHistorial();
    if (t === 'ana') renderAnalisis();
    if (t === 'cfg') renderConfig();
}

// ============ RENDER: HEADER + NAV ============
function renderHeader() {
    $('#tasa-header').textContent = '$' + Number(state.config.tasaDolar).toLocaleString('es-CO');
    const badge = $('#nav-badge');
    if (state.historial.length > 0) {
        badge.textContent = state.historial.length;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

// ============ RENDER: CALC ============
function renderCalcSelects() {
    const sel = $('#sel-categoria');
    sel.innerHTML = state.config.categorias
        .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
        .join('');
    if (!state.calc.categoria || !state.config.categorias.includes(state.calc.categoria)) {
        state.calc.categoria = state.config.categorias[0] || '';
    }
    sel.value = state.calc.categoria;

    const dl = $('#marcas-list');
    dl.innerHTML = state.config.marcas
        .map((m) => `<option value="${escapeHtml(m)}">`)
        .join('');
}

function renderCalcInputs() {
    document.querySelectorAll('[data-tab="calc"] [data-bind]').forEach((el) => {
        const k = el.dataset.bind;
        const v = state.calc[k];
        if (v !== undefined && el.value !== String(v)) {
            el.value = v;
        }
    });
}

function renderTipoMargen() {
    $$('[data-action="set-tipo-margen"]').forEach((el) => {
        el.classList.toggle('active', el.dataset.val === state.calc.tipoMargen);
    });
    $('#lbl-margen').textContent = state.calc.tipoMargen === 'fijo'
        ? 'Cuánto agregas en COP'
        : 'Porcentaje a agregar';
    $('#inp-margen').placeholder = state.calc.tipoMargen === 'fijo' ? '200000' : '22';
}

function lineaHTML({ label, valor, sub, bold, positivo }) {
    const lblCls = sub ? 'lbl sub' : 'lbl';
    let valCls = 'val';
    if (bold) valCls += ' bold';
    if (positivo) valCls += ' positivo';
    return `<div class="linea"><span class="${lblCls}">${escapeHtml(label)}</span><span class="${valCls}">${escapeHtml(valor)}</span></div>`;
}

function renderDesglose() {
    const r = calcular();
    const partes = [];
    partes.push(lineaHTML({ label: 'Costo USA', valor: fmtUSD(r.costo) }));
    partes.push(lineaHTML({ label: '+ Tax (' + r.tax + '%)', valor: fmtUSD(r.costoConTax - r.costo), sub: true }));
    partes.push(lineaHTML({ label: 'Costo con tax', valor: fmtUSD(r.costoConTax), sub: true, bold: true }));
    partes.push('<div class="sep"></div>');
    partes.push(lineaHTML({ label: 'Tasa dólar', valor: '$' + Number(r.tasa).toLocaleString('es-CO') }));
    partes.push(lineaHTML({ label: 'Costo en COP', valor: fmtCOP(r.costoCop), bold: true }));
    partes.push('<div class="sep"></div>');
    partes.push(lineaHTML({ label: '+ Margen (' + r.pctEfectivo.toFixed(1) + '%)', valor: fmtCOP(r.montoMargen), positivo: true }));
    partes.push(lineaHTML({ label: 'Subtotal', valor: fmtCOP(r.subtotal), sub: true }));
    partes.push(lineaHTML({ label: 'Redondeo a $1.000', valor: fmtCOP(r.precioFinal), sub: true }));
    $('#desglose').innerHTML = partes.join('');

    $('#precio-final').textContent = fmtCOP(r.precioFinal);
    $('#ganancia').textContent = fmtCOP(r.ganancia);

    const hint = $('#hint-margen');
    if (state.calc.tipoMargen === 'fijo' && r.costoCop > 0 && state.calc.valorMargen) {
        hint.innerHTML = 'Equivale a <span class="accent">' + r.pctEfectivo.toFixed(1) + '%</span> del costo';
    } else if (state.calc.tipoMargen === 'pct' && r.montoMargen > 0) {
        hint.innerHTML = 'Equivale a <span class="accent">' + escapeHtml(fmtCOP(r.montoMargen)) + '</span> en pesos';
    } else {
        hint.innerHTML = '';
    }

    const puede = r.costo > 0 && state.calc.marca.trim() && state.calc.categoria && r.precioFinal > 0;
    $('#btn-guardar').disabled = !puede;
}

// ============ RENDER: HISTORIAL ============
function lineaSmall(label, valor, positivo) {
    const cls = positivo ? 'val positivo' : 'val';
    return '<div class="linea small"><span class="lbl">' + escapeHtml(label) + '</span><span class="' + cls + '">' + escapeHtml(valor) + '</span></div>';
}

function renderHistorial() {
    const cats = ['todas', ...Array.from(new Set(state.historial.map((r) => r.categoria)))];
    const chipsEl = $('#hist-chips');
    if (state.historial.length === 0) {
        chipsEl.innerHTML = '';
    } else {
        chipsEl.innerHTML = cats.map((c) => {
            const activo = state.hist.filtro === c ? ' active' : '';
            const lbl = c === 'todas' ? 'Todas (' + state.historial.length + ')' : c;
            return '<button class="chip' + activo + '" data-action="filtro-cat" data-val="' + escapeHtml(c) + '">' + escapeHtml(lbl) + '</button>';
        }).join('');
    }

    const filtrados = state.hist.filtro === 'todas'
        ? state.historial
        : state.historial.filter((r) => r.categoria === state.hist.filtro);

    const listaEl = $('#hist-lista');
    if (filtrados.length === 0) {
        listaEl.innerHTML = '<div class="empty">' +
            '<svg viewBox="0 0 24 24" class="ico" style="width:48px;height:48px;"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><polyline points="12 7 12 12 15 15"/></svg>' +
            '<p>Todavía no has guardado cálculos</p>' +
            '</div>';
        return;
    }

    listaEl.innerHTML = filtrados.map((r) => {
        const fecha = new Date(r.fecha);
        const fechaStr = fecha.toLocaleDateString('es-CO', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        });
        const expandido = state.hist.expandidos.has(r.id);
        const desc = r.descripcion ? '<div class="desc">' + escapeHtml(r.descripcion) + '</div>' : '';

        let body = '';
        if (expandido) {
            const margenLbl = r.tipoMargen === 'fijo'
                ? 'Fijo ' + fmtCOP(r.valorMargen)
                : r.valorMargen + '%';
            body = '<div class="h-body">' +
                lineaSmall('Costo USD', fmtUSD(r.costoUsd)) +
                lineaSmall('Tax aplicado', r.taxPct + '%') +
                lineaSmall('Tasa usada', '$' + Number(r.tasaDolar).toLocaleString('es-CO')) +
                lineaSmall('Costo en COP', fmtCOP(r.costoCop)) +
                lineaSmall('Tipo margen', margenLbl) +
                lineaSmall('% efectivo', r.pctEfectivo.toFixed(1) + '%') +
                lineaSmall('Ganancia', fmtCOP(r.ganancia), true) +
                '<button class="del-btn" data-action="eliminar-registro" data-val="' + escapeHtml(r.id) + '">' +
                '<svg class="ico-sm" viewBox="0 0 24 24" style="width:12px;height:12px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
                'Eliminar este registro' +
                '</button>' +
                '</div>';
        }

        return '<div class="h-item">' +
            '<button class="h-head" data-action="toggle-item" data-val="' + escapeHtml(r.id) + '">' +
                '<div class="info">' +
                    '<div class="meta">' +
                        '<span class="marca">' + escapeHtml(r.marca) + '</span>' +
                        '<span class="dot">•</span>' +
                        '<span class="cat">' + escapeHtml(r.categoria) + '</span>' +
                    '</div>' +
                    desc +
                    '<div class="fecha">' + escapeHtml(fechaStr) + '</div>' +
                '</div>' +
                '<div class="precio">' +
                    '<div class="usd">' + fmtUSD(r.costoUsd) + '</div>' +
                    '<div class="cop">' + fmtCOP(r.precioFinal) + '</div>' +
                    '<div class="gan">+' + fmtCOP(r.ganancia) + '</div>' +
                '</div>' +
            '</button>' +
            body +
        '</div>';
    }).join('');
}

// ============ RENDER: ANÁLISIS ============
function renderAnalisis() {
    const cont = $('#ana-contenido');
    if (state.historial.length === 0) {
        cont.innerHTML = '<div class="empty">' +
            '<svg viewBox="0 0 24 24" class="ico" style="width:48px;height:48px;"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>' +
            '<p>Guarda cálculos en el historial para ver análisis aquí</p>' +
            '<p class="small">Mínimo recomendado: 1 semana de datos</p>' +
            '</div>';
        return;
    }

    const totalGanancia = state.historial.reduce((s, r) => s + r.ganancia, 0);
    const totalVentas = state.historial.reduce((s, r) => s + r.precioFinal, 0);
    const margenProm = state.historial.reduce((s, r) => s + r.pctEfectivo, 0) / state.historial.length;

    const porCat = {};
    state.historial.forEach((r) => {
        if (!porCat[r.categoria]) {
            porCat[r.categoria] = {
                count: 0, gananciaTotal: 0, ventasTotal: 0,
                costoMin: Infinity, costoMax: 0, pctTotal: 0, margenesFijos: [],
            };
        }
        const c = porCat[r.categoria];
        c.count++;
        c.gananciaTotal += r.ganancia;
        c.ventasTotal += r.precioFinal;
        c.costoMin = Math.min(c.costoMin, r.costoUsd);
        c.costoMax = Math.max(c.costoMax, r.costoUsd);
        c.pctTotal += r.pctEfectivo;
        if (r.tipoMargen === 'fijo') c.margenesFijos.push(r.valorMargen);
    });

    const rangos = [
        { min: 0, max: 30, label: '$0 – $30' },
        { min: 30, max: 50, label: '$30 – $50' },
        { min: 50, max: 100, label: '$50 – $100' },
        { min: 100, max: 200, label: '$100 – $200' },
        { min: 200, max: 300, label: '$200 – $300' },
        { min: 300, max: 400, label: '$300 – $400' },
        { min: 400, max: 600, label: '$400 – $600' },
        { min: 600, max: 1000, label: '$600 – $1000' },
        { min: 1000, max: Infinity, label: '> $1000' },
    ];
    const porRango = rangos.map((r) => {
        const items = state.historial.filter((h) => h.costoUsd >= r.min && h.costoUsd < r.max);
        const fijos = items.filter((i) => i.tipoMargen === 'fijo');
        return {
            label: r.label,
            count: items.length,
            pctProm: items.length ? items.reduce((s, i) => s + i.pctEfectivo, 0) / items.length : 0,
            montoPromFijo: fijos.length ? fijos.reduce((s, i) => s + i.valorMargen, 0) / fijos.length : 0,
        };
    }).filter((r) => r.count > 0);

    let html = '';

    html += '<div class="kpis">' +
        '<div class="kpi"><div class="kpi-label">Productos</div><div class="kpi-val">' + state.historial.length + '</div></div>' +
        '<div class="kpi"><div class="kpi-label">Ventas</div><div class="kpi-val">' + escapeHtml(fmtCOP(totalVentas)) + '</div></div>' +
        '<div class="kpi"><div class="kpi-label">Ganancia</div><div class="kpi-val green">' + escapeHtml(fmtCOP(totalGanancia)) + '</div></div>' +
        '</div>';

    html += '<div class="card">' +
        '<h2 class="card-title">Margen promedio general</h2>' +
        '<div class="big-pct">' + margenProm.toFixed(1) + '%</div>' +
        '<p class="hint">Promedio de todos los productos registrados</p>' +
        '</div>';

    const cats = Object.entries(porCat).sort((a, b) => b[1].count - a[1].count);
    html += '<div class="card"><h2 class="card-title">Por categoría</h2>';
    cats.forEach(([cat, d]) => {
        const promFijo = d.margenesFijos.length
            ? d.margenesFijos.reduce((s, v) => s + v, 0) / d.margenesFijos.length
            : 0;
        const fijoRow = promFijo > 0
            ? '<div><span class="k">Margen fijo típico</span><span class="v">' + escapeHtml(fmtCOP(promFijo)) + '</span></div>'
            : '';
        html += '<div class="ana-cat">' +
            '<div class="ana-cat-head">' +
                '<div class="ana-cat-name">' + escapeHtml(cat) + '</div>' +
                '<div class="ana-cat-count">' + d.count + ' productos</div>' +
            '</div>' +
            '<div class="ana-cat-grid">' +
                '<div><span class="k">Rango costo</span><span class="v">' + escapeHtml(fmtUSD(d.costoMin)) + ' – ' + escapeHtml(fmtUSD(d.costoMax)) + '</span></div>' +
                '<div><span class="k">Margen promedio</span><span class="v amber">' + (d.pctTotal / d.count).toFixed(1) + '%</span></div>' +
                '<div><span class="k">Ganancia total</span><span class="v green">' + escapeHtml(fmtCOP(d.gananciaTotal)) + '</span></div>' +
                fijoRow +
            '</div>' +
            '</div>';
    });
    html += '</div>';

    html += '<div class="card"><h2 class="card-title">Por rango de costo USD</h2>';
    porRango.forEach((r) => {
        const prom = r.montoPromFijo > 0
            ? '<div class="prom">' + escapeHtml(fmtCOP(r.montoPromFijo)) + ' prom.</div>'
            : '';
        html += '<div class="ana-rango">' +
            '<div class="lbl">' +
                '<div class="name">' + escapeHtml(r.label) + '</div>' +
                '<div class="count">(' + r.count + ')</div>' +
            '</div>' +
            '<div class="right">' +
                '<div class="pct">' + r.pctProm.toFixed(1) + '%</div>' +
                prom +
            '</div>' +
            '</div>';
    });
    html += '</div>';

    html += '<div class="card card-hi">' +
        '<h2 class="card-title">Sugerencia</h2>' +
        '<p class="hint">Cuando tengas al menos 30-50 registros, exporta el CSV y pásaselo a Claude. Con esa data real se pueden definir las reglas automáticas de pricing por categoría y rango, y cargarlas en el sistema grande.</p>' +
        '</div>';

    cont.innerHTML = html;
}

// ============ RENDER: CONFIG ============
function renderConfig() {
    state.cfg.cfgTaxPct = state.config.taxPct;
    state.cfg.cfgTasaDolar = state.config.tasaDolar;

    document.querySelectorAll('[data-tab="cfg"] [data-bind]').forEach((el) => {
        const k = el.dataset.bind;
        const v = state.cfg[k];
        if (v !== undefined && el.value !== String(v)) el.value = v;
    });

    $('#cfg-cat-titulo').textContent = 'Categorías (' + state.config.categorias.length + ')';
    $('#cfg-marcas-titulo').textContent = 'Marcas (' + state.config.marcas.length + ')';

    $('#cfg-categorias').innerHTML = state.config.categorias.map((c) =>
        '<div class="lista-item">' +
            '<span>' + escapeHtml(c) + '</span>' +
            '<button class="x-btn" data-action="eliminar-categoria" data-val="' + escapeHtml(c) + '">' +
                '<svg class="ico-sm" viewBox="0 0 24 24" style="width:16px;height:16px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '</button>' +
        '</div>'
    ).join('');

    $('#cfg-marcas').innerHTML = state.config.marcas.map((m) =>
        '<div class="lista-item">' +
            '<span>' + escapeHtml(m) + '</span>' +
            '<button class="x-btn" data-action="eliminar-marca" data-val="' + escapeHtml(m) + '">' +
                '<svg class="ico-sm" viewBox="0 0 24 24" style="width:16px;height:16px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '</button>' +
        '</div>'
    ).join('');
}

// ============ ACCIONES ============
function guardarCalc() {
    const r = calcular();
    if (!(r.costo > 0 && state.calc.marca.trim() && state.calc.categoria && r.precioFinal > 0)) return;

    const registro = {
        id: Date.now().toString(),
        fecha: new Date().toISOString(),
        costoUsd: r.costo,
        categoria: state.calc.categoria,
        marca: state.calc.marca.trim(),
        descripcion: state.calc.descripcion.trim(),
        taxPct: r.tax,
        tasaDolar: r.tasa,
        costoConTax: r.costoConTax,
        costoCop: r.costoCop,
        tipoMargen: state.calc.tipoMargen,
        valorMargen: parseFloat(state.calc.valorMargen) || 0,
        montoMargen: r.montoMargen,
        pctEfectivo: r.pctEfectivo,
        precioFinal: r.precioFinal,
        ganancia: r.ganancia,
    };
    guardarHistorial([registro, ...state.historial]);
    toast('Guardado ✓');

    state.calc.costoUsd = '';
    state.calc.valorMargen = '';
    state.calc.descripcion = '';
    renderCalcInputs();
    renderDesglose();
    renderHeader();
}

function exportarCsv() {
    if (state.historial.length === 0) {
        toast('No hay datos para exportar', 'error');
        return;
    }
    const headers = [
        'Fecha', 'Categoria', 'Marca', 'Descripcion', 'Costo USD', 'Tax %',
        'Tasa', 'Costo COP', 'Tipo Margen', 'Valor Margen', 'Monto Margen COP',
        '% Efectivo', 'Precio Final', 'Ganancia',
    ];
    const rows = state.historial.map((r) => [
        new Date(r.fecha).toLocaleString('es-CO'),
        r.categoria,
        r.marca,
        r.descripcion || '',
        r.costoUsd,
        r.taxPct,
        r.tasaDolar,
        Math.round(r.costoCop),
        r.tipoMargen,
        r.valorMargen,
        Math.round(r.montoMargen),
        r.pctEfectivo.toFixed(2),
        r.precioFinal,
        Math.round(r.ganancia),
    ]);
    const csv = [headers, ...rows]
        .map((row) => row.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(','))
        .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sweet-glam-precios-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV descargado ✓');
}

function limpiarHistorial() {
    if (!confirm('¿Borrar TODO el historial? Esta acción no se puede deshacer.')) return;
    guardarHistorial([]);
    state.hist.expandidos.clear();
    state.hist.filtro = 'todas';
    renderHistorial();
    renderHeader();
    toast('Historial borrado');
}

function guardarGenerales() {
    const nuevo = {
        ...state.config,
        taxPct: parseFloat(state.cfg.cfgTaxPct) || 0,
        tasaDolar: parseFloat(state.cfg.cfgTasaDolar) || 0,
    };
    guardarConfig(nuevo);
    state.calc.taxLocal = nuevo.taxPct;
    state.calc.tasaLocal = nuevo.tasaDolar;
    renderHeader();
    renderCalcInputs();
    renderDesglose();
    toast('Guardado ✓');
}

function agregarCategoria() {
    const v = state.cfg.nuevaCat.trim();
    if (!v) return;
    if (state.config.categorias.includes(v)) {
        toast('Ya existe', 'error');
        return;
    }
    guardarConfig({ ...state.config, categorias: [...state.config.categorias, v] });
    state.cfg.nuevaCat = '';
    renderConfig();
    renderCalcSelects();
}

function eliminarCategoria(c) {
    guardarConfig({ ...state.config, categorias: state.config.categorias.filter((x) => x !== c) });
    renderConfig();
    renderCalcSelects();
}

function agregarMarca() {
    const v = state.cfg.nuevaMarca.trim();
    if (!v) return;
    if (state.config.marcas.includes(v)) {
        toast('Ya existe', 'error');
        return;
    }
    guardarConfig({ ...state.config, marcas: [...state.config.marcas, v] });
    state.cfg.nuevaMarca = '';
    renderConfig();
    renderCalcSelects();
}

function eliminarMarca(m) {
    guardarConfig({ ...state.config, marcas: state.config.marcas.filter((x) => x !== m) });
    renderConfig();
    renderCalcSelects();
}

// ============ EVENTOS ============
function bindEvents() {
    document.addEventListener('input', (e) => {
        const el = e.target;
        if (!el.dataset || !el.dataset.bind) return;
        const k = el.dataset.bind;
        if (k in state.calc) {
            state.calc[k] = el.value;
            if (k === 'costoUsd' || k === 'valorMargen' || k === 'taxLocal' || k === 'tasaLocal' || k === 'marca') {
                renderDesglose();
            }
        } else if (k in state.cfg) {
            state.cfg[k] = el.value;
        }
    });

    document.addEventListener('change', (e) => {
        const el = e.target;
        if (el.dataset && el.dataset.bind === 'categoria') {
            state.calc.categoria = el.value;
            renderDesglose();
        }
    });

    $('#inp-nueva-cat').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') agregarCategoria();
    });
    $('#inp-nueva-marca').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') agregarMarca();
    });

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const val = btn.dataset.val;

        switch (action) {
            case 'set-tab': setTab(val); break;
            case 'set-tipo-margen':
                state.calc.tipoMargen = val;
                renderTipoMargen();
                renderDesglose();
                break;
            case 'guardar': guardarCalc(); break;
            case 'exportar-csv': exportarCsv(); break;
            case 'limpiar-historial': limpiarHistorial(); break;
            case 'filtro-cat':
                state.hist.filtro = val;
                renderHistorial();
                break;
            case 'toggle-item':
                if (state.hist.expandidos.has(val)) state.hist.expandidos.delete(val);
                else state.hist.expandidos.add(val);
                renderHistorial();
                break;
            case 'eliminar-registro':
                e.stopPropagation();
                guardarHistorial(state.historial.filter((r) => r.id !== val));
                state.hist.expandidos.delete(val);
                renderHistorial();
                renderHeader();
                toast('Eliminado');
                break;
            case 'guardar-generales': guardarGenerales(); break;
            case 'agregar-categoria': agregarCategoria(); break;
            case 'eliminar-categoria': eliminarCategoria(val); break;
            case 'agregar-marca': agregarMarca(); break;
            case 'eliminar-marca': eliminarMarca(val); break;
        }
    });
}

// ============ INIT ============
function init() {
    cargar();
    state.calc.taxLocal = state.config.taxPct;
    state.calc.tasaLocal = state.config.tasaDolar;
    state.calc.categoria = state.config.categorias[0] || '';

    renderHeader();
    renderCalcSelects();
    renderCalcInputs();
    renderTipoMargen();
    renderDesglose();
    bindEvents();
}

document.addEventListener('DOMContentLoaded', init);
