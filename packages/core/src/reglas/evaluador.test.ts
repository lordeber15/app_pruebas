import { describe, expect, it } from 'vitest';
import { transicionarEjecucion } from '../ejecucion/maquina.ts';
import {
  ESTACION_COSTA,
  ESTACION_SELVA,
  ESTACION_SIN_REGION,
  ESTACION_ZA_EF,
  campo,
  ejecucion,
  foto,
  fotos,
  lima,
  metodoBase,
  mover,
  ORIGEN,
  puntos,
  unidad,
  val,
} from './_fixtures.ts';
import { evaluarEjecucion, resultadosDestacados, tiposConTrack } from './evaluador.ts';
import type { ResultadoRegla } from './tipos.ts';

const de = (r: readonly ResultadoRegla[], regla: ResultadoRegla['regla']): ResultadoRegla[] =>
  r.filter((x) => x.regla === regla);
const estados = (r: readonly ResultadoRegla[], regla: ResultadoRegla['regla']): string[] =>
  de(r, regla).map((x) => x.estado);

describe('RN-31 tipo de control: solo lo obligatorio genera incumplimiento', () => {
  const ves = metodoBase({
    codigo: 'anfibios_reptiles.ves',
    unidad: { tipo: 'recorrido', tipos_adicionales: [], texto: null },
    geometria: {
      tipo: 'inicio_fin',
      texto: 'Inicio + fin; recorrido con track',
      vinculo_metodo: null,
      detalle: null,
    },
    track: true,
    fotos: {
      contexto: {
        cantidad_por_unidad: 6,
        cardinales: true,
        reutiliza_metodo: null,
        texto: '6 por recorrido',
      },
      metodologicas: { minimo: 2, texto: '2 por estación/método' },
    },
    validaciones: [
      val.cantidad(4, 8, {
        por_region: { COSTA: 8, SIERRA: 8, SELVA: 4 },
        za_ef_por_region: { COSTA: 16, SIERRA: 16, SELVA: 8 },
      }),
      val.separacion(50, 'advertencia'),
      val.geometria(),
      val.track(),
      val.fotosContexto(6),
      val.fotosMetodologicas(2),
    ],
  });
  const recorrido = (desdeEsteM: number) =>
    unidad({
      tipo: 'recorrido',
      geometria: {
        tipo: 'inicio_fin',
        inicio: mover(ORIGEN, 0, desdeEsteM),
        fin: mover(ORIGEN, 100, desdeEsteM),
      },
      track: { puntos: 40 },
      fotos: fotos(6),
    });

  it('D01 VES: separación < 50 m es advertencia, no hace parcial la ejecución (CA-03, QA-14)', () => {
    const e = evaluarEjecucion({
      metodo: ves,
      estacion: ESTACION_SELVA,
      ejecucion: ejecucion({
        unidades: [recorrido(0), recorrido(30), recorrido(200), recorrido(400)],
      }),
    });
    expect(e.incumplimientos_obligatorios).toBe(0);
    expect(e.advertencias).toBe(1);
    const sep = de(e.resultados, 'separacion_minima_m')[0];
    expect(sep).toMatchObject({
      estado: 'incumple',
      tipo_control: 'advertencia',
      esperado: 50,
      obtenido: 30,
    });
    expect(sep?.mensaje).toContain('30 m');
    expect(resultadosDestacados(e).map((r) => r.tipo_control)).toEqual(['advertencia']);
  });

  it('D01 VES: en SELVA bastan 4 recorridos; con 3 falta uno (obligatorio)', () => {
    const e = evaluarEjecucion({
      metodo: ves,
      estacion: ESTACION_SELVA,
      ejecucion: ejecucion({ unidades: [recorrido(0), recorrido(200), recorrido(400)] }),
    });
    expect(e.incumplimientos_obligatorios).toBe(1);
    expect(de(e.resultados, 'cantidad_unidades')[0]).toMatchObject({
      estado: 'incumple',
      esperado: 4,
      obtenido: 3,
    });
    expect(e.avance).toEqual({ ejecutado: 3, objetivo: 4, porcentaje: 75 });
  });

  it('D01 redes de neblina: 10 redes con 1 foto por red es obligatorio (CA-03, QA-12)', () => {
    const redes = metodoBase({
      codigo: 'mamiferos_menores_voladores.redes_neblina',
      unidad: { tipo: 'red', tipos_adicionales: ['transecto'], texto: null },
      geometria: {
        tipo: 'punto_opcional',
        texto: 'Transecto inicio + fin; red opcional',
        vinculo_metodo: null,
        por_tipo: { transecto: 'inicio_fin' },
        detalle: null,
      },
      fotos: {
        contexto: {
          cantidad_por_unidad: 1,
          cardinales: false,
          reutiliza_metodo: null,
          texto: '1 por red',
        },
        metodologicas: { minimo: 2, texto: '2' },
      },
      validaciones: [
        val.cantidad(10, 10),
        val.fotosContexto(1),
        val.separacion(20, 'advertencia'),
        val.fotosMetodologicas(2),
      ],
    });
    const red = (conFoto: boolean, i: number) =>
      unidad({
        tipo: 'red',
        geometria: { tipo: 'punto', punto: mover(ORIGEN, 0, i * 25) },
        fotos: conFoto ? fotos(1) : [],
      });
    const completas = Array.from({ length: 10 }, (_, i) => red(true, i));
    expect(
      evaluarEjecucion({
        metodo: redes,
        estacion: ESTACION_SELVA,
        ejecucion: ejecucion({ unidades: completas }),
      }).incumplimientos_obligatorios,
    ).toBe(0);

    const unaSinFoto = [...completas.slice(0, 9), red(false, 9)];
    const e = evaluarEjecucion({
      metodo: redes,
      estacion: ESTACION_SELVA,
      ejecucion: ejecucion({ unidades: unaSinFoto }),
    });
    expect(e.incumplimientos_obligatorios).toBe(1);
    expect(de(e.resultados, 'fotos_contexto')[0]).toMatchObject({
      estado: 'incumple',
      unidad_id: unaSinFoto[9]?.id,
      esperado: 1,
      obtenido: 0,
    });
  });

  it('D01 bofedales: el esfuerzo por superficie es referencia; 9 cuadrantes con referencia 6 no bloquean (QA-11, CA-21)', () => {
    const biomasa = metodoBase({
      codigo: 'bofedales.biomasa',
      unidad: { tipo: 'cuadrante', tipos_adicionales: [], texto: null },
      validaciones: [val.referencia('criterio_humano'), val.fotosMetodologicas(2)],
    });
    const e = evaluarEjecucion({
      metodo: biomasa,
      estacion: ESTACION_ZA_EF,
      ejecucion: ejecucion({ objetivo_campo: 9, unidades: puntos(9, 5, { tipo: 'cuadrante' }) }),
    });
    expect(e.incumplimientos_obligatorios).toBe(0);
    expect(estados(e.resultados, 'referencia_esfuerzo')).toEqual(['informativo']);
    expect(e.objetivo).toMatchObject({ cantidad: 9, origen: 'campo' });
    expect(e.avance.porcentaje).toBe(100);
  });

  it('D01 Tomahawk: la instalación elevada es un mensaje informativo, nunca incumplimiento (QA-17)', () => {
    const tomahawk = metodoBase({
      codigo: 'mamiferos_menores_terrestres.tomahawk',
      unidad: { tipo: 'trampa', tipos_adicionales: [], texto: null },
      geometria: {
        tipo: 'vinculada',
        texto: 'Mismo transecto Sherman',
        vinculo_metodo: 'mamiferos_menores_terrestres.sherman',
        detalle: null,
      },
      validaciones: [
        val.mensaje('Puede instalarse elevada en coberturas arbóreas'),
        val.fotosMetodologicas(2),
      ],
    });
    const e = evaluarEjecucion({
      metodo: tomahawk,
      estacion: ESTACION_SELVA,
      ejecucion: ejecucion({ unidades: puntos(10, 10, { tipo: 'trampa' }) }),
    });
    expect(de(e.resultados, 'mensaje')[0]).toMatchObject({
      estado: 'informativo',
      tipo_control: 'informativo',
    });
    expect(e.incumplimientos_obligatorios).toBe(0);
  });
});

