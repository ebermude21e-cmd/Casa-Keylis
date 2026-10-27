/* ==========================================================================
   SICOM · CORE · EL TRANSPORTE
   Casa Keylis Boutique Femine, C.A.

   Lo único que habla con el servidor. Doce puertas publicadas: tres para
   leer y guardar la configuración, y nueve para las operaciones de caja.
   Nada más. Ninguna tabla.

   Reparto de trabajo:

     core_puente.js    traduce entre tablas y el estado de la pantalla.
                       Funciones puras, no tocan la red.
     core_transporte.js (este)  mueve datos por la red. No traduce ni decide.
     la pantalla       ni se entera de que hay un servidor.

   Lo que NO hace, a propósito:

   · No guarda nada del negocio en el navegador. Ni una venta, ni un cliente,
     ni el catálogo. Lo que hay en memoria muere al cerrar la pestaña.
   · La sesión va en `sessionStorage`, no en `localStorage`: vive mientras la
     pestaña esté abierta y se borra al cerrarla. No queda nada escrito en el
     disco de ningún equipo.
   · No escribe en el libro contable. Para eso están las operaciones, que
     validan lo suyo. Si alguien intenta colar una tabla del libro por el
     guardado de configuración, este guion falla antes de salir a la red.
   ========================================================================== */
