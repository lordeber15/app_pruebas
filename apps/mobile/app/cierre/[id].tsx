import type { EvaluacionEjecucion, ResultadoRegla, TipoDesviacion } from '@campo/core';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  cerrarEjecucion,
  ejecucion as leerEjecucion,
  evaluarLocal,
  guardarBorradorCierre,
  leerPaquete,
  unidadesDe,
  type MetodoPaquete,
  type Paquete,
} from '../../src/campo.ts';
import { Formulario, guardarPendientes, type Valor } from '../../src/formulario.tsx';
import { mayuscula } from '../../src/textos.ts';
import {
  AccionInferior,
  Aviso,
  BarraEstado,
  Boton,
  C,
  e,
  MarcaControl,
  NOMBRE_CONTROL,
  Segmentado,
  Separador,
  T,
  tipoOracion,
} from '../../src/ui.tsx';

const DESVIACIONES: readonly { valor: TipoDesviacion; texto: string }[] = [
  { valor: 'ninguna', texto: 'Ninguna' },
  { valor: 'parcial', texto: 'Ejecución parcial' },
  { valor: 'imposibilidad', texto: 'Imposibilidad' },
  { valor: 'excepcional', texto: 'Condición excepcional' },
];

const Lista = ({
  titulo,
  nota,
  items,
}: {
  titulo: string;
  nota: string;
  items: ResultadoRegla[];
}) =>
  items.length === 0 ? null : (
    <View style={{ gap: 8 }}>
      <View style={{ paddingHorizontal: 4 }}>
        <Text style={T.subtitulo} accessibilityRole="header">
          {titulo} ({items.length})
        </Text>
        <Text style={T.suave}>{nota}</Text>
      </View>
      <View style={[e.tarjeta, { padding: 0, gap: 0 }]}>
        {items.map((r, i) => (
          <View key={`${r.regla}-${r.unidad_id ?? ''}-${String(i)}`}>
            {i > 0 ? <Separador /> : null}
            <View style={{ flexDirection: 'row', gap: 12, padding: 14, alignItems: 'flex-start' }}>
              <View style={{ width: 16, paddingTop: 5, alignItems: 'center' }}>
                <MarcaControl control={r.tipo_control} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={T.cuerpo}>{mayuscula(r.mensaje)}</Text>
                <Text style={T.etiqueta}>{NOMBRE_CONTROL[r.tipo_control]}</Text>
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );

export default function Cierre() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [p, setP] = useState<Paquete | null>(null);
  const [metodo, setMetodo] = useState<MetodoPaquete | null>(null);
  const [ev, setEv] = useState<EvaluacionEjecucion | null>(null);
  const [datos, setDatos] = useState<Record<string, unknown>>({});
  const [desviacion, setDesviacion] = useState<TipoDesviacion>('ninguna');
  const [explicacion, setExplicacion] = useState('');
  const [confirmaciones, setConfirmaciones] = useState<string[]>([]);
  const [objetivo, setObjetivo] = useState('');
  const [abiertas, setAbiertas] = useState(0);
  const [cerrando, setCerrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  // Lo más reciente del cierre, para guardarlo aunque la pantalla ya no vuelva a dibujarse
  // (salir con el teclado abierto) y para cerrar con lo último escrito.
  const datosRef = useRef<Record<string, unknown>>({});
  const cierreRef = useRef<Parameters<typeof guardarBorradorCierre>[1] | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const d = await leerPaquete();
        const ej = await leerEjecucion(id);
        if (d === null || ej === null) return;
        setP(d.paquete);
        datosRef.current = JSON.parse(ej.datos) as Record<string, unknown>;
        setDatos(datosRef.current);
        setDesviacion(ej.desviacion_tipo);
        setExplicacion(ej.desviacion_explicacion ?? '');
        setConfirmaciones(JSON.parse(ej.confirmaciones) as string[]);
        setObjetivo(ej.objetivo_campo === null ? '' : String(ej.objetivo_campo));
        setAbiertas((await unidadesDe(id)).filter((u) => u.estado === 'abierta').length);
        setListo(true);
      })();
    }, [id]),
  );

  const objetivoNum = objetivo.trim() === '' ? null : Number(objetivo.replace(',', '.'));
  const cierre = {
    datos,
    desviacion: { tipo: desviacion, explicacion: desviacion === 'ninguna' ? null : explicacion },
    confirmaciones,
    objetivo_campo:
      objetivoNum !== null && Number.isFinite(objetivoNum) && objetivoNum > 0 ? objetivoNum : null,
  };

  // Reevalúa con lo que se está editando: la misma regla que se aplicará en el servidor (RF-T04).
  const clave = JSON.stringify(cierre);
  cierreRef.current = cierre;
  useEffect(() => {
    if (p === null || !listo) return;
    void evaluarLocal(p, id, cierre).then((r) => {
      if (r === null) return;
      setEv(r.evaluacion);
      setMetodo(r.metodo);
    });
    void guardarBorradorCierre(id, cierre);
  }, [p, id, clave, listo]);

  if (p === null || ev === null || metodo === null) return <View style={e.pantalla} />;
  const cfg = metodo.config;
  const obligatorios = ev.resultados.filter(
    (r) => r.estado === 'incumple' && r.tipo_control === 'obligatorio',
  );
  const advertencias = ev.resultados.filter(
    (r) => r.estado === 'incumple' && r.tipo_control === 'advertencia',
  );
  const informativos = ev.resultados.filter(
    (r) => r.estado === 'informativo' && r.regla !== 'desviacion',
  );
  const confirmacion = cfg.validaciones.find((v) => v.tipo === 'confirmacion');
  const pideConfirmar =
    confirmacion !== undefined &&
    ev.resultados.some((r) => r.regla === 'confirmacion' && r.estado !== 'no_aplica');
  const esReferencia = ev.objetivo.origen === 'referencia' || ev.objetivo.origen === 'campo';
  const faltaExplicar = desviacion !== 'ninguna' && explicacion.trim() === '';
  const bloqueado = (obligatorios.length > 0 && desviacion === 'ninguna') || faltaExplicar;

  const cambiarDato = (k: string, v: Valor) => {
    datosRef.current = { ...datosRef.current, [k]: v };
    setDatos(datosRef.current);
    if (cierreRef.current !== null && listo)
      void guardarBorradorCierre(id, { ...cierreRef.current, datos: datosRef.current });
  };

  const cerrar = async () => {
    // Lo escrito con el teclado abierto se entrega antes de evaluar y cerrar.
    guardarPendientes();
    setCerrando(true);
    setError(null);
    try {
      await cerrarEjecucion(p, id, { ...cierre, datos: datosRef.current });
      router.dismissTo({ pathname: '/ejecucion/[id]', params: { id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cerrar.');
    } finally {
      setCerrando(false);
    }
  };

  return (
    <View style={e.pantalla}>
      <Stack.Screen options={{ title: 'Revisar y cerrar' }} />
      <BarraEstado />
      <ScrollView
        contentContainerStyle={[e.contenido, { gap: 22 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 4 }}>
          <Text style={T.titulo}>{tipoOracion(cfg.nombre)}</Text>
          <Text style={T.suave}>
            {ev.unidades_cerradas} unidades terminadas
            {abiertas > 0 ? `; ${String(abiertas)} abiertas se terminarán al cerrar` : ''}.
          </Text>
        </View>

        {obligatorios.length === 0 ? (
          <Aviso tipo="ok">Cumple todo lo obligatorio de D01 para este método.</Aviso>
        ) : (
          <Lista
            titulo="Falta"
            nota="Requisitos obligatorios de D01. Complételos o declare una desviación."
            items={obligatorios}
          />
        )}
        <Lista titulo="Advertencias" nota="No impiden cerrar." items={advertencias} />
        <Lista
          titulo="Referencias"
          nota="Información de D01 para su criterio."
          items={informativos}
        />

        {pideConfirmar ? (
          <View style={[e.tarjeta, { gap: 10, padding: 16 }]}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <MarcaControl control="obligatorio" />
              <Text style={[T.subtitulo, { flex: 1 }]}>Confirmación ZA/EF</Text>
            </View>
            <Text style={T.cuerpo}>{confirmacion.mensaje}.</Text>
            <Segmentado
              etiqueta="¿Lo confirma?"
              opciones={[
                { valor: 'si', texto: 'Sí, lo confirmo' },
                { valor: 'no', texto: 'Todavía no' },
              ]}
              valor={confirmaciones.includes(confirmacion.condicion) ? 'si' : 'no'}
              alCambiar={(v) =>
                setConfirmaciones(
                  v === 'si'
                    ? [...new Set([...confirmaciones, confirmacion.condicion])]
                    : confirmaciones.filter((x) => x !== confirmacion.condicion),
                )
              }
            />
          </View>
        ) : null}

        {esReferencia ? (
          <View style={[e.tarjeta, { gap: 8, padding: 16 }]}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <MarcaControl control="criterio_humano" />
              <Text style={[T.subtitulo, { flex: 1 }]}>Número final de unidades</Text>
            </View>
            <Text style={T.suave}>{ev.objetivo.texto}</Text>
            <TextInput
              accessibilityLabel="Número final de unidades definido en campo"
              value={objetivo}
              onChangeText={setObjetivo}
              keyboardType="number-pad"
              placeholder="Ej.: 9"
              placeholderTextColor={C.suave}
              style={e.entrada}
            />
          </View>
        ) : null}

        {cfg.campos_ejecucion.length > 0 ? (
          <View style={[e.tarjeta, { gap: 12, padding: 16 }]}>
            <Text style={T.subtitulo}>Datos de la ejecución</Text>
            <Formulario campos={cfg.campos_ejecucion} datos={datos} alCambiar={cambiarDato} />
          </View>
        ) : null}

        <View style={[e.tarjeta, { gap: 12, padding: 16 }]}>
          <Text style={T.subtitulo}>Desviación</Text>
          <Segmentado
            etiqueta="¿Hubo una desviación del método?"
            opciones={DESVIACIONES}
            valor={desviacion}
            alCambiar={setDesviacion}
          />
          {desviacion === 'ninguna' ? null : (
            <View style={{ gap: 6 }}>
              <Text style={e.etiqueta}>Explicación</Text>
              <TextInput
                accessibilityLabel="Explicación de la desviación"
                value={explicacion}
                onChangeText={setExplicacion}
                multiline
                placeholder="Qué pasó y por qué"
                placeholderTextColor={C.suave}
                style={[
                  e.entrada,
                  {
                    minHeight: 96,
                    paddingVertical: 12,
                    textAlignVertical: 'top',
                    borderColor: faltaExplicar ? C.ocre : C.linea,
                  },
                ]}
              />
              <Text style={e.ayuda}>Queda trazable y el Supervisor podrá complementarla.</Text>
            </View>
          )}
        </View>
        {error === null ? null : <Aviso>{error}</Aviso>}
      </ScrollView>
      <AccionInferior abajo={insets.bottom}>
        {bloqueado ? (
          <Text style={T.suave}>
            {faltaExplicar
              ? 'Escriba la explicación de la desviación.'
              : 'Complete lo que falta o declare una desviación para cerrar.'}
          </Text>
        ) : null}
        <Boton
          texto={obligatorios.length > 0 ? 'Cerrar con desviación' : 'Cerrar ejecución'}
          deshabilitado={bloqueado}
          ocupado={cerrando}
          alPresionar={() => void cerrar()}
        />
      </AccionInferior>
    </View>
  );
}