describe('RN-32 regla ZA/EF solo donde D01 la define (E-03, CA-E03)', () => {
  const camaras = metodoBase({
    codigo: 'mamiferos_mayores.camaras_trampa',
    unidad: { tipo: 'camara', tipos_adicionales: [], texto: null },
    esfuerzo: {
      estandar: {
        cantidad: 6,
        unidad: 'cámaras durante 72 horas',
        texto: '6 cámaras durante 72 horas como esfuerzo base.',
      },
      za_ef: {
        cantidad: 6,
        texto: 'En ZA/EF, mínimo 6 cámaras; con exactamente 6, confirmar 144 h.',
      },
    },
    validaciones: [
      val.cantidad(6, 6),
      val.confirmacion(6, 'Las 6 cámaras permanecerán 6 días (144 h)'),
      val.referencia('referencia'),
      val.geometria(),
      val.fotosMetodologicas(2),
    ],
  });
  const camarasN = (n: number) => puntos(n, 300, { tipo: 'camara' });

  it('D01 cámaras trampa: con 5 alerta; con 6 en ZA/EF exige confirmar 144 h; con 7 continúa sin bloqueo (CA-21, QA-13)', () => {
    const cinco = evaluarEjecucion({
      metodo: camaras,
      estacion: ESTACION_ZA_EF,
      ejecucion: ejecucion({ unidades: camarasN(5) }),
    });
    expect(de(cinco.resultados, 'cantidad_unidades')[0]).toMatchObject({
      estado: 'incumple',
      esperado: 6,
      obtenido: 5,
    });
    expect(estados(cinco.resultados, 'confirmacion')).toEqual(['no_aplica']);

    const seisSinConfirmar = evaluarEjecucion({
      metodo: camaras,
      estacion: ESTACION_ZA_EF,
      ejecucion: ejecucion({ unidades: camarasN(6) }),
    });
    expect(de(seisSinConfirmar.resultados, 'confirmacion')[0]).toMatchObject({
      estado: 'incumple',
      tipo_control: 'obligatorio',
    });
    expect(seisSinConfirmar.incumplimientos_obligatorios).toBe(1);

    const seisConfirmadas = evaluarEjecucion({
      metodo: camaras,
      estacion: ESTACION_ZA_EF,
      ejecucion: ejecucion({ unidades: camarasN(6), confirmaciones: ['za_ef_cantidad_exacta'] }),
    });
    expect(estados(seisConfirmadas.resultados, 'confirmacion')).toEqual(['cumple']);
    expect(seisConfirmadas.incumplimientos_obligatorios).toBe(0);

    const siete = evaluarEjecucion({
      metodo: camaras,
      estacion: ESTACION_ZA_EF,
      ejecucion: ejecucion({ unidades: camarasN(7) }),
    });
    expect(siete.incumplimientos_obligatorios).toBe(0);
    expect(de(siete.resultados, 'confirmacion')[0]?.mensaje).toContain('más de 6');
    expect(estados(siete.resultados, 'referencia_esfuerzo')).toEqual(['informativo']);
  });

  it('D01 cámaras trampa: fuera de ZA/EF, 6 cámaras no piden confirmación', () => {
    const e = evaluarEjecucion({
      metodo: camaras,
      estacion: ESTACION_COSTA,
      ejecucion: ejecucion({ unidades: camarasN(6) }),
    });
    expect(de(e.resultados, 'confirmacion')[0]).toMatchObject({ estado: 'no_aplica' });
    expect(e.incumplimientos_obligatorios).toBe(0);
  });

  it('D01 puntos de intercepción: en ZA/EF el objetivo pasa de 3 a 6 transectos', () => {
    const m = metodoBase({
      unidad: { tipo: 'transecto', tipos_adicionales: [], texto: null },
      validaciones: [val.cantidad(3, 6)],
    });
    const tres = puntos(3, 150, { tipo: 'transecto' });
    expect(
      evaluarEjecucion({
        metodo: m,
        estacion: ESTACION_COSTA,
        ejecucion: ejecucion({ unidades: tres }),
      }).incumplimientos_obligatorios,
    ).toBe(0);
    const zaEf = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_ZA_EF,
      ejecucion: ejecucion({ unidades: tres }),
    });
    expect(zaEf.objetivo).toMatchObject({ cantidad: 6, origen: 'd01_za_ef' });
    expect(de(zaEf.resultados, 'cantidad_unidades')[0]?.mensaje).toContain('ZA/EF');
    expect(zaEf.incumplimientos_obligatorios).toBe(1);
  });

  it('D01 VES: la cantidad por región prevalece (COSTA 8, SELVA 4) y en ZA/EF se duplica (16, 8)', () => {
    const m = metodoBase({
      unidad: { tipo: 'recorrido', tipos_adicionales: [], texto: null },
      validaciones: [
        val.cantidad(4, 8, {
          por_region: { COSTA: 8, SIERRA: 8, SELVA: 4 },
          za_ef_por_region: { COSTA: 16, SIERRA: 16, SELVA: 8 },
        }),
      ],
    });
    const ej = ejecucion({ unidades: [] });
    expect(
      evaluarEjecucion({ metodo: m, estacion: ESTACION_COSTA, ejecucion: ej }).objetivo,
    ).toMatchObject({ cantidad: 8, origen: 'd01_region' });
    expect(
      evaluarEjecucion({ metodo: m, estacion: ESTACION_SELVA, ejecucion: ej }).objetivo,
    ).toMatchObject({ cantidad: 4, origen: 'd01_region' });
    expect(
      evaluarEjecucion({ metodo: m, estacion: { ...ESTACION_SELVA, za_ef: 'EF' }, ejecucion: ej })
        .objetivo,
    ).toMatchObject({ cantidad: 8, origen: 'd01_za_ef_region' });
    expect(
      evaluarEjecucion({ metodo: m, estacion: ESTACION_ZA_EF, ejecucion: ej }).objetivo,
    ).toMatchObject({ cantidad: 16, origen: 'd01_za_ef_region' });
  });

  it('D01 VES: sin región conocida se aplica el mínimo general y el mensaje lo dice (P-01)', () => {
    const m = metodoBase({
      unidad: { tipo: 'recorrido', tipos_adicionales: [], texto: null },
      validaciones: [val.cantidad(4, 8, { por_region: { COSTA: 8, SIERRA: 8, SELVA: 4 } })],
    });
    const e = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_SIN_REGION,
      ejecucion: ejecucion({ unidades: puntos(2, 100, { tipo: 'recorrido' }) }),
    });
    expect(e.objetivo).toMatchObject({ cantidad: 4, origen: 'd01' });
    expect(de(e.resultados, 'cantidad_unidades')[0]?.mensaje).toContain('Región no determinada');
  });

  it('D01 conteo total: 30 min por sector y 60 min en ZA/EF', () => {
    const m = metodoBase({
      unidad: { tipo: 'sector', tipos_adicionales: [], texto: null },
      validaciones: [val.duracion(30, 60)],
    });
    const sector = unidad({
      tipo: 'sector',
      inicio: lima('2026-12-05', '08:00'),
      fin: lima('2026-12-05', '08:45'),
    });
    expect(
      evaluarEjecucion({
        metodo: m,
        estacion: ESTACION_SELVA,
        ejecucion: ejecucion({ unidades: [sector] }),
      }).incumplimientos_obligatorios,
    ).toBe(0);
    const zaEf = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_ZA_EF,
      ejecucion: ejecucion({ unidades: [sector] }),
    });
    expect(de(zaEf.resultados, 'duracion_unidad_min')[0]).toMatchObject({
      estado: 'incumple',
      esperado: 60,
      obtenido: 45,
    });
  });

  it('D01 ABS: ZA/EF no cambia la regla porque D01 no define duplicación (minimo_za_ef nulo)', () => {
    const m = metodoBase({
      unidad: { tipo: 'abs', tipos_adicionales: [], texto: null },
      validaciones: [val.cantidad(2, null)],
    });
    expect(
      evaluarEjecucion({ metodo: m, estacion: ESTACION_ZA_EF, ejecucion: ejecucion() }).objetivo,
    ).toMatchObject({ cantidad: 2, origen: 'd01' });
  });
});