(function(raiz){
'use strict';

/* Las dieciocho tablas de configuración. Tiene que ser la misma lista que
   la de `core.guarda_config`, y por eso está escrita aquí completa en vez de
   deducirse: si las dos listas se separan, se nota al leerlas, no a las tres
   semanas en una venta. */
const CONFIGURACION = [
  'accionistas', 'ajustes', 'cajeras', 'canales', 'categorias', 'clientes',
  'cuentas', 'empresa', 'mapa_cuentas', 'modelo_lineas', 'modelos', 'motivos',
  'parametros_fiscales', 'productos', 'repartidores', 'tasas', 'vendedores',
  'zonas'
];

/* El libro contable. No se escribe por el guardado: cada una tiene su
   operación, y es la operación la que valida. El mensaje nombra cuál. */
const POR_OPERACION = {
  ventas:                 'registra_venta',
  venta_lineas:           'registra_venta',
  venta_cobros:           'registra_venta',
  venta_vueltos:          'registra_venta',
  venta_anulacion:        'anula_venta',
  devoluciones:           'devuelve',
  devolucion_lineas:      'devuelve',
  pendientes:             'entrega_pendiente',
  pendiente_entregas:     'entrega_pendiente',
  cierres:                'firma_cierre',
  cierre_afectado:        'firma_cierre',
  accionista_movimientos: 'anota_accionista',
  correos:                'anota_correo',
  producto_variantes:     'fija_inventario',
  bitacora:               '(nadie: solo crece)',
  bitacora_corte:         '(nadie: solo crece)',
  correlativos:           '(nadie: los mueve el servidor)'
};

function esConfiguracion(t){ return CONFIGURACION.indexOf(t) !== -1; }

/* ---------------------------------------------------------------------- */
function crea(opciones){
  opciones = opciones || {};
  const url   = opciones.url;
  const llave = opciones.llave;
  const hacerCliente = opciones.hacerCliente ||
    (raiz.supabase && raiz.supabase.createClient);

  if(!hacerCliente) throw new Error('falta la biblioteca de Supabase');
  if(!url || !llave) throw new Error('faltan la direccion y la llave publica');

  const cliente = hacerCliente(url, llave, {
    auth: {
      /* La sesión muere con la pestaña. Es lo que pidió el dueño: que no
         quede nada del sistema en el equipo. Un `localStorage` guardaría el
         token en el disco y sobreviviría a apagar la máquina. */
      storage: raiz.sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });

  /* ------------------------------------------------------------------ */
  /* LA SESIÓN                                                           */
  /* ------------------------------------------------------------------ */
  async function entra(correo, clave){
    const r = await cliente.auth.signInWithPassword({
      email: String(correo || '').trim(),
      password: String(clave || '')
    });
    if(r.error) throw new Error('no se pudo entrar: ' + r.error.message);
    return await quien();
  }

  async function sale(){
    await cliente.auth.signOut();
  }

  /* Quién está del otro lado. La respuesta la da el servidor leyendo el
     token, no la pantalla diciendo quién cree que es. */
  async function quien(){
    const r = await cliente.rpc('sicom_lee_pantalla', { p_con_fotos: false });
    if(r.error) throw new Error(r.error.message);
    return r.data && r.data.yo;
  }

  /* ------------------------------------------------------------------ */
  /* CARGAR                                                              */
  /* ------------------------------------------------------------------ */
  async function carga(conFotos){
    const r = await cliente.rpc('sicom_lee_pantalla',
                                { p_con_fotos: conFotos === true });
    if(r.error) throw new Error('no se pudo cargar: ' + r.error.message);

    const sobre  = r.data || {};
    const tablas = sobre.tablas || {};
    const DB     = raiz.CORE_MAP.aEstado(tablas);

    /* El espejo se saca del MISMO camino que usará el guardado. Si se
       copiaran las tablas tal como llegaron, el primer guardado creería que
       todo cambió, porque el viaje de ida y vuelta normaliza valores. */
    return {
      yo:     sobre.yo,
      leido:  sobre.leido_en,
      DB:     DB,
      espejo: raiz.CORE_MAP.aFilas(DB)
    };
  }

  async function foto(id){
    const r = await cliente.rpc('sicom_lee_foto', { p_id: String(id) });
    if(r.error) throw new Error(r.error.message);
    return r.data;
  }

  /* ------------------------------------------------------------------ */
  /* GUARDAR LA CONFIGURACIÓN                                            */
  /* ------------------------------------------------------------------ */

  /* Separa lo que va por el guardado de lo que no debería estar aquí.
     Devuelve { cambios, sobran } sin salir a la red: así la pantalla puede
     preguntar qué va a pasar antes de que pase. */
  function planifica(DB, espejo){
    const todo    = raiz.CORE_MAP.aFilas(DB);
    const diff    = raiz.CORE_MAP.diferencia(todo, espejo || {});
    const cambios = {};
    const sobran  = [];

    Object.keys(diff).forEach(function(tabla){
      if(esConfiguracion(tabla)) cambios[tabla] = diff[tabla];
      else sobran.push(tabla);
    });

    /* `todo` viaja con el plan: es la FOTO desde la que se calculó, y es la
       que tiene que quedar como espejo si el guardado sale bien. Tomar el
       espejo de `aFilas(DB)` al volver del viaje absorbía lo que el
       documento hubiera cambiado MIENTRAS el sobre iba de camino: esos
       cambios quedaban dentro del espejo sin haberse mandado nunca, y el
       diferenciador siguiente no los veía. Medido el 26/10 (PAN-34): dos
       cambios pendientes, uno enviado, semáforo «al día», `cuantos: 0`. */
    return { cambios: cambios, sobran: sobran, todo: todo,
             cuantos: raiz.CORE_MAP.cuantos(cambios) };
  }

  async function guarda(DB, espejo){
    const plan = planifica(DB, espejo);

    if(plan.sobran.length){
      /* No se manda a medias ni se descarta en silencio. Si la pantalla
         cambió algo del libro contable, es un error de la pantalla, y el
         mensaje dice por dónde debía ir. */
      const detalle = plan.sobran.map(function(t){
        return t + ' → ' + (POR_OPERACION[t] || 'una operación, no el guardado');
      }).join('; ');
      throw new Error('esto no se guarda por configuracion: ' + detalle);
    }

    if(plan.cuantos === 0){
      return { puestas: 0, quitadas: 0, detalle: 'nada que guardar',
               espejo: plan.todo };
    }

    const r = await cliente.rpc('sicom_guarda_config', { p: plan.cambios });
    if(r.error) throw new Error('no se pudo guardar: ' + r.error.message);

    /* El espejo nuevo es LO QUE SE ACABA DE MANDAR —la foto del plan—, no lo
       que la pantalla tiene ahora: si el servidor normalizó algo, la próxima
       carga lo trae, y si el documento cambió mientras el sobre iba de
       camino, ese cambio sigue pendiente en vez de quedar absorbido. */
    const d = r.data || {};
    return {
      puestas:  d.puestas  || 0,
      quitadas: d.quitadas || 0,
      detalle:  d.detalle  || '',
      por:      d.por,
      espejo:   plan.todo
    };
  }

  /* ------------------------------------------------------------------ */
  /* LAS OPERACIONES DE CAJA                                             */
  /*                                                                     */
  /* Pasan derecho: el servidor valida, numera y asienta. Aquí no se      */
  /* toca el contenido, solo se lleva y se trae.                         */
  /* ------------------------------------------------------------------ */
  const OPERACIONES = [
    'registra_venta', 'anula_venta', 'devuelve', 'entrega_pendiente',
    'firma_cierre', 'fija_inventario', 'retira_variante',
    /* `clave_ok` no mueve dinero: dice si una clave es la del administrador.
       Va aquí porque es una puerta publicada más, y porque la pantalla ya no
       puede comprobarla sola —el servidor dejó de mandarle el sello—. */
    'clave_ok',
    'anota_accionista', 'anota_correo',
    /* EL REPARTIDOR DE IDENTIFICADORES (036, ARQ-33). No escribe en el libro
       y aun así es una operación y no un guardado: el correlativo es del
       servidor. La pantalla acuñaba los suyos con un contador que ninguna
       función del servidor movía, y dos clientes que leyeran el mismo número
       creaban dos veces el mismo `p101`: `guarda_config` reconoce
       `productos` por su `id` y el segundo RENOMBRABA al primero, en
       silencio. Lo midió el DBA el 26/10. */
    'nuevos_ids'
  ];

  /* La puerta publicada de cada operación lleva el prefijo `sicom_`. No es
     adorno: `public` es el único esquema expuesto y es donde aterriza
     cualquier extensión que se instale, así que un `devuelve` o un
     `firma_cierre` a secas serían nombres genéricos en vía pública. Además la
     superficie publicada del sistema se cuenta con un solo `like 'sicom_%'`,
     y una cuenta que deja fuera nueve puertas es peor que no tenerla.

     Hacia adentro del guion las operaciones siguen llamándose por su nombre
     —`nube.op.registra_venta(...)`— porque el prefijo es de la puerta, no de
     la operación. Si alguna vez las puertas se renombran, se cambia aquí y en
     ningún otro sitio. */
  function puerta(op){ return 'sicom_' + op; }

  const operaciones = {};
  OPERACIONES.forEach(function(op){
    operaciones[op] = async function(carga){
      const r = await cliente.rpc(puerta(op), { p: carga });
      if(r.error) throw new Error(op + ': ' + r.error.message);
      return r.data;
    };
  });

  return {
    entra: entra, sale: sale, quien: quien,
    carga: carga, foto: foto,
    planifica: planifica, guarda: guarda,
    op: operaciones,
    CONFIGURACION: CONFIGURACION,
    cliente: cliente
  };
}

const API = { crea: crea, CONFIGURACION: CONFIGURACION, POR_OPERACION: POR_OPERACION };
raiz.CORE_NUBE = API;
if(typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis);
