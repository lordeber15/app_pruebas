import { describirMetodo, type ReglaPresentada } from '@campo/core';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  abrirEjecucion,
  ejecucionesDeEstacion,
  estacionParaReglas,
  leerPaquete,
  metodosDeEstacion,
  type EjecucionLocal,
  type EstacionPaquete,
  type MetodoEnEstacion,
} from '../src/campo.ts';
import { useApp } from '../src/estado.ts';
import {
  AccionInferior,
  Aviso,
  BarraEstado,
  Boton,
  e,
  Etiqueta,
  MarcaControl,
  NOMBRE_CONTROL,
  Separador,
  T,
  tipoOracion,
  type Control,
} from '../src/ui.tsx';

/** Orden de lectura: primero lo que se exige, después lo que orienta. */
const BLOQUES: readonly {
  titulo: string;
  controles: readonly (Control | null)[];
  nota?: string;
}[] = [
  { titulo: 'Se exige', controles: ['obligatorio'], nota: 'Si falta, la ejecución queda parcial.' },
  {
    titulo: 'Advertencias',
    controles: ['advertencia'],
    nota: 'Se avisan, pero no impiden cerrar.',
  },
  {
    titulo: 'Referencias y criterio de campo',
    controles: ['referencia', 'criterio_humano'],
    nota: 'Orientan; usted decide en campo.',
  },
  { titulo: 'Para tener en cuenta', controles: ['informativo', null] },
];

const Regla = ({ r }: { r: ReglaPresentada }) => (
  <View style={{ flexDirection: 'row', gap: 12, paddingVertical: 12, paddingHorizontal: 16 }}>
    <View style={{ width: 16, paddingTop: 5, alignItems: 'center' }}>
      <MarcaControl control={r.tipo_control} />
    </View>
    <View style={{ flex: 1, gap: 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Text style={[T.etiqueta, { flex: 1 }]}>{r.etiqueta}</Text>
        {r.tipo_control === null ? null : (
          <Text style={T.etiqueta}>{NOMBRE_CONTROL[r.tipo_control]}</Text>
        )}
      </View>
      <Text style={T.cuerpo}>{r.valor}</Text>
    </View>
  </View>
);

export default function Metodo() {
  const { estacionId, metodoId } = useLocalSearchParams<{ estacionId: string; metodoId: string }>();
  const insets = useSafeAreaInsets();
  const version = useApp((s) => s.version);
  const [est, setEst] = useState<EstacionPaquete | null>(null);
  const [m, setM] = useState<MetodoEnEstacion | null>(null);
  const [mias, setMias] = useState<EjecucionLocal[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const d = await leerPaquete();
        if (d === null) return;
        const estacion = d.paquete.estaciones.find((x) => x.id === estacionId) ?? null;
        const todos = metodosDeEstacion(d.paquete, estacionId).flatMap((x) => [
          ...x.metodos,
          ...x.eventos,
          ...x.porConfirmar,
        ]);
        setEst(estacion);
        setM(todos.find((x) => x.metodo.id === metodoId) ?? null);
        setMias((await ejecucionesDeEstacion(estacionId)).filter((x) => x.metodo_id === metodoId));
      })();
    }, [estacionId, metodoId, version]),
  );

  if (est === null || m === null) return <View style={e.pantalla} />;

  const reglas = describirMetodo(m.metodo.config, estacionParaReglas(est));
  const enCurso = mias.find((x) => x.estado_local === 'en_curso');
  const cerradas = mias.filter((x) => x.estado_local === 'cerrada').length;
  const esEvento = m.metodo.clase === 'evento';
  const sinReserva = !esEvento && m.reservaId === null;

  const iniciar = async () => {
    setOcupado(true);
    setError(null);
    try {
      const id = await abrirEjecucion(estacionId, m);
      router.replace({ pathname: '/ejecucion/[id]', params: { id } });
    } catch {
      setError('No se pudo iniciar. Intente de nuevo.');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <View style={e.pantalla}>
      <Stack.Screen options={{ title: est.codigo }} />
      <BarraEstado />
      <ScrollView contentContainerStyle={[e.contenido, { gap: 20 }]}>
        <View style={{ gap: 6 }}>
          <Text style={T.titular}>{tipoOracion(m.metodo.nombre)}</Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Etiqueta texto={`Estación ${est.codigo}`} />
            {est.za_ef === null ? null : <Etiqueta tono="tinta" texto={`ZA/EF ${est.za_ef}`} />}
            {cerradas > 0 ? (
              <Etiqueta
                tono="ok"
                texto={`${String(cerradas)} cerrada${cerradas === 1 ? '' : 's'} por usted`}
              />
            ) : null}
          </View>
          <Text style={T.suave}>{m.metodo.config.aplicacion.texto}</Text>
        </View>

        {m.pendiente && m.metodo.clase === 'condicional' ? (
          <Aviso tipo="atencion">
            La aplicación de este método en la estación está por confirmar.
          </Aviso>
        ) : null}
        {error === null ? null : <Aviso>{error}</Aviso>}

        {BLOQUES.map((b) => {
          const items = reglas.filter((r) => b.controles.includes(r.tipo_control));
          if (items.length === 0) return null;
          return (
            <View key={b.titulo} style={{ gap: 8 }}>
              <View style={{ paddingHorizontal: 4 }}>
                <Text style={T.subtitulo} accessibilityRole="header">
                  {b.titulo}
                </Text>
                {b.nota === undefined ? null : <Text style={T.suave}>{b.nota}</Text>}
              </View>
              <View style={[e.tarjeta, { padding: 0, gap: 0 }]}>
                {items.map((r, i) => (
                  <View key={`${r.clave}-${String(i)}`}>
                    {i > 0 ? <Separador /> : null}
                    <Regla r={r} />
                  </View>
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>
      <AccionInferior abajo={insets.bottom}>
        {sinReserva ? (
          <Text style={T.suave}>
            Este método no está programado para su brigada en esta estación.
          </Text>
        ) : enCurso !== undefined ? (
          <Boton
            texto="Continuar ejecución"
            alPresionar={() =>
              router.push({ pathname: '/ejecucion/[id]', params: { id: enCurso.id } })
            }
          />
        ) : (
          <Boton
            texto={esEvento ? 'Registrar' : 'Iniciar ejecución'}
            ocupado={ocupado}
            alPresionar={() => void iniciar()}
          />
        )}
      </AccionInferior>
    </View>
  );
}