describe('RN-30 geometría exacta por método (E-04, CA-E04)', () => {
  it('D01 parcelas de arbustos 5 × 5 m: 4 vértices; con 3 incumple y con fotos no se sustituye (F-01)', () => {
    const m = metodoBase({
      unidad: { tipo: 'parcela', tipos_adicionales: [], texto: null },
      geometria: {
        tipo: 'vertices',
        texto: 'Vértices de la parcela 5 × 5 m',
        vinculo_metodo: null,
        detalle: { vertices_minimos: 4 },
      },
      validaciones: [val.geometria()],
    });
    const v = (n: number) =>
      Array.from({ length: n }, (_, i) => mover(ORIGEN, i < 2 ? 0 : 5, i % 2 === 0 ? 0 : 5));
    const ok = unidad({ tipo: 'parcela', geometria: { tipo: 'vertices', vertices: v(4) } });
    const tres = unidad({ tipo: 'parcela', geometria: { tipo: 'vertices', vertices: v(3) } });
    const soloFotos = unidad({ tipo: 'parcela', geometria: null, fotos: fotos(8) });
    const e = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_COSTA,
      ejecucion: ejecucion({ unidades: [ok, tres, soloFotos] }),
    });
    expect(de(e.resultados, 'geometria').map((r) => [r.unidad_id, r.estado])).toEqual([
      [tres.id, 'incumple'],
      [soloFotos.id, 'incumple'],
    ]);
    expect(de(e.resultados, 'geometria')[0]?.mensaje).toContain('3 de 4');
  });

  it('D01 parcela forestal: principal 250 × 20 m + 5 latizales + 5 brinzales; con 4 brinzales incumple', () => {
    const m = metodoBase({
      unidad: { tipo: 'parcela', tipos_adicionales: [], texto: null },
      geometria: {
        tipo: 'parcela_forestal',
        texto: 'Principal y subparcelas',
        vinculo_metodo: null,
        detalle: {
          vertices_minimos: 4,
          subparcelas: [
            { tipo: 'latizales', cantidad: 5, dimensiones: '10 × 10 m' },
            { tipo: 'brinzales', cantidad: 5, dimensiones: '5 × 5 m' },
          ],
        },
      },
      validaciones: [val.geometria()],
    });
    const cuadro = (lado: number, i: number) => [
      mover(ORIGEN, i * 20, 0),
      mover(ORIGEN, i * 20, lado),
      mover(ORIGEN, i * 20 + lado, lado),
      mover(ORIGEN, i * 20 + lado, 0),
    ];
    const sub = (tipo: string, n: number, lado: number) =>
      Array.from({ length: n }, (_, i) => ({ tipo, vertices: cuadro(lado, i) }));
    const completa = unidad({
      tipo: 'parcela',
      geometria: {
        tipo: 'parcela_forestal',
        principal: cuadro(250, 0),
        subparcelas: [...sub('latizales', 5, 10), ...sub('brinzales', 5, 5)],
      },
    });
    const incompleta = unidad({
      tipo: 'parcela',
      geometria: {
        tipo: 'parcela_forestal',
        principal: cuadro(250, 0),
        subparcelas: [...sub('latizales', 5, 10), ...sub('brinzales', 4, 5)],
      },
    });
    expect(
      evaluarEjecucion({
        metodo: m,
        estacion: ESTACION_SELVA,
        ejecucion: ejecucion({ unidades: [completa] }),
      }).incumplimientos_obligatorios,
    ).toBe(0);
    const e = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_SELVA,
      ejecucion: ejecucion({ unidades: [incompleta] }),
    });
    expect(de(e.resultados, 'geometria')[0]?.mensaje).toContain('subparcelas');
  });

  it('D01 cámaras trampa: punto por cámara; una línea no vale', () => {
    const m = metodoBase({
      unidad: { tipo: 'camara', tipos_adicionales: [], texto: null },
      validaciones: [val.geometria()],
    });
    const linea = unidad({
      tipo: 'camara',
      geometria: { tipo: 'inicio_fin', inicio: ORIGEN, fin: mover(ORIGEN, 10, 0) },
    });
    const e = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_SELVA,
      ejecucion: ejecucion({ unidades: [linea] }),
    });
    expect(de(e.resultados, 'geometria')[0]).toMatchObject({
      estado: 'incumple',
      esperado: 'punto',
      obtenido: 'inicio_fin',
    });
  });

  it('D01 pitfall: la trampa lleva punto opcional y el transecto exige inicio + fin', () => {
    const m = metodoBase({
      unidad: { tipo: 'trampa', tipos_adicionales: ['transecto'], texto: null },
      geometria: {
        tipo: 'punto_opcional',
        texto: 'Transecto inicio + fin; trampa opcional',
        vinculo_metodo: null,
        por_tipo: { transecto: 'inicio_fin' },
        detalle: null,
      },
      validaciones: [val.geometria()],
    });
    const trampaSinPunto = unidad({ tipo: 'trampa', geometria: null });
    const transectoSinFin = unidad({
      tipo: 'transecto',
      geometria: { tipo: 'punto', punto: ORIGEN },
    });
    const e = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_SELVA,
      ejecucion: ejecucion({ unidades: [trampaSinPunto, transectoSinFin] }),
    });
    expect(de(e.resultados, 'geometria').map((r) => r.unidad_id)).toEqual([transectoSinFin.id]);
  });
});

