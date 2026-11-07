import { describe, expect, it } from 'vitest';
import { ESTACION_COSTA, ESTACION_ZA_EF, campo, metodoBase, val } from './_fixtures.ts';
import { describirMetodo, ETIQUETAS_TIPO_CONTROL } from './presentacion.ts';

const por = (reglas: ReturnType<typeof describirMetodo>, clave: string) =>
  reglas.filter((r) => r.clave === clave);

describe('RF-M04 / CA-20: lo que la app muestra al iniciar un método', () => {
  const camaras = metodoBase({
    unidad: { tipo: 'camara', tipos_adicionales: [], texto: null },
    esfuerzo: {
      estandar: {
        cantidad: 6,
        unidad: 'cámaras durante 72 horas',
        texto: '6 cámaras durante 72 horas.',
      },
      za_ef: { cantidad: 6, texto: 'En ZA/EF, mínimo 6; con 6 exactas confirmar 144 h.' },
    },
    geometria: { tipo: 'punto', texto: 'Punto por cámara', vinculo_metodo: null, detalle: null },
    fotos: {
      contexto: {
        cantidad_por_unidad: 1,
        cardinales: false,
        reutiliza_metodo: null,
        texto: '1 por cámara',
      },
      metodologicas: { minimo: 2, texto: 'instalación' },
    },
    campos: [campo('fecha_instalacion', true, 'fecha'), campo('habitat'), campo('fallas', false)],
    registros: { etiqueta: 'Especies registradas', campos: [campo('especie')] },
    validaciones: [
      val.cantidad(6, 6),
      val.confirmacion(6, 'Las 6 cámaras permanecerán 144 h'),
      val.referencia('referencia'),
      val.geometria(),
      val.fotosContexto(1),
      val.campos(),
      val.fotosMetodologicas(2),
    ],
  });

  it('D01 cámaras trampa en ZA/EF: objetivo, regla ZA/EF, confirmación y tipo de control por regla (E-03)', () => {
    const r = describirMetodo(camaras, ESTACION_ZA_EF);
    expect(r.map((x) => x.clave)).toEqual([
      'objetivo',
      'za_ef',
      'confirmacion',
      'geometria',
      'track',
      'fotos_contexto',
      'fotos_metodologicas',
      'campos',
    ]);
    expect(por(r, 'objetivo')[0]).toMatchObject({
      valor: '6 cámaras durante 72 horas (estación ZA/EF)',
      tipo_control: 'obligatorio',
    });
    expect(por(r, 'confirmacion')[0]?.valor).toBe(
      'Con exactamente 6 unidades: Las 6 cámaras permanecerán 144 h',
    );
    expect(por(r, 'za_ef')[0]?.valor).toContain('144 h');
    expect(por(r, 'track')[0]).toMatchObject({ valor: 'No', tipo_control: null });
    expect(por(r, 'fotos_metodologicas')[0]?.valor).toBe('Mínimo 2: instalación');
    expect(por(r, 'campos')[0]?.valor).toBe(
      '3 campos (2 obligatorios); Especies registradas por filas',
    );
  });

  it('fuera de ZA/EF no se muestran la regla ZA/EF ni la confirmación', () => {
    const r = describirMetodo(camaras, ESTACION_COSTA);
    expect(por(r, 'za_ef')).toEqual([]);
    expect(por(r, 'confirmacion')).toEqual([]);
    expect(por(r, 'objetivo')[0]?.valor).toBe('6 cámaras durante 72 horas');
  });

  it('D01 bofedales: el objetivo es referencia y trata de usted; con valor de campo lo muestra (CA-21)', () => {
    const bofedal = metodoBase({
      unidad: { tipo: 'cuadrante', tipos_adicionales: [], texto: null },
      esfuerzo: {
        estandar: { cantidad: null, unidad: 'cuadrantes', texto: 'Referencia por superficie.' },
        za_ef: { cantidad: null, texto: 'Duplicación de referencia.' },
      },
      validaciones: [val.referencia()],
    });
    expect(por(describirMetodo(bofedal, ESTACION_ZA_EF), 'objetivo')[0]).toMatchObject({
      valor: 'Referencia metodológica: usted define el número final de unidades',
      tipo_control: 'criterio_humano',
    });
    expect(por(describirMetodo(bofedal, ESTACION_ZA_EF, 9), 'objetivo')[0]?.valor).toBe(
      '9 cuadrantes (valor definido en campo)',
    );
    expect(por(describirMetodo(bofedal, ESTACION_ZA_EF), 'za_ef')[0]).toMatchObject({
      valor: 'Duplicación de referencia.',
      tipo_control: 'criterio_humano',
    });
  });

  it('D01 VES: horario con dos ventanas, duración, separación como advertencia, track y registros', () => {
    const ves = metodoBase({
      unidad: { tipo: 'recorrido', tipos_adicionales: [], texto: null },
      horario: {
        ventanas: [
          { inicio: '06:00', fin: '11:00' },
          { inicio: '19:00', fin: '21:00' },
        ],
        texto: '06:00–11:00 y 19:00–21:00',
      },
      track: true,
      validaciones: [
        val.horario([
          { inicio: '06:00', fin: '11:00' },
          { inicio: '19:00', fin: '21:00' },
        ]),
        val.duracion(30),
        val.separacion(50, 'advertencia'),
        val.track(),
        val.registros(20, 'motivo_lista_incompleta'),
      ],
    });
    const r = describirMetodo(ves, ESTACION_COSTA);
    expect(por(r, 'horario')[0]).toMatchObject({
      valor: '06:00–11:00 y 19:00–21:00',
      tipo_control: 'obligatorio',
    });
    expect(por(r, 'duracion')[0]?.valor).toBe('30 min');
    expect(por(r, 'separacion')[0]).toMatchObject({ valor: '50 m', tipo_control: 'advertencia' });
    expect(por(r, 'track')[0]).toMatchObject({
      valor: 'Sí: la app registra el recorrido',
      tipo_control: 'obligatorio',
    });
    expect(por(r, 'registros')[0]?.valor).toBe('Mínimo 20 o motivo de registro incompleto');
    expect(ETIQUETAS_TIPO_CONTROL.advertencia).toBe('Advertencia (no bloquea)');
  });

  it('D01 conteo total en ZA/EF: duración de 60 min marcada (ZA/EF); ABS: tiempo efectivo reducible; detector: parámetros; Tomahawk: vínculo y nota', () => {
    const conteo = metodoBase({ validaciones: [val.duracion(30, 60)] });
    expect(por(describirMetodo(conteo, ESTACION_ZA_EF), 'duracion')[0]?.valor).toBe(
      '60 min (ZA/EF)',
    );

    const abs = metodoBase({
      esfuerzo: { estandar: { cantidad: 2, unidad: 'horas', texto: '2 horas.' }, za_ef: null },
      validaciones: [val.tiempoEfectivo()],
    });
    const ra = describirMetodo(abs, ESTACION_ZA_EF);
    expect(por(ra, 'tiempo_efectivo')[0]?.valor).toBe(
      '120 min; reducible a 60 min solo con sustento',
    );
    expect(por(ra, 'objetivo')[0]?.valor).toBe('120 minutos de búsqueda');
    expect(por(ra, 'za_ef')[0]).toMatchObject({
      valor: 'D01 no define una regla ZA/EF para este método',
      tipo_control: null,
    });

    const detector = metodoBase({ validaciones: [val.parametros(['WAV', '384 kHz'])] });
    expect(por(describirMetodo(detector, ESTACION_COSTA), 'parametros_tecnicos')[0]?.valor).toBe(
      'WAV · 384 kHz',
    );

    const tomahawk = metodoBase({
      geometria: {
        tipo: 'vinculada',
        texto: 'Mismo transecto Sherman',
        vinculo_metodo: 'mamiferos_menores_terrestres.sherman',
        detalle: null,
      },
      vinculo: {
        texto: 'Mismo transecto que Sherman; códigos propios.',
        metodos: ['mamiferos_menores_terrestres.sherman'],
      },
      validaciones: [
        val.vinculo('mamiferos_menores_terrestres.sherman'),
        val.mensaje('Puede instalarse elevada'),
      ],
    });
    const rt = describirMetodo(tomahawk, ESTACION_COSTA);
    expect(por(rt, 'vinculo')[0]).toMatchObject({
      valor: 'Mismo transecto que Sherman; códigos propios.',
      tipo_control: 'obligatorio',
    });
    expect(por(rt, 'mensaje')[0]).toMatchObject({
      valor: 'Puede instalarse elevada',
      tipo_control: 'informativo',
    });
    const soloValidacion = metodoBase({ validaciones: [val.vinculo('x.y')] });
    expect(por(describirMetodo(soloValidacion, ESTACION_COSTA), 'vinculo')[0]?.valor).toBe(
      'Cada unidad se vincula a una de x.y',
    );
  });

  it('un evento sin campos ni esfuerzo se describe sin inventar reglas', () => {
    const evento = metodoBase({
      clase: 'evento',
      esfuerzo: { estandar: null, za_ef: null },
      horario: { ventanas: [], texto: 'Cuando ocurra' },
    });
    const r = describirMetodo(evento, ESTACION_COSTA);
    expect(por(r, 'objetivo')[0]).toMatchObject({
      valor: 'Sin esfuerzo definido en D01',
      tipo_control: null,
    });
    expect(por(r, 'horario')[0]).toMatchObject({ valor: 'Cuando ocurra', tipo_control: null });
    expect(por(r, 'campos')[0]?.valor).toBe('Sin campos estructurados');
    expect(por(r, 'fotos_metodologicas')[0]?.valor).toBe('Sin fotos metodológicas');
  });
});
