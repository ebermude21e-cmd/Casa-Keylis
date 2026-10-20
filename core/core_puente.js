/* ==========================================================================
   SICOM · CORE · EL PUENTE
   Casa Keylis Boutique Femine, C.A.

   Traduce en los dos sentidos entre las 35 tablas del servidor y el objeto
   de estado que usa toda la pantalla de SICOM.

   Por qué existe: la interfaz de SICOM son once mil líneas que leen `DB`.
   Reescribirlas para que lean tablas sería rehacer el sistema entero. En vez
   de eso, `DB` se sigue armando en memoria —igual que hoy— pero ya no sale
   de un documento guardado en el navegador: sale de las tablas. Y cuando
   algo cambia, se escribe de vuelta a las tablas, no al documento.

   Las funciones de aquí son PURAS: reciben datos y devuelven datos. No
   tocan la red ni el navegador. Por eso se pueden probar solas.
   ========================================================================== */
(function(raiz){
'use strict';

/* ---------- utilidades ---------- */
/* Math.round(v*100)/100 redondea hacia ABAJO cuando el flotante cae justo por
   debajo del medio centavo: n2(1.005) daba 1,00 y el IGTF del 3 % sobre 41,50
   daba 1,24 en vez de 1,25. Un centavo de menos, de vez en cuando, en lo que
   hay que enterarle al SENIAT. El épsilon lo corrige sin afectar nada más. */
function n2(x){ const v = +x; if(isNaN(v)) return 0;
  return Math.round((v + (v >= 0 ? 1e-9 : -1e-9)) * 100) / 100; }
function n4(x){ const v = +x; if(isNaN(v)) return 0;
  return Math.round((v + (v >= 0 ? 1e-11 : -1e-11)) * 10000) / 10000; }
function num(x, d){ const v = +x; return isNaN(v) ? (d === undefined ? 0 : d) : v; }
function txt(x){ return x === null || x === undefined ? '' : String(x); }
function nulo(x){ const s = txt(x); return s === '' ? null : s; }
function bo(x, d){ return x === undefined || x === null ? (d === true) : x === true; }
function orden(a, b){ return a < b ? -1 : a > b ? 1 : 0; }

/* Los códigos contables no son datos: se derivan del método de pago y del
   origen del movimiento. Guardarlos sería guardar dos veces lo mismo, y que
   una de las dos copias pueda mentir. */
function opCobro(met){ return 'cob_' + txt(met); }
/* En el mapa de cuentas la operación del vuelto es una sola: `vue`. Devolver
   'vue_efec_usd' dejaba la línea del asiento sin cuenta, porque esa clave no
   existe en el mapa. */
function opVuelto(met){ return 'vue'; }
function opPend(tipo, nota){
  if(tipo === 'vuelto') return 'vue_pend';
  return txt(nota).indexOf('anulada') >= 0 ? 'anul_pag' : 'dev_pag';
}
function opAcc(tipo){
  return tipo === 'cobro'     ? 'acc_cob'
       : tipo === 'vuelto'    ? 'acc_vue'
       : tipo === 'reintegro' ? 'acc_rei'
       : 'anul';
}

/* ==========================================================================
   DE LAS TABLAS AL ESTADO
   ========================================================================== */
function aEstado(T){
  T = T || {};
  const L = function(k){ return Array.isArray(T[k]) ? T[k] : []; };
  const aj = {};
  L('ajustes').forEach(function(a){ aj[a.clave] = a.valor; });

  const emp = T.empresa || {};
  const fis = L('parametros_fiscales').slice()
                .sort(function(a,b){ return orden(a.desde, b.desde); }).pop() || {};
  const corr = {};
  L('correlativos').forEach(function(c){ corr[c.tipo] = num(c.valor); });

  /* ---- el inventario ---- */
  const varPorProd = {};
  L('producto_variantes').forEach(function(v){
    (varPorProd[v.producto_id] = varPorProd[v.producto_id] || [])
      .push({ t: txt(v.talla), c: txt(v.color), e: num(v.existencia) });
  });

  /* ---- las ventas ---- */
  const porVenta = function(filas, campo){
    const m = {};
    filas.forEach(function(f){ (m[f[campo]] = m[f[campo]] || []).push(f); });
    for(const k in m) m[k].sort(function(a,b){ return num(a.pos) - num(b.pos); });
    return m;
  };
  const lin = porVenta(L('venta_lineas'), 'venta_num');
  const cob = porVenta(L('venta_cobros'), 'venta_num');
  const vue = porVenta(L('venta_vueltos'), 'venta_num');

  const anu = {};
  L('venta_anulacion').forEach(function(a){ anu[a.venta_num] = a; });

  /* Quien anuló se guarda por identificador, pero la pantalla muestra el
     nombre: la anulación dice «la anuló Daniela Pérez», no «la anuló k1». */
  const nombreK = {};
  L('cajeras').forEach(function(k){
    nombreK[k.id] = (txt(k.nom) + ' ' + txt(k.ape)).trim();
  });
  const nomCajera = function(id){ return nombreK[id] || ''; };

  /* la posición que ocupaba cada renglón dentro de su venta, para poder
     traducir las devoluciones —que en el estado apuntan al índice— */
  const posDeLinea = {};
  L('venta_lineas').forEach(function(l){ posDeLinea[l.id] = num(l.pos) - 1; });
  const datoDeLinea = {};
  L('venta_lineas').forEach(function(l){ datoDeLinea[l.id] = l; });

  const devLin = {};
  L('devolucion_lineas').forEach(function(d){
    (devLin[d.devolucion_id] = devLin[d.devolucion_id] || []).push(d);
  });
  const devs = {};
  L('devoluciones').slice()
    .sort(function(a,b){ return orden(a.id, b.id); })
    .forEach(function(d){
      (devs[d.venta_num] = devs[d.venta_num] || []).push({
        fecha:   txt(d.fecha),
        hora:    txt(d.hora),
        usd:     n2(d.usd),
        motivo:  txt(d.motivo_texto),
        motivoC: txt(d.motivo_c),
        detalle: txt(d.detalle),
        id:      txt(d.id),
        cajera:  txt(d.cajera_id),
        pendId:  txt(d.pendiente_id),
        op:      'dev',
        lineas: (devLin[d.id] || []).map(function(x){
          const l = datoDeLinea[x.venta_linea_id] || {};
          return { i: posDeLinea[x.venta_linea_id],
                   id: txt(l.producto_id), sku: txt(l.sku), nom: txt(l.nom),
                   talla: txt(l.talla), color: txt(l.color),
                   cant: num(x.cant), precio: n4(x.precio), costo: n4(x.costo) };
        })
      });
    });

  const ventas = L('ventas').slice()
    .sort(function(a,b){ return orden(a.num, b.num); })
    .map(function(v){
      const o = {
        num: txt(v.num), fecha: txt(v.fecha), hora: txt(v.hora),
        cliId: txt(v.cliente_id), canal: txt(v.canal),
        vendedorId: nulo(v.vendedor_id), repId: nulo(v.repartidor_id),
        zonaId: nulo(v.zona_id),
        entrega: txt(v.entrega) || 'oficina', deliv: n2(v.deliv),
        cajera: txt(v.cajera_id), total: n2(v.total),
        tasa: v.tasa === null || v.tasa === undefined ? null : num(v.tasa),
        op: 'vta', pend: n2(v.pend),
        fis: { alic: num(v.fis_alicuota), base: n2(v.fis_base), iva: n2(v.fis_iva),
               exento: n2(v.fis_exento), igtfPct: num(v.fis_igtf_pct),
               igtf: n2(v.fis_igtf), cobrado: n2(v.fis_cobrado) },
        lineas: (lin[v.num] || []).map(function(l){
          return { id: txt(l.producto_id), sku: txt(l.sku), nom: txt(l.nom),
                   talla: txt(l.talla), color: txt(l.color),
                   cant: num(l.cant), desc: num(l.descontado),
                   precio: n4(l.precio), cat: txt(l.categoria),
                   costo: n4(l.costo), exento: l.exento === true };
        }),
        cobros: (cob[v.num] || []).map(function(c){
          return { met: txt(c.metodo), mon: txt(c.moneda), monto: n4(c.monto),
                   ref: txt(c.ref), banco: txt(c.banco), fuente: txt(c.fuente),
                   print: c.print || null, op: opCobro(c.metodo) };
        }),
        vueltos: (vue[v.num] || []).map(function(c){
          return { met: txt(c.metodo), mon: txt(c.moneda), monto: n4(c.monto),
                   ref: txt(c.ref), banco: txt(c.banco), fuente: txt(c.fuente),
                   print: c.print || null, op: opVuelto(c.metodo) };
        })
      };
      const a = anu[v.num];
      if(a) o.anulada = {
        fecha: txt(a.fecha), hora: txt(a.hora),
        motivo: txt(a.motivo_texto), motivoC: txt(a.motivo_c),
        detalle: txt(a.detalle), por: nomCajera(a.cajera_id),
        cierre: a.cierre_fecha ? txt(a.cierre_fecha) : null,
        vueltoCancelado: n2(a.vuelto_cancelado), yaEntregado: n2(a.ya_entregado),
        devuelto: n2(a.devuelto), pendId: txt(a.pendiente_id), op: 'anul'
      };
      if(devs[v.num]) o.devuelto = devs[v.num];
      return o;
    });

  /* ---- lo que la tienda todavía debe ---- */
  const entr = {};
  L('pendiente_entregas').forEach(function(e){
    (entr[e.pendiente_id] = entr[e.pendiente_id] || []).push(e);
  });
  for(const k in entr) entr[k].sort(function(a,b){ return num(a.pos) - num(b.pos); });

  const vpend = L('pendientes').slice()
    .sort(function(a,b){ return orden(a.id, b.id); })
    .map(function(p){
      return {
        id: txt(p.id), tipo: txt(p.tipo), venta: txt(p.venta_num),
        fecha: txt(p.fecha), cliId: txt(p.cliente_id),
        usd: n2(p.usd), saldo: n2(p.saldo), cajera: txt(p.cajera_id),
        op: opPend(p.tipo, p.nota), nota: txt(p.nota),
        anulado: p.anulado === true,
        anuladoEl: p.anulado_el ? txt(p.anulado_el) : undefined,
        entregas: (entr[p.id] || []).map(function(e){
          return { fecha: txt(e.fecha), met: txt(e.metodo), mon: txt(e.moneda),
                   monto: n4(e.monto), usd: n2(e.usd), ref: txt(e.ref),
                   banco: txt(e.banco), fuente: txt(e.fuente),
                   cajera: txt(e.cajera_id) };
        })
      };
    });

  /* ---- los cierres ---- */
  const afec = {};
  L('cierre_afectado').forEach(function(a){
    (afec[a.cierre_fecha] = afec[a.cierre_fecha] || []).push({
      venta: txt(a.venta_num), usd: n2(a.usd),
      motivo: txt(a.motivo), cuando: txt(a.cuando)
    });
  });
  const cierres = L('cierres').slice()
    .sort(function(a,b){ return orden(a.fecha, b.fecha); })
    .map(function(c){
      const o = { fecha: txt(c.fecha), cajera: txt(c.cajera_id),
                  usd: n2(c.usd), bs: n2(c.bs),
                  difUSD: n2(c.dif_usd), difBS: n2(c.dif_bs),
                  cuadro: c.cuadro === true, motivo: txt(c.motivo),
                  autoriza: txt(c.autoriza), op: 'dif_caja' };
      if(afec[c.fecha]) o.afectado = afec[c.fecha];
      return o;
    });

  /* ---- la contabilidad ---- */
  const modLin = {};
  L('modelo_lineas').forEach(function(l){
    (modLin[l.modelo_c] = modLin[l.modelo_c] || []).push(l);
  });
  for(const k in modLin) modLin[k].sort(function(a,b){ return num(a.pos) - num(b.pos); });

  const mapa = {};
  L('mapa_cuentas').forEach(function(m){ mapa[m.op] = txt(m.cta); });

  /* ---- clientes, con sus acumulados recalculados de las ventas ---- */
  const acum = {};
  ventas.forEach(function(v){
    if(v.anulada) return;
    const devuelto = (v.devuelto || []).reduce(function(a,d){ return a + d.usd; }, 0);
    const neto = n2(v.total - devuelto);
    const a = acum[v.cliId] = acum[v.cliId] || { compras: 0, monto: 0, ultima: null };
    a.compras += 1;
    a.monto = n2(a.monto + neto);
    if(!a.ultima || v.fecha > a.ultima) a.ultima = v.fecha;
  });

  const clientes = L('clientes').slice()
    .sort(function(a,b){ return orden(a.id, b.id); })
    .map(function(c){
      const a = acum[c.id] || { compras: 0, monto: 0, ultima: null };
      return { id: txt(c.id), doc: txt(c.doc), nom: txt(c.nom), ape: txt(c.ape),
               gen: txt(c.genero) || 'X', op: txt(c.operadora), tel: txt(c.tel),
               mail: txt(c.mail),
               compras: a.compras, monto: a.monto, ultima: a.ultima };
    });

  const corte = T.bitacora_corte && num(T.bitacora_corte.n) > 0
    ? { n: num(T.bitacora_corte.n), sello: txt(T.bitacora_corte.sello),
        ts: txt(T.bitacora_corte.ts) }
    : null;

  const DB = {
    v: 2,
    creado: aj.creado || '',
    ultResp: aj.ult_resp || null,
    instalado: emp.instalado === true,
    planV:     num((aj.versiones || {}).plan, 4),
    modelosV:  num((aj.versiones || {}).modelos, 3),
    marcaV:    num((aj.versiones || {}).marca, 2),
    temaV:     num((aj.versiones || {}).tema, 1),
    fondoUSD:  n2(emp.fondo_usd),
    turno:     txt(aj.turno),
    paleta:    Array.isArray(aj.paleta) ? aj.paleta.slice() : [],
    tema:      aj.tema || null,

    empresa: {
      nom: txt(emp.nom), marca: txt(emp.marca), tipoRif: txt(emp.tipo_rif) || 'J',
      rif: txt(emp.rif), dir: txt(emp.dir), ciudad: txt(emp.ciudad),
      zp: txt(emp.zp), condIVA: txt(emp.cond_iva) || 'ordinario',
      mail: txt(emp.mail), op: txt(emp.operadora) || '0412', tel: txt(emp.tel),
      logo: emp.logo || '', mono: txt(emp.mono)
    },

    fisc: {
      ivaActivo: fis.iva_activo !== false, alic: num(fis.alicuota, 16),
      delivGravado: fis.deliv_gravado !== false,
      igtfActivo: fis.igtf_activo !== false, igtfPct: num(fis.igtf_pct, 3),
      igtfMet: Array.isArray(fis.igtf_metodos) ? fis.igtf_metodos.slice()
                                               : ['efec_usd','zelle','usdt'],
      desde: txt(fis.desde),
      iaeActivo: fis.iae_activo !== false, iaeAlic: num(fis.iae_alicuota),
      iaeMin: num(fis.iae_minimo)
    },

    corr: { venta: num(corr.venta), cli: num(corr.cliente), id: num(corr.id, 100) },

    cfg: {
      claveAdmin: txt(aj.clave_admin),
      diasDev:    num(aj.dias_dev, 7),
      abreEn:     txt(aj.abre_en) || 'vta',
      /* Con la bandera: filtrar aquí y reconstruir con activo:true borraba del
         servidor el canal que sólo se quería archivar. El selector de la caja
         filtra al pintar. */
      canales: L('canales').slice()
        .sort(function(a,b){ return num(a.orden) - num(b.orden) || orden(a.nom,b.nom); })
        .map(function(c){ return { nom: txt(c.nom), activo: c.activo !== false }; }),
      motivos: L('motivos').slice().sort(function(a,b){ return orden(a.c,b.c); })
        .map(function(m){
          return { c: txt(m.c), n: txt(m.nom), d: txt(m.descr), trato: txt(m.trato),
                   pide: m.pide === true, activo: m.activo !== false };
        }),
      vendedores: L('vendedores').slice().sort(function(a,b){ return orden(a.id,b.id); })
        .map(function(v){
          return { id: txt(v.id), nom: txt(v.nom), ape: txt(v.ape), ci: txt(v.ci),
                   com: num(v.comision), banco: txt(v.banco), op: txt(v.operadora),
                   tel: txt(v.tel), activo: v.activo !== false, cta: txt(v.cta) };
        }),
      repartidores: L('repartidores').slice().sort(function(a,b){ return orden(a.id,b.id); })
        .map(function(r){
          return { id: txt(r.id), nom: txt(r.nom), ape: txt(r.ape), ci: txt(r.ci),
                   pct: num(r.pct), banco: txt(r.banco), op: txt(r.operadora),
                   tel: txt(r.tel), activo: r.activo !== false, cta: txt(r.cta) };
        }),
      zonas: L('zonas').slice().sort(function(a,b){ return orden(a.id,b.id); })
        .map(function(z){
          return { id: txt(z.id), nom: txt(z.nom), usd: n2(z.usd),
                   t: txt(z.tiempo), activo: z.activo !== false };
        }),
      cajeras: L('cajeras').slice().sort(function(a,b){ return orden(a.id,b.id); })
        .map(function(k){
          return { id: txt(k.id), nom: txt(k.nom), ape: txt(k.ape), ci: txt(k.ci),
                   activo: k.activo !== false };
        })
    },

    categorias: L('categorias').slice()
      .sort(function(a,b){ return num(a.orden) - num(b.orden) || orden(a.nom,b.nom); })
      .map(function(c){ return txt(c.nom); }),

    productos: L('productos').slice().sort(function(a,b){ return orden(a.id,b.id); })
      .map(function(p){
        return { id: txt(p.id), sku: txt(p.sku), nom: txt(p.nom), cat: txt(p.categoria),
                 ico: txt(p.ico) || '📦',
                 precio: n4(p.precio), costo: n4(p.costo),
                 activo: p.activo !== false, exento: p.exento === true,
                 foto: p.foto || '',
                 var: (varPorProd[p.id] || []).slice()
                        .sort(function(a,b){ return orden(a.t+'§'+a.c, b.t+'§'+b.c); }) };
      }),

    tasas: L('tasas').slice().sort(function(a,b){ return orden(a.fecha,b.fecha); })
      .map(function(t){
        return { fecha: txt(t.fecha), bcv: num(t.bcv),
                 par: t.paralelo === null || t.paralelo === undefined ? null : num(t.paralelo),
                 estado: txt(t.estado) };
      }),

    ventas: ventas,
    vpend: vpend,
    clientes: clientes,
    cierres: cierres,

    accionista: L('accionista_movimientos').slice()
      .sort(function(a,b){ return num(a.id) - num(b.id); })
      .map(function(m){
        return { fecha: txt(m.fecha), tipo: txt(m.tipo), concepto: txt(m.concepto),
                 usd: n4(m.usd), ref: txt(m.ref), venta: txt(m.venta_num),
                 op: opAcc(m.tipo), met: txt(m.metodo), print: m.print || null };
      }),

    correos: L('correos').slice().sort(function(a,b){ return num(a.id) - num(b.id); })
      .map(function(c){
        return { fecha: txt(c.fecha), cliId: txt(c.cliente_id),
                 cli: txt(c.cli_nom), mail: txt(c.mail),
                 venta: txt(c.venta_num), arts: num(c.arts), tipo: txt(c.tipo),
                 estado: txt(c.estado) };
      }),

    cuentas: L('cuentas').slice().sort(function(a,b){ return orden(a.c,b.c); })
      .map(function(c){ return { c: txt(c.c), n: txt(c.nom), t: txt(c.tipo) }; }),

    mapaCtas: mapa,

    modelos: L('modelos').slice().sort(function(a,b){ return orden(a.c,b.c); })
      .map(function(m){
        return { c: txt(m.c), fam: txt(m.familia), n: txt(m.nom), ver: num(m.version, 1),
                 activo: m.activo !== false, disp: txt(m.dispara), d: txt(m.descr),
                 lineas: (modLin[m.c] || []).map(function(l){
                   return { cta: txt(l.cta), nat: txt(l.naturaleza),
                            org: txt(l.origen), d: txt(l.descr) };
                 }) };
      }),

    bitacora: L('bitacora').slice().sort(function(a,b){ return num(a.seq) - num(b.seq); })
      .map(function(b){
        return { ts: txt(b.ts), u: txt(b.usuario), modulo: txt(b.modulo),
                 accion: txt(b.accion), detalle: txt(b.detalle),
                 prev: txt(b.prev), h: txt(b.h) };
      }),

    bitCorte: corte
  };

  return DB;
}

/* ==========================================================================
   DEL ESTADO A LAS TABLAS

   Sólo lo que el navegador tiene derecho a escribir directo. Las ventas, las
   anulaciones y las devoluciones NO están aquí: ésas pasan por las tres
   transacciones del servidor, que son las únicas que pueden tocar existencia
   y correlativos.
   ========================================================================== */
/* LAS VARIANTES DE UN ARTÍCULO, INCLUYENDO LAS QUE TODAVÍA ESTÁN EN EL
   FORMATO VIEJO.

   Un artículo cargado antes de que existieran los colores guarda su
   existencia en `tallas[]` o en `exi`, y SICOM lo convierte al vuelo cuando
   abre. El migrador tiene que hacer exactamente lo mismo: si lee sólo `var`,
   un respaldo sin migrar llega al servidor con el inventario en cero y nadie
   se entera hasta que la caja no deja vender nada. */
function variantesDe(p){
  if(Array.isArray(p.var) && p.var.length) return p.var;
  if(Array.isArray(p.var)) return [];
  if(Array.isArray(p.tallas) && p.tallas.length)
    return p.tallas.map(function(x){
      return { t: txt(x.t), c: '', e: Math.max(0, num(x.e)) };
    });
  return [{ t: '', c: '', e: Math.max(0, num(p.exi)) }];
}

function aFilas(DB){
  DB = DB || {};
  const cfg = DB.cfg || {};
  const emp = DB.empresa || {};
  const f   = DB.fisc || {};

  return {
    empresa: {
      id: 1, nom: txt(emp.nom), marca: txt(emp.marca),
      tipo_rif: txt(emp.tipoRif) || 'J', rif: txt(emp.rif), dir: txt(emp.dir),
      ciudad: txt(emp.ciudad), zp: txt(emp.zp),
      cond_iva: txt(emp.condIVA) || 'ordinario', mail: txt(emp.mail),
      operadora: txt(emp.op) || '0412', tel: txt(emp.tel),
      logo: emp.logo || null, mono: txt(emp.mono),
      instalado: DB.instalado === true, fondo_usd: n4(DB.fondoUSD)
    },

    /* Los parámetros fiscales NO viajan por el diferenciador: cambiarlos con
       el mismo `desde` pisaría la vigencia anterior, y la tabla existe
       justamente para conservarla. Un cambio de régimen abre una fila nueva
       desde su propia pantalla. */
    __fiscales: {
      desde: txt(f.desde), iva_activo: f.ivaActivo !== false,
      alicuota: num(f.alic, 16), deliv_gravado: f.delivGravado !== false,
      igtf_activo: f.igtfActivo !== false, igtf_pct: num(f.igtfPct, 3),
      igtf_metodos: Array.isArray(f.igtfMet) ? f.igtfMet.slice()
                                             : ['efec_usd','zelle','usdt'],
      iae_activo: f.iaeActivo !== false, iae_alicuota: num(f.iaeAlic),
      iae_minimo: num(f.iaeMin)
    },

    canales: (cfg.canales || []).map(function(c, i){
      return typeof c === 'string'
        ? { nom: txt(c), activo: true, orden: i }
        : { nom: txt(c.nom), activo: c.activo !== false, orden: i };
    }),

    zonas: (cfg.zonas || []).map(function(z){
      return { id: txt(z.id), nom: txt(z.nom), usd: n4(z.usd),
               tiempo: txt(z.t) || 'Por confirmar', activo: z.activo !== false };
    }),

    motivos: (cfg.motivos || []).map(function(m){
      return { c: txt(m.c), nom: txt(m.n), descr: txt(m.d), trato: txt(m.trato),
               pide: m.pide === true, activo: m.activo !== false };
    }),

    cajeras: (cfg.cajeras || []).map(function(k){
      return { id: txt(k.id), nom: txt(k.nom), ape: txt(k.ape), ci: txt(k.ci),
               activo: k.activo !== false };
    }),

    vendedores: (cfg.vendedores || []).map(function(v){
      return { id: txt(v.id), nom: txt(v.nom), ape: txt(v.ape), ci: txt(v.ci),
               comision: num(v.com), banco: txt(v.banco), operadora: txt(v.op),
               tel: txt(v.tel), cta: nulo(v.cta), activo: v.activo !== false };
    }),

    repartidores: (cfg.repartidores || []).map(function(r){
      return { id: txt(r.id), nom: txt(r.nom), ape: txt(r.ape), ci: txt(r.ci),
               pct: num(r.pct), banco: txt(r.banco), operadora: txt(r.op),
               tel: txt(r.tel), cta: nulo(r.cta), activo: r.activo !== false };
    }),

    clientes: (DB.clientes || []).map(function(c){
      return { id: txt(c.id), doc: txt(c.doc), nom: txt(c.nom), ape: txt(c.ape),
               genero: txt(c.gen) || 'X', operadora: txt(c.op), tel: txt(c.tel),
               mail: txt(c.mail) };
    }),

    categorias: (DB.categorias || []).map(function(c, i){
      return { nom: txt(c), orden: i };
    }),

    productos: (DB.productos || []).map(function(p){
      return { id: txt(p.id), sku: txt(p.sku), nom: txt(p.nom),
               categoria: txt(p.cat), ico: txt(p.ico) || '📦',
               costo: n4(p.costo), precio: n4(p.precio),
               exento: p.exento === true, activo: p.activo !== false,
               foto: p.foto || null };
    }),

    producto_variantes: (DB.productos || []).reduce(function(a, p){
      variantesDe(p).forEach(function(v){
        a.push({ producto_id: txt(p.id), talla: txt(v.t), color: txt(v.c),
                 existencia: num(v.e) });
      });
      return a;
    }, []),

    tasas: (DB.tasas || []).map(function(t){
      return { fecha: txt(t.fecha), bcv: num(t.bcv),
               paralelo: t.par === null || t.par === undefined ? null : num(t.par),
               estado: txt(t.estado) || 'por confirmar' };
    }),

    cierres: (DB.cierres || []).map(function(c){
      return { fecha: txt(c.fecha), cajera_id: nulo(c.cajera), usd: n4(c.usd),
               bs: n4(c.bs), dif_usd: n4(c.difUSD), dif_bs: n4(c.difBS),
               cuadro: c.cuadro === true, motivo: txt(c.motivo),
               autoriza: txt(c.autoriza) };
    }),

    /* `cierre_afectado` la escribe el servidor en las tres transacciones. Por
       el diferenciador se perdían filas: dos devoluciones de la misma venta el
       mismo día producían la misma llave, y la tabla no tiene índice único que
       permita un upsert. */

    pendiente_entregas: (DB.vpend || []).reduce(function(a, p){
      (p.entregas || []).forEach(function(e, i){
        a.push({ pendiente_id: txt(p.id), pos: i + 1, fecha: txt(e.fecha),
                 metodo: txt(e.met), moneda: txt(e.mon) || 'USD',
                 monto: n4(e.monto), usd: n4(e.usd), ref: txt(e.ref),
                 banco: txt(e.banco), fuente: txt(e.fuente) || 'empresa',
                 cajera_id: nulo(e.cajera) });
      });
      return a;
    }, []),

    /* Sólo el saldo y la anulación: el resto de la fila la escribe el
       servidor. La clave se llama como la tabla para que el escritor no tenga
       que traducir nombres. */
    pendientes: (DB.vpend || []).map(function(p){
      return { id: txt(p.id), saldo: n4(p.saldo), anulado: p.anulado === true,
               anulado_el: p.anuladoEl ? txt(p.anuladoEl) : null };
    }),

    cuentas: (DB.cuentas || []).map(function(c){
      return { c: txt(c.c), nom: txt(c.n), tipo: txt(c.t) };
    }),

    mapa_cuentas: Object.keys(DB.mapaCtas || {}).map(function(k){
      return { op: k, cta: nulo((DB.mapaCtas || {})[k]) };
    }),

    modelos: (DB.modelos || []).map(function(m){
      return { c: txt(m.c), familia: txt(m.fam), nom: txt(m.n),
               version: num(m.ver, 1), activo: m.activo !== false,
               dispara: txt(m.disp), descr: txt(m.d) };
    }),

    modelo_lineas: (DB.modelos || []).reduce(function(a, m){
      (m.lineas || []).forEach(function(l, i){
        a.push({ modelo_c: txt(m.c), pos: i + 1, cta: nulo(l.cta),
                 naturaleza: txt(l.nat), origen: txt(l.org), descr: txt(l.d) });
      });
      return a;
    }, []),

    ajustes: [
      { clave: 'tema',        valor: DB.tema || null },
      { clave: 'paleta',      valor: (DB.paleta || []).slice() },
      { clave: 'clave_admin', valor: txt((DB.cfg || {}).claveAdmin) },
      { clave: 'dias_dev',    valor: num((DB.cfg || {}).diasDev, 7) },
      { clave: 'abre_en',     valor: txt((DB.cfg || {}).abreEn) || 'vta' },
      { clave: 'turno',       valor: txt(DB.turno) },
      { clave: 'creado',      valor: txt(DB.creado) },
      { clave: 'ult_resp',    valor: DB.ultResp || null },
      { clave: 'versiones',   valor: { plan: num(DB.planV, 4), modelos: num(DB.modelosV, 3),
                                       marca: num(DB.marcaV, 2), tema: num(DB.temaV, 1) } }
    ].filter(function(a){ return a.valor !== null || a.clave === 'ult_resp'
                                 || a.clave === 'tema'; })
  };
}

/* ==========================================================================
   EL DIFERENCIADOR

   Compara lo que hay ahora contra lo último que se sabe del servidor y
   devuelve sólo lo que cambió. Sin esto, cada tecla reescribiría el catálogo
   entero.
   ========================================================================== */
const LLAVE_TABLA = {
  empresa:            ['id'],
  canales:            ['nom'],
  zonas:              ['id'],
  motivos:            ['c'],
  cajeras:            ['id'],
  vendedores:         ['id'],
  repartidores:       ['id'],
  clientes:           ['id'],
  categorias:         ['nom'],
  productos:          ['id'],
  producto_variantes: ['producto_id','talla','color'],
  tasas:              ['fecha'],
  cierres:            ['fecha'],
  pendiente_entregas: ['pendiente_id','pos'],
  pendientes:         ['id'],
  cuentas:            ['c'],
  mapa_cuentas:       ['op'],
  modelos:            ['c'],
  modelo_lineas:      ['modelo_c','pos'],
  ajustes:            ['clave']
};

function llaveDe(tabla, fila){
  return (LLAVE_TABLA[tabla] || ['id']).map(function(k){
    return String(fila[k] === null || fila[k] === undefined ? '' : fila[k]);
  }).join('§');
}

function igual(a, b){
  if(a === b) return true;
  if(a === null || b === null || a === undefined || b === undefined) return false;
  if(typeof a !== 'object' || typeof b !== 'object') return String(a) === String(b);
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if(ka.length !== kb.length) return false;
  for(let i = 0; i < ka.length; i++){
    if(ka[i] !== kb[i]) return false;
    if(!igual(a[ka[i]], b[ka[i]])) return false;
  }
  return true;
}

function diferencia(nuevo, espejo){
  nuevo  = nuevo  || {};
  espejo = espejo || {};
  const cambios = {};

  Object.keys(nuevo).forEach(function(tabla){
    const n = nuevo[tabla], e = espejo[tabla];

    /* una sola fila: empresa, parámetros fiscales */
    if(!Array.isArray(n)){
      if(!igual(n, e)) cambios[tabla] = { pon: [n], quita: [] };
      return;
    }

    const mE = {}; (Array.isArray(e) ? e : []).forEach(function(x){ mE[llaveDe(tabla,x)] = x; });
    const mN = {}; n.forEach(function(x){ mN[llaveDe(tabla,x)] = x; });

    const pon = [], quita = [];
    Object.keys(mN).forEach(function(k){
      if(!igual(mN[k], mE[k])) pon.push(mN[k]);
    });
    Object.keys(mE).forEach(function(k){
      if(!(k in mN)) quita.push(mE[k]);
    });
    if(pon.length || quita.length) cambios[tabla] = { pon: pon, quita: quita };
  });

  return cambios;
}

function cuantos(cambios){
  let n = 0;
  Object.keys(cambios || {}).forEach(function(t){
    n += (cambios[t].pon || []).length + (cambios[t].quita || []).length;
  });
  return n;
}

/* ==========================================================================
   LO QUE SE MANDA A LA CAJA DEL SERVIDOR
   ========================================================================== */
function ventaAServidor(v, cli, usuario){
  return {
    cliente: cli && cli.id && !cli.nuevo
      ? { id: cli.id }
      : { doc: txt((cli||{}).doc), nom: txt((cli||{}).nom).trim(),
          ape: txt((cli||{}).ape).trim(), genero: txt((cli||{}).gen) || 'X',
          operadora: txt((cli||{}).op), tel: txt((cli||{}).tel),
          mail: txt((cli||{}).mail).trim() },
    canal: txt(v.canal), vendedor_id: nulo(v.vendedorId),
    repartidor_id: nulo(v.repId), zona_id: nulo(v.zonaId),
    entrega: txt(v.entrega) || 'oficina', deliv: n4(v.deliv),
    cajera_id: nulo(v.cajera), total: n2(v.total),
    tasa: v.tasa === null || v.tasa === undefined ? null : num(v.tasa),
    pend: n2(v.pend),
    fis: { alicuota: num((v.fis||{}).alic), base: n2((v.fis||{}).base),
           iva: n2((v.fis||{}).iva), exento: n2((v.fis||{}).exento),
           igtf_pct: num((v.fis||{}).igtfPct), igtf: n2((v.fis||{}).igtf),
           cobrado: n2((v.fis||{}).cobrado) },
    lineas: (v.lineas || []).map(function(l){
      return { producto_id: txt(l.id), sku: txt(l.sku), nom: txt(l.nom),
               categoria: txt(l.cat), talla: txt(l.talla), color: txt(l.color),
               cant: num(l.cant), precio: n4(l.precio), costo: n4(l.costo),
               exento: l.exento === true };
    }),
    cobros: (v.cobros || []).map(function(c){
      return { metodo: txt(c.met), moneda: txt(c.mon) || 'USD', monto: n4(c.monto),
               ref: txt(c.ref), banco: txt(c.banco),
               fuente: txt(c.fuente) || 'empresa' };
    }),
    vueltos: (v.vueltos || []).map(function(c){
      return { metodo: txt(c.met), moneda: txt(c.mon) || 'USD', monto: n4(c.monto),
               ref: txt(c.ref), banco: txt(c.banco),
               fuente: txt(c.fuente) || 'empresa' };
    }),
    usuario: txt(usuario)
  };
}

/* ==========================================================================
   LAS TABLAS DE LA CAJA, A PARTIR DEL ESTADO

   Esto NO lo usa el día a día —las ventas las escribe el servidor— sino el
   migrador: el que toma el documento de producción y lo vuelca a las tablas
   una sola vez. También es lo que permite comprobar el puente con datos
   reales: se convierte de ida y de vuelta y tiene que dar exactamente lo
   mismo.

   El identificador del renglón lo asigna el servidor. Aquí se asigna uno
   correlativo para poder amarrar las devoluciones, que en el documento
   apuntan al ÍNDICE del renglón dentro de la venta.
   ========================================================================== */
function aFilasVentas(DB){
  DB = DB || {};
  /* El documento viejo guarda el NOMBRE de quien anuló; las tablas guardan su
     identificador. Se resuelve por nombre completo, que es como lo escribió
     el propio sistema al anular. */
  const idK = {};
  (((DB.cfg || {}).cajeras) || []).forEach(function(k){
    idK[(txt(k.nom) + ' ' + txt(k.ape)).trim()] = txt(k.id);
  });
  const ventas = [], lineas = [], cobros = [], vueltos = [], anulaciones = [],
        devoluciones = [], devLineas = [], pendientes = [], correos = [],
        accionista = [], bitacora = [];
  let idLinea = 0, nDev = 0;

  (DB.ventas || []).forEach(function(v){
    ventas.push({
      num: txt(v.num), fecha: txt(v.fecha), hora: txt(v.hora),
      cliente_id: nulo(v.cliId), canal: nulo(v.canal),
      vendedor_id: nulo(v.vendedorId), repartidor_id: nulo(v.repId),
      zona_id: nulo(v.zonaId), entrega: txt(v.entrega) || 'oficina',
      deliv: n4(v.deliv), cajera_id: nulo(v.cajera), total: n2(v.total),
      tasa: v.tasa === null || v.tasa === undefined ? null : num(v.tasa),
      fis_alicuota: num((v.fis||{}).alic), fis_base: n4((v.fis||{}).base),
      fis_iva: n4((v.fis||{}).iva), fis_exento: n4((v.fis||{}).exento),
      fis_igtf_pct: num((v.fis||{}).igtfPct), fis_igtf: n4((v.fis||{}).igtf),
      fis_cobrado: n4((v.fis||{}).cobrado), pend: n4(v.pend)
    });

    const idsDeIndice = {};
    (v.lineas || []).forEach(function(l, i){
      idLinea += 1;
      idsDeIndice[i] = idLinea;
      /* `_id` con guion bajo: es el amarre interno para las devoluciones, no
         una columna. `venta_lineas.id` lo asigna el servidor. */
      lineas.push({ _id: idLinea, venta_num: txt(v.num), pos: i + 1,
                    producto_id: nulo(l.id), sku: txt(l.sku), nom: txt(l.nom),
                    categoria: txt(l.cat), talla: txt(l.talla), color: txt(l.color),
                    cant: num(l.cant),
                    descontado: l.desc === undefined ? num(l.cant) : num(l.desc),
                    precio: n4(l.precio), costo: n4(l.costo),
                    exento: l.exento === true });
    });

    (v.cobros || []).forEach(function(c, i){
      cobros.push({ venta_num: txt(v.num), pos: i + 1, metodo: txt(c.met),
                    moneda: txt(c.mon) || 'USD', monto: n4(c.monto),
                    ref: txt(c.ref), banco: txt(c.banco),
                    fuente: txt(c.fuente) || 'empresa', print: c.print || null });
    });
    (v.vueltos || []).forEach(function(c, i){
      vueltos.push({ venta_num: txt(v.num), pos: i + 1, metodo: txt(c.met),
                     moneda: txt(c.mon) || 'USD', monto: n4(c.monto),
                     ref: txt(c.ref), banco: txt(c.banco),
                     fuente: txt(c.fuente) || 'empresa', print: c.print || null });
    });

    if(v.anulada) anulaciones.push({
      venta_num: txt(v.num), fecha: txt(v.anulada.fecha), hora: txt(v.anulada.hora),
      motivo_c: nulo(v.anulada.motivoC), motivo_texto: txt(v.anulada.motivo),
      detalle: txt(v.anulada.detalle),
      cajera_id: idK[txt(v.anulada.por).trim()] || null,
      cierre_fecha: v.anulada.cierre ? txt(v.anulada.cierre) : null,
      vuelto_cancelado: n4(v.anulada.vueltoCancelado),
      ya_entregado: n4(v.anulada.yaEntregado), devuelto: n4(v.anulada.devuelto),
      pendiente_id: nulo(v.anulada.pendId)
    });

    (v.devuelto || []).forEach(function(d){
      nDev += 1;
      const did = 'dvm' + nDev;
      devoluciones.push({ id: did, venta_num: txt(v.num), fecha: txt(d.fecha),
                          hora: txt(d.hora), usd: n4(d.usd),
                          motivo_c: nulo(d.motivoC), motivo_texto: txt(d.motivo),
                          detalle: txt(d.detalle), cajera_id: nulo(d.cajera),
                          pendiente_id: nulo(d.pendId) });
      (d.lineas || []).forEach(function(x){
        devLineas.push({ devolucion_id: did, _venta_linea: idsDeIndice[x.i],
                         cant: num(x.cant), precio: n4(x.precio), costo: n4(x.costo) });
      });
    });
  });

  (DB.vpend || []).forEach(function(p){
    pendientes.push({ id: txt(p.id), tipo: txt(p.tipo) || 'vuelto',
                      venta_num: nulo(p.venta), fecha: txt(p.fecha),
                      cliente_id: nulo(p.cliId), usd: n4(p.usd), saldo: n4(p.saldo),
                      cajera_id: nulo(p.cajera), nota: txt(p.nota),
                      anulado: p.anulado === true,
                      anulado_el: p.anuladoEl ? txt(p.anuladoEl) : null });
  });

  (DB.accionista || []).forEach(function(m, i){
    accionista.push({ accionista_id: null, fecha: txt(m.fecha),
                      tipo: txt(m.tipo), concepto: txt(m.concepto), usd: n4(m.usd),
                      ref: txt(m.ref), venta_num: nulo(m.venta),
                      metodo: nulo(m.met), print: m.print || null });
  });

  /* El documento viejo no guardaba a qué clienta se le mandó el correo: sólo
     el nombre escrito. Se recupera por la venta —que sí sabe de quién es— y,
     si el correo no viene de una venta, por la dirección. */
  const cliDeVenta = {};
  (DB.ventas || []).forEach(function(v){ cliDeVenta[txt(v.num)] = txt(v.cliId); });
  const cliDeMail = {};
  (DB.clientes || []).forEach(function(c){
    if(txt(c.mail)) cliDeMail[txt(c.mail).toLowerCase()] = txt(c.id);
  });

  (DB.correos || []).forEach(function(c, i){
    correos.push({ fecha: txt(c.fecha),
                   cliente_id: nulo(c.cliId
                                    || cliDeVenta[txt(c.venta)]
                                    || cliDeMail[txt(c.mail).toLowerCase()]),
                   cli_nom: txt(c.cli), mail: txt(c.mail), venta_num: nulo(c.venta),
                   arts: num(c.arts), tipo: txt(c.tipo),
                   estado: txt(c.estado) || 'enviado' });
  });

  (DB.bitacora || []).forEach(function(b, i){
    bitacora.push({ ts: txt(b.ts), usuario: txt(b.u),
                    modulo: txt(b.modulo), accion: txt(b.accion),
                    detalle: txt(b.detalle), prev: txt(b.prev), h: txt(b.h) });
  });

  const c = DB.corr || {};
  return {
    ventas: ventas, venta_lineas: lineas, venta_cobros: cobros,
    venta_vueltos: vueltos, venta_anulacion: anulaciones,
    devoluciones: devoluciones, devolucion_lineas: devLineas,
    pendientes: pendientes, accionista_movimientos: accionista,
    correos: correos, bitacora: bitacora,
    bitacora_corte: DB.bitCorte
      ? { id: 1, n: num(DB.bitCorte.n), sello: txt(DB.bitCorte.sello),
          ts: txt(DB.bitCorte.ts) }
      : { id: 1, n: 0, sello: '', ts: null },
    correlativos: [ { tipo: 'venta',   valor: num(c.venta) },
                    { tipo: 'cliente', valor: num(c.cli) },
                    { tipo: 'id',      valor: num(c.id, 100) } ]
  };
}

/* Los parámetros fiscales NO salen por `aFilas`: un cambio de régimen abre
   una vigencia nueva, no pisa la anterior. Quien los necesite —el generador de
   la semilla, la pantalla fiscal— los pide aquí. */
function fiscales(DB){ return aFilas(DB).__fiscales; }

function aFilasSinFiscales(DB){
  const o = aFilas(DB); delete o.__fiscales; return o;
}

const API = {
  aEstado: aEstado,
  aFilas: aFilasSinFiscales,
  aFilasCrudo: aFilas,
  fiscales: fiscales,
  aFilasVentas: aFilasVentas,
  variantesDe: variantesDe,
  diferencia: diferencia,
  cuantos: cuantos,
  llaveDe: llaveDe,
  igual: igual,
  ventaAServidor: ventaAServidor,
  LLAVE_TABLA: LLAVE_TABLA
};

raiz.CORE_MAP = API;
if(typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis);