describe('RN-24 track solo donde D01 lo marca «Sí» (CA-10)', () => {
  it('D01 VES: un recorrido cerrado sin track incumple; con ≥ 2 puntos cumple', () => {
    const m = metodoBase({
      unidad: { tipo: 'recorrido', tipos_adicionales: [], texto: null },
      geometria: {
        tipo: 'inicio_fin',
        texto: 'Inicio + fin; track',
        vinculo_metodo: null,
        detalle: null,
      },
      track: true,
      validaciones: [val.track()],
    });
    const geo = { tipo: 'inicio_fin', inicio: ORIGEN, fin: mover(ORIGEN, 100, 0) } as const;
    const sin = unidad({ tipo: 'recorrido', geometria: geo, track: null });
    const con = unidad({ tipo: 'recorrido', geometria: geo, track: { puntos: 25 } });
    const abierta = unidad({ tipo: 'recorrido', geometria: geo, track: null, estado: 'abierta' });
    const e = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_SELVA,
      ejecucion: ejecucion({ unidades: [sin, con, abierta] }),
    });
    expect(de(e.resultados, 'track').map((r) => [r.unidad_id, r.estado])).toEqual([
      [sin.id, 'incumple'],
    ]);
  });

  it('D01 ABS: el track va en el recorrido de búsqueda, no en cada ABS (E-05, CA-E05)', () => {
    const abs = metodoBase({
      unidad: { tipo: 'abs', tipos_adicionales: ['recorrido'], texto: null },
      geometria: {
        tipo: 'punto',
        texto: 'Track del recorrido + coordenada por ABS',
        vinculo_metodo: null,
        por_tipo: { recorrido: 'inicio_fin' },
        detalle: null,
      },
      track: true,
      fotos: {
        contexto: {
          cantidad_por_unidad: 2,
          cardinales: false,
          reutiliza_metodo: null,
          texto: '2 por ABS',
        },
        metodologicas: { minimo: 2, texto: '2' },
      },
      validaciones: [val.track(), val.geometria(), val.fotosContexto(2)],
    });
    expect(tiposConTrack(abs)).toEqual(['recorrido']);
    const sitio = unidad({ tipo: 'abs', fotos: fotos(2) });
    const recorrido = unidad({
      tipo: 'recorrido',
      geometria: { tipo: 'inicio_fin', inicio: ORIGEN, fin: mover(ORIGEN, 500, 0) },
      track: { puntos: 120 },
    });
    const e = evaluarEjecucion({
      metodo: abs,
      estacion: ESTACION_SELVA,
      ejecucion: ejecucion({ unidades: [sitio, recorrido] }),
    });
    expect(estados(e.resultados, 'track')).toEqual(['cumple']);
    expect(estados(e.resultados, 'geometria')).toEqual(['cumple']);
    expect(estados(e.resultados, 'fotos_contexto')).toEqual(['cumple']);
  });

  it('un método sin track en D01 no lo evalúa (puntos de conteo)', () => {
    const m = metodoBase({ validaciones: [val.geometria()] });
    expect(tiposConTrack(m)).toEqual([]);
    const e = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_COSTA,
      ejecucion: ejecucion({ unidades: puntos(1, 0) }),
    });
    expect(de(e.resultados, 'track')).toEqual([]);
  });
});

describe('RN-41 horarios y duraciones de D01', () => {
  it('D01 puntos de conteo 06:00–10:00 y 10 min: inicio 05:50 (Lima) incumple; 06:10 cumple; 7 min incumple', () => {
    const m = metodoBase({
      horario: { ventanas: [{ inicio: '06:00', fin: '10:00' }], texto: '06:00–10:00' },
      validaciones: [val.horario([{ inicio: '06:00', fin: '10:00' }]), val.duracion(10)],
    });
    const temprano = unidad({
      inicio: lima('2026-12-05', '05:50'),
      fin: lima('2026-12-05', '06:00'),
    });
    const ok = unidad({ inicio: lima('2026-12-05', '06:10'), fin: lima('2026-12-05', '06:20') });
    const corto = unidad({ inicio: lima('2026-12-05', '07:00'), fin: lima('2026-12-05', '07:07') });
    const e = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_COSTA,
      ejecucion: ejecucion({ unidades: [temprano, ok, corto] }),
    });
    expect(de(e.resultados, 'horario').map((r) => [r.unidad_id, r.obtenido])).toEqual([
      [temprano.id, '05:50'],
    ]);
    expect(de(e.resultados, 'duracion_unidad_min').map((r) => [r.unidad_id, r.obtenido])).toEqual([
      [corto.id, 7],
    ]);
    expect(e.incumplimientos_obligatorios).toBe(2);
  });

  it('D01 detector acústico 18:00–06:00 cruza la medianoche: 23:30 y 02:00 cumplen; 12:00 incumple', () => {
    const m = metodoBase({
      unidad: { tipo: 'detector', tipos_adicionales: [], texto: null },
      validaciones: [val.horario([{ inicio: '18:00', fin: '06:00' }])],
    });
    const noche = unidad({
      tipo: 'detector',
      inicio: lima('2026-12-05', '23:30'),
      fin: lima('2026-12-06', '02:00'),
    });
    const dia = unidad({ tipo: 'detector', inicio: lima('2026-12-05', '12:00'), fin: null });
    const e = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_SELVA,
      ejecucion: ejecucion({ unidades: [noche, dia] }),
    });
    expect(de(e.resultados, 'horario').map((r) => r.unidad_id)).toEqual([dia.id]);
  });

  it('D01 redes de neblina 17:30–00:00: 23:59 cumple y 00:30 incumple', () => {
    const m = metodoBase({
      unidad: { tipo: 'red', tipos_adicionales: [], texto: null },
      validaciones: [val.horario([{ inicio: '17:30', fin: '00:00' }])],
    });
    const ok = unidad({ tipo: 'red', inicio: lima('2026-12-05', '23:59') });
    const tarde = unidad({ tipo: 'red', inicio: lima('2026-12-06', '00:30') });
    const e = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_SELVA,
      ejecucion: ejecucion({ unidades: [ok, tarde] }),
    });
    expect(de(e.resultados, 'horario').map((r) => r.unidad_id)).toEqual([tarde.id]);
  });

  it('la zona horaria del proyecto es configurable: la misma hora UTC cambia de resultado', () => {
    const m = metodoBase({ validaciones: [val.horario([{ inicio: '06:00', fin: '10:00' }])] });
    const u = unidad({ inicio: '2026-12-05T08:00:00Z' }); // 08:00 UTC = 03:00 Lima
    expect(
      estados(
        evaluarEjecucion({
          metodo: m,
          estacion: ESTACION_COSTA,
          ejecucion: ejecucion({ unidades: [u] }),
        }).resultados,
        'horario',
      ),
    ).toEqual(['incumple']);
    expect(
      estados(
        evaluarEjecucion({
          metodo: m,
          estacion: ESTACION_COSTA,
          ejecucion: ejecucion({ unidades: [u] }),
          zona_horaria: 'UTC',
        }).resultados,
        'horario',
      ),
    ).toEqual(['cumple']);
  });

  it('una unidad cerrada sin horas incumple la duración; una abierta no se evalúa', () => {
    const m = metodoBase({ validaciones: [val.duracion(10)] });
    const cerrada = unidad({ inicio: null, fin: null });
    const abierta = unidad({ inicio: lima('2026-12-05', '07:00'), fin: null, estado: 'abierta' });
    const e = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_COSTA,
      ejecucion: ejecucion({ unidades: [cerrada, abierta] }),
    });
    expect(de(e.resultados, 'duracion_unidad_min').map((r) => [r.unidad_id, r.estado])).toEqual([
      [cerrada.id, 'incumple'],
    ]);
    const soloAbierta = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_COSTA,
      ejecucion: ejecucion({ unidades: [abierta] }),
    });
    expect(estados(soloAbierta.resultados, 'duracion_unidad_min')).toEqual(['no_evaluable']);
  });
});

describe('RN-04 fotos por método, no foto universal (F-06, F-07)', () => {
  it('D01 puntos de conteo: 4 panorámicas por punto y ≥ 2 metodológicas por método', () => {
    const m = metodoBase({
      fotos: {
        contexto: {
          cantidad_por_unidad: 4,
          cardinales: true,
          reutiliza_metodo: null,
          texto: '4 N-S-E-O',
        },
        metodologicas: { minimo: 2, texto: '2' },
      },
      validaciones: [val.fotosContexto(4), val.fotosMetodologicas(2)],
    });
    const completo = unidad({ fotos: fotos(4) });
    const faltante = unidad({ fotos: fotos(3) });
    const e = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_COSTA,
      ejecucion: ejecucion({ fotos: [foto('metodologica')], unidades: [completo, faltante] }),
    });
    expect(de(e.resultados, 'fotos_contexto').map((r) => [r.unidad_id, r.obtenido])).toEqual([
      [faltante.id, 3],
    ]);
    expect(de(e.resultados, 'fotos_metodologicas')[0]).toMatchObject({
      estado: 'incumple',
      esperado: 2,
      obtenido: 1,
    });
    expect(e.incumplimientos_obligatorios).toBe(2);
  });

  it('D01 cuadrantes de herbáceas: las fotos de contexto heredadas del transecto cuentan; las metodológicas heredadas no', () => {
    const m = metodoBase({
      unidad: { tipo: 'cuadrante', tipos_adicionales: [], texto: null },
      fotos: {
        contexto: {
          cantidad_por_unidad: 1,
          cardinales: false,
          reutiliza_metodo: 'flora_vegetacion.puntos_intercepcion',
          texto: '1',
        },
        metodologicas: { minimo: 2, texto: '2' },
      },
      validaciones: [val.fotosContexto(1), val.fotosMetodologicas(2)],
    });
    const u = unidad({
      tipo: 'cuadrante',
      fotos: [foto('contexto', true), foto('metodologica', true), foto('metodologica', true)],
    });
    const e = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_COSTA,
      ejecucion: ejecucion({ fotos: [], unidades: [u] }),
    });
    expect(estados(e.resultados, 'fotos_contexto')).toEqual(['cumple']);
    expect(de(e.resultados, 'fotos_metodologicas')[0]).toMatchObject({
      estado: 'incumple',
      obtenido: 0,
    });
  });

  it('sin reutilización declarada, una foto heredada no cuenta como contexto', () => {
    const m = metodoBase({
      fotos: {
        contexto: { cantidad_por_unidad: 1, cardinales: false, reutiliza_metodo: null, texto: '1' },
        metodologicas: { minimo: 0, texto: '' },
      },
      validaciones: [val.fotosContexto(1)],
    });
    const e = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_COSTA,
      ejecucion: ejecucion({ unidades: [unidad({ fotos: [foto('contexto', true)] })] }),
    });
    expect(estados(e.resultados, 'fotos_contexto')).toEqual(['incumple']);
  });

  it('D01 pitfall: las 8 fotos de contexto son del transecto, no de cada trampa', () => {
    const m = metodoBase({
      unidad: { tipo: 'trampa', tipos_adicionales: ['transecto'], texto: null },
      fotos: {
        contexto: {
          cantidad_por_unidad: null,
          por_tipo: { transecto: 8 },
          cardinales: true,
          reutiliza_metodo: null,
          texto: '8 por transecto',
        },
        metodologicas: { minimo: 2, texto: '2' },
      },
      validaciones: [val.fotosContexto(8)],
    });
    const trampas = puntos(9, 10, { tipo: 'trampa' });
    const transecto = unidad({ tipo: 'transecto', fotos: fotos(5) });
    const e = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_SELVA,
      ejecucion: ejecucion({ unidades: [...trampas, transecto] }),
    });
    expect(de(e.resultados, 'fotos_contexto').map((r) => [r.unidad_id, r.obtenido])).toEqual([
      [transecto.id, 5],
    ]);
  });
});

describe('RN-34 vínculos entre métodos (CA-22)', () => {
  it('D01 Tomahawk: cada trampa se vincula a una unidad Sherman; otra cosa incumple', () => {
    const m = metodoBase({
      unidad: { tipo: 'trampa', tipos_adicionales: [], texto: null },
      validaciones: [val.vinculo('mamiferos_menores_terrestres.sherman')],
    });
    const bien = unidad({ tipo: 'trampa', unidad_vinculada_id: 'sherman-t1' });
    const mal = unidad({ tipo: 'trampa', unidad_vinculada_id: 'pitfall-t1' });
    const sin = unidad({ tipo: 'trampa', unidad_vinculada_id: null });
    const e = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_SELVA,
      ejecucion: ejecucion({ unidades: [bien, mal, sin] }),
      unidades_vinculables: [
        { id: 'sherman-t1', metodo: 'mamiferos_menores_terrestres.sherman' },
        { id: 'pitfall-t1', metodo: 'artropodos.pitfall_sin_cebo' },
      ],
    });
    expect(de(e.resultados, 'vinculo_unidad').map((r) => r.unidad_id)).toEqual([mal.id, sin.id]);
  });

  it('D01 pan traps: por defecto al trazado de pitfall sin cebo; trazado independiente justificado y georreferenciado cumple (F-10)', () => {
    const m = metodoBase({
      unidad: { tipo: 'bandeja', tipos_adicionales: [], texto: null },
      validaciones: [val.vinculo('artropodos.pitfall_sin_cebo', 'trazado_independiente')],
    });
    const justificada = unidad({
      tipo: 'bandeja',
      datos: { trazado_independiente: 'Mayor exposición a la luz en el claro' },
    });
    const sinGeometria = unidad({
      tipo: 'bandeja',
      geometria: null,
      datos: { trazado_independiente: 'Luz' },
    });
    const sinJustificar = unidad({ tipo: 'bandeja', datos: {} });
    const e = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_SELVA,
      ejecucion: ejecucion({ unidades: [justificada, sinGeometria, sinJustificar] }),
    });
    expect(de(e.resultados, 'vinculo_unidad').map((r) => r.unidad_id)).toEqual([
      sinGeometria.id,
      sinJustificar.id,
    ]);
  });

  it('sin lista de unidades vinculables, basta el vínculo declarado', () => {
    const m = metodoBase({
      unidad: { tipo: 'trampa', tipos_adicionales: [], texto: null },
      validaciones: [val.vinculo('mamiferos_menores_terrestres.sherman')],
    });
    const e = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_SELVA,
      ejecucion: ejecucion({ unidades: [unidad({ tipo: 'trampa', unidad_vinculada_id: 'x' })] }),
    });
    expect(estados(e.resultados, 'vinculo_unidad')).toEqual(['cumple']);
  });
});

describe('RN-33 ABS: 2 h de búsqueda, reducible a 1 h solo con sustento (T-01, E-05)', () => {
  const abs = metodoBase({
    unidad: { tipo: 'abs', tipos_adicionales: ['recorrido'], texto: null },
    campos_ejecucion: [
      campo('grupo_fauna'),
      campo('tiempo_efectivo_min', true, 'entero'),
      campo('sectores_cubiertos', false),
      campo('sustento_reduccion', false),
    ],
    validaciones: [val.tiempoEfectivo()],
  });
  const sitio = unidad({ tipo: 'abs' });
  const con = (datos: Record<string, unknown>, unidades = [sitio], cerrada = true) =>
    evaluarEjecucion({
      metodo: abs,
      estacion: ESTACION_SELVA,
      ejecucion: ejecucion({
        datos,
        unidades,
        cerrada_en: cerrada ? lima('2026-12-05', '12:00') : null,
      }),
    });

  it('120 min cumple y el avance es minutos / 120', () => {
    const e = con({ tiempo_efectivo_min: 125 });
    expect(estados(e.resultados, 'tiempo_efectivo')).toEqual(['cumple']);
    expect(e.objetivo).toMatchObject({ cantidad: 120, medida: 'minutos' });
    expect(e.avance).toEqual({ ejecutado: 125, objetivo: 120, porcentaje: 104.2 });
  });

  it('60 min con sectores cubiertos, sustento y ABS identificadas cumple', () => {
    const e = con({
      tiempo_efectivo_min: 60,
      sectores_cubiertos: 'Quebrada, ladera y bosque ribereño',
      sustento_reduccion: 'Dos bebederos y un dormidero',
    });
    expect(de(e.resultados, 'tiempo_efectivo')[0]).toMatchObject({
      estado: 'cumple',
      esperado: 60,
      obtenido: 60,
    });
  });

  it('60 min sin sustento, o sin ninguna ABS, incumple (un sitio aislado no basta)', () => {
    expect(
      de(
        con({ tiempo_efectivo_min: 60, sectores_cubiertos: 'Quebrada' }).resultados,
        'tiempo_efectivo',
      )[0]?.mensaje,
    ).toContain('sin sustento_reduccion');
    expect(
      de(
        con({ tiempo_efectivo_min: 60, sectores_cubiertos: 'Q', sustento_reduccion: 'S' }, [])
          .resultados,
        'tiempo_efectivo',
      )[0]?.mensaje,
    ).toContain('ninguna ABS identificada');
  });

  it('45 min incumple aunque haya sustento; sin tiempo registrado: incumple si está cerrada, no evaluable si sigue abierta', () => {
    expect(
      estados(
        con({ tiempo_efectivo_min: 45, sectores_cubiertos: 'Q', sustento_reduccion: 'S' })
          .resultados,
        'tiempo_efectivo',
      ),
    ).toEqual(['incumple']);
    expect(estados(con({}).resultados, 'tiempo_efectivo')).toEqual(['incumple']);
    expect(estados(con({}, [sitio], false).resultados, 'tiempo_efectivo')).toEqual([
      'no_evaluable',
    ]);
    expect(con({ tiempo_efectivo_min: '90' }).avance.ejecutado).toBe(90);
  });
});

describe('registros por unidad y campos obligatorios de D01', () => {
  it('D01 listas de 20: 20 especies o motivo de lista incompleta', () => {
    const m = metodoBase({
      unidad: { tipo: 'lista', tipos_adicionales: [], texto: null },
      campos: [campo('habitat_predominante'), campo('motivo_lista_incompleta', false)],
      registros: {
        etiqueta: 'Especies (20)',
        campos: [campo('especie'), campo('n_individuos', true, 'entero')],
      },
      validaciones: [val.registros(20, 'motivo_lista_incompleta'), val.campos()],
    });
    const especies = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ especie: `sp${String(i)}`, n_individuos: 1 }));
    const completa = unidad({
      tipo: 'lista',
      registros: especies(20),
      datos: { habitat_predominante: 'Bosque' },
    });
    const conMotivo = unidad({
      tipo: 'lista',
      registros: especies(12),
      datos: {
        habitat_predominante: 'Bosque',
        motivo_lista_incompleta: 'Lluvia intensa a las 09:30',
      },
    });
    const sinMotivo = unidad({
      tipo: 'lista',
      registros: especies(12),
      datos: { habitat_predominante: 'Bosque' },
    });
    const e = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_SELVA,
      ejecucion: ejecucion({ unidades: [completa, conMotivo, sinMotivo] }),
    });
    expect(de(e.resultados, 'cantidad_registros').map((r) => r.unidad_id)).toEqual([sinMotivo.id]);
    expect(de(e.resultados, 'cantidad_registros')[0]?.mensaje).toContain('sin motivo');
    expect(estados(e.resultados, 'campos_obligatorios')).toEqual(['cumple']);
  });

  it('D01 puntos de intercepción: 100 lecturas por transecto', () => {
    const m = metodoBase({
      unidad: { tipo: 'transecto', tipos_adicionales: [], texto: null },
      validaciones: [val.registros(100)],
    });
    const corto = unidad({
      tipo: 'transecto',
      registros: Array.from({ length: 98 }, () => ({ especie: 'x' })),
    });
    const e = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_COSTA,
      ejecucion: ejecucion({ unidades: [corto] }),
    });
    expect(de(e.resultados, 'cantidad_registros')[0]).toMatchObject({
      estado: 'incumple',
      esperado: 100,
      obtenido: 98,
    });
    expect(
      estados(
        evaluarEjecucion({ metodo: m, estacion: ESTACION_COSTA, ejecucion: ejecucion() })
          .resultados,
        'cantidad_registros',
      ),
    ).toEqual(['no_evaluable']);
  });

  it('D01 ABS y parcelas: campos de la ejecución, de la unidad y de cada fila de registro', () => {
    const m = metodoBase({
      unidad: { tipo: 'parcela', tipos_adicionales: [], texto: null },
      campos_ejecucion: [campo('grupo_fauna')],
      campos: [
        campo('habitat'),
        campo('observaciones', false),
        campo('ubicacion', true, 'punto'),
        campo('pendiente', false, 'decimal'),
      ],
      registros: {
        etiqueta: 'Especie',
        campos: [
          campo('especie'),
          campo('n_individuos', true, 'entero'),
          campo('cobertura', false, 'decimal'),
        ],
      },
      validaciones: [val.campos()],
    });
    const u = unidad({
      tipo: 'parcela',
      datos: { habitat: '  ', ubicacion: { lat: -12, lon: -77 }, pendiente: 0 },
      registros: [
        { especie: 'Polylepis', n_individuos: 3 },
        { especie: '', n_individuos: null },
      ],
    });
    const e = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_COSTA,
      ejecucion: ejecucion({ datos: {}, unidades: [u] }),
    });
    const r = de(e.resultados, 'campos_obligatorios');
    expect(r.map((x) => x.unidad_id)).toEqual([null, u.id]);
    expect(r[0]?.mensaje).toContain('grupo fauna');
    expect(r[1]?.mensaje).toContain('habitat');
    expect(r[1]?.mensaje).toContain('Especie 2: especie, n individuos');
    expect(r[1]?.mensaje).not.toContain('Especie 1');

    const completa = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_COSTA,
      ejecucion: ejecucion({
        datos: { grupo_fauna: 'Aves' },
        unidades: [
          unidad({
            tipo: 'parcela',
            datos: { habitat: 'Bosque', ubicacion: { lat: -12, lon: -77 } },
            registros: [{ especie: 'A', n_individuos: 0 }],
          }),
        ],
      }),
    });
    expect(estados(completa.resultados, 'campos_obligatorios')).toEqual(['cumple']);
  });
});

describe('T-12 detector acústico: parámetros técnicos', () => {
  it('D01 registro acústico: los cinco parámetros deben confirmarse en el detector', () => {
    const parametros = ['10–80 kHz', 'WAV', '384 kHz', '1 min cada 5 min', '18:00–06:00'];
    const m = metodoBase({
      unidad: { tipo: 'detector', tipos_adicionales: [], texto: null },
      validaciones: [val.parametros(parametros)],
    });
    const parcial = unidad({ tipo: 'detector', parametros_confirmados: ['WAV', '384 kHz'] });
    const e = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_SELVA,
      ejecucion: ejecucion({ unidades: [parcial] }),
    });
    expect(de(e.resultados, 'parametros_tecnicos')[0]).toMatchObject({
      estado: 'incumple',
      esperado: 5,
      obtenido: 2,
    });
    expect(de(e.resultados, 'parametros_tecnicos')[0]?.mensaje).toContain('10–80 kHz');
    const ok = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_SELVA,
      ejecucion: ejecucion({
        unidades: [unidad({ tipo: 'detector', parametros_confirmados: parametros })],
      }),
    });
    expect(estados(ok.resultados, 'parametros_tecnicos')).toEqual(['cumple']);
  });
});

describe('RF-M11 desviación técnica (E-06, CA-E06)', () => {
  const m = metodoBase({
    unidad: { tipo: 'transecto', tipos_adicionales: [], texto: null },
    validaciones: [val.cantidad(3, 6)],
  });

  it('una desviación declarada sin explicación es incumplimiento; con explicación queda informativa y trazable', () => {
    const sin = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_COSTA,
      ejecucion: ejecucion({
        desviacion: { tipo: 'parcial', explicacion: ' ' },
        unidades: puntos(2, 100, { tipo: 'transecto' }),
      }),
    });
    expect(de(sin.resultados, 'desviacion')[0]).toMatchObject({
      estado: 'incumple',
      tipo_control: 'obligatorio',
    });
    expect(sin.incumplimientos_obligatorios).toBe(2);

    const con = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_COSTA,
      ejecucion: ejecucion({
        desviacion: { tipo: 'parcial', explicacion: 'Crecida del río impidió el tercer transecto' },
        unidades: puntos(2, 100, { tipo: 'transecto' }),
      }),
    });
    expect(de(con.resultados, 'desviacion')[0]).toMatchObject({
      estado: 'informativo',
      obtenido: 'parcial',
    });
    expect(con.incumplimientos_obligatorios).toBe(1); // la ejecución sigue siendo parcial por el transecto faltante
  });

  it('sin desviación declarada no hay resultado de desviación', () => {
    expect(
      de(
        evaluarEjecucion({ metodo: m, estacion: ESTACION_COSTA, ejecucion: ejecucion() })
          .resultados,
        'desviacion',
      ),
    ).toEqual([]);
  });
});

describe('integración con la máquina de la ejecución (RN-05, RF-T04)', () => {
  const m = metodoBase({
    unidad: { tipo: 'transecto', tipos_adicionales: [], texto: null },
    validaciones: [val.cantidad(3, 6), val.separacion(100, 'advertencia')],
  });

  it('evaluar_qa con incumplimientos obligatorios → parcial; solo advertencias → completa', () => {
    const parcial = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_COSTA,
      ejecucion: ejecucion({ unidades: puntos(2, 50, { tipo: 'transecto' }) }),
    });
    expect(parcial.advertencias).toBe(1);
    expect(
      transicionarEjecucion('evidencia_pendiente', {
        tipo: 'evaluar_qa',
        incumplimientosObligatorios: parcial.incumplimientos_obligatorios,
      }),
    ).toEqual({ ok: true, valor: 'parcial' });

    const completa = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_COSTA,
      ejecucion: ejecucion({ unidades: puntos(3, 50, { tipo: 'transecto' }) }),
    });
    expect(completa.advertencias).toBe(1);
    expect(
      transicionarEjecucion('evidencia_pendiente', {
        tipo: 'evaluar_qa',
        incumplimientosObligatorios: completa.incumplimientos_obligatorios,
      }),
    ).toEqual({ ok: true, valor: 'completa' });
  });

  it('un método sin validaciones ni esfuerzo (evento) no genera resultados ni objetivo', () => {
    const evento = metodoBase({
      clase: 'evento',
      unidad: { tipo: 'evento', tipos_adicionales: [], texto: null },
      esfuerzo: { estandar: null, za_ef: null },
    });
    const e = evaluarEjecucion({
      metodo: evento,
      estacion: ESTACION_COSTA,
      ejecucion: ejecucion({ unidades: [unidad({ tipo: 'evento', geometria: null })] }),
    });
    expect(e.resultados).toEqual([]);
    expect(e.objetivo).toMatchObject({ cantidad: null, origen: 'ninguno' });
    expect(e.avance).toEqual({ ejecutado: 1, objetivo: null, porcentaje: null });
  });

  it('resultadosDestacados ordena obligatorios antes que advertencias y omite lo que cumple', () => {
    const e = evaluarEjecucion({
      metodo: m,
      estacion: ESTACION_COSTA,
      ejecucion: ejecucion({ unidades: puntos(2, 50, { tipo: 'transecto' }) }),
    });
    expect(resultadosDestacados(e).map((r) => r.regla)).toEqual([
      'cantidad_unidades',
      'separacion_minima_m',
    ]);
    const inverso = evaluarEjecucion({
      metodo: metodoBase({
        unidad: { tipo: 'transecto', tipos_adicionales: [], texto: null },
        validaciones: [val.separacion(100, 'advertencia'), val.cantidad(3, 6)],
      }),
      estacion: ESTACION_COSTA,
      ejecucion: ejecucion({ unidades: puntos(2, 50, { tipo: 'transecto' }) }),
    });
    expect(resultadosDestacados(inverso).map((r) => r.regla)).toEqual([
      'cantidad_unidades',
      'separacion_minima_m',
    ]);
  });
});
