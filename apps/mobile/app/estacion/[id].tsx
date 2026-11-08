import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ejecucionesDeEstacion,
  leerPaquete,
  metodosDeEstacion,
  type EjecucionLocal,
  type EspecialidadEnEstacion,
  type EstacionPaquete,
  type MetodoEnEstacion,
} from '../../src/campo.ts';
import {
  avanceDeEstacionLocal,
  type AvanceEstacionLocal,
  type AvanceMetodoLocal,
} from '../../src/avance.ts';
import { ResumenAvanceEstacion } from '../../src/avance-vista.tsx';
import { useApp } from '../../src/estado.ts';
import {
  BarraEstado,
  BarraProgreso,
  Boton,
  C,
  e,
  Etiqueta,
  Fila,
  Grupo,
  Separador,
  T,
  tipoOracion,
} from '../../src/ui.tsx';

const Atributo = ({ etiqueta, valor }: { etiqueta: string; valor: string | null }) => (
  <View style={{ minWidth: '30%', flexGrow: 1, gap: 2 }}>
    <Text style={T.etiqueta}>{etiqueta}</Text>
    <Text style={T.dato}>{valor === null || valor === '' ? 'Sin dato' : valor}</Text>
  </View>
);

/** Atributos de A01 (RN-29, CA-20): se muestran, nunca se piden al especialista. */
export const AtributosEstacion = ({ est }: { est: EstacionPaquete }) => (
  <View style={[e.tarjeta, { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, columnGap: 12 }]}>
    <Atributo etiqueta="Zona UTM" valor={est.zona_utm} />
    <Atributo
      etiqueta="Este"
      valor={
        est.este === null ? null : est.este.toLocaleString('es-PE', { maximumFractionDigits: 0 })
      }
    />
    <Atributo
      etiqueta="Norte"
      valor={
        est.norte === null ? null : est.norte.toLocaleString('es-PE', { maximumFractionDigits: 0 })
      }
    />
    <Atributo etiqueta="AID/AII" valor={est.aid_aii} />
    <Atributo etiqueta="ZA/EF" valor={est.za_ef ?? 'No'} />
    <Atributo etiqueta="Región" valor={est.region} />
    <View style={{ width: '100%', gap: 2 }}>
      <Text style={T.etiqueta}>Unidad de vegetación</Text>
      <Text style={T.dato}>{est.uv ?? 'Sin dato'}</Text>
    </View>
  </View>
);

const estadoMetodo = (propias: EjecucionLocal[]) => {
  const enCurso = propias.filter((x) => x.estado_local === 'en_curso').length;
  const cerradas = propias.filter((x) => x.estado_local === 'cerrada');
  if (enCurso > 0) return <Etiqueta tono="atencion" texto="En curso" />;
  if (cerradas.length > 0) {
    const parcial = cerradas.some((x) => (x.incumplimientos ?? 0) > 0);
    return (
      <Etiqueta
        tono={parcial ? 'error' : 'ok'}
        texto={parcial ? 'Cerrada con faltantes' : 'Cerrada'}
      />
    );
  }
  return null;
};

/** Mini barra del método: avance elemental (RN-38) o, sin objetivo numérico, su estado. */
const AvanceMetodo = ({ a }: { a: AvanceMetodoLocal }) => {
  const { ejecutado, objetivo, porcentaje } = a.avance;
  const texto =
    objetivo === null
      ? a.completo
        ? 'Completo'
        : `${String(ejecutado)} ${a.unidadTexto}`
      : `${String(ejecutado)} de ${String(objetivo)} ${a.unidadTexto}${a.completo ? ' · completo' : ''}`;
  return (
    <View style={{ gap: 4, marginTop: 4 }}>
      <Text style={T.etiqueta}>{texto}</Text>
      {porcentaje === null ? null : (
        <BarraProgreso porcentaje={porcentaje} etiqueta={`Avance del método: ${texto}`} alto={6} />
      )}
    </View>
  );
};

const CLASE: Record<string, string> = {
  condicional: 'Condicional',
  transversal: 'Transversal de fauna',
};

export default function Estacion() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const version = useApp((s) => s.version);
  const [est, setEst] = useState<EstacionPaquete | null>(null);
  const [especialidades, setEspecialidades] = useState<EspecialidadEnEstacion[]>([]);
  const [ejecuciones, setEjecuciones] = useState<EjecucionLocal[]>([]);
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const [avance, setAvance] = useState<AvanceEstacionLocal | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const d = await leerPaquete();
        if (d === null) return;
        setEst(d.paquete.estaciones.find((x) => x.id === id) ?? null);
        setEspecialidades(metodosDeEstacion(d.paquete, id));
        setEjecuciones(await ejecucionesDeEstacion(id));
        setAvance(await avanceDeEstacionLocal(d.paquete, id));
      })();
    }, [id, version]),
  );

  if (est === null) return <View style={e.pantalla} />;

  const abrir = (m: MetodoEnEstacion) =>
    router.push({ pathname: '/metodo', params: { estacionId: id, metodoId: m.metodo.id } });

  const filaMetodo = (m: MetodoEnEstacion, i: number) => (
    <View key={m.metodo.id}>
      {i > 0 ? <Separador /> : null}
      <Fila
        alPresionar={() => abrir(m)}
        derecha={estadoMetodo(ejecuciones.filter((x) => x.metodo_id === m.metodo.id))}
      >
        <Text style={T.subtitulo}>{tipoOracion(m.metodo.nombre)}</Text>
        {CLASE[m.metodo.clase] === undefined ? null : (
          <Text style={T.suave}>{CLASE[m.metodo.clase]}</Text>
        )}
        {(() => {
          const a = avance?.metodos.find((x) => x.metodoId === m.metodo.id);
          return a === undefined ? null : <AvanceMetodo a={a} />;
        })()}
      </Fila>
    </View>
  );

  const eventos = especialidades.flatMap((x) => x.eventos);
  const porConfirmar = especialidades.flatMap((x) => x.porConfirmar);

  return (
    <View style={[e.pantalla, { paddingBottom: insets.bottom }]}>
      <Stack.Screen options={{ title: `Estación ${est.codigo}` }} />
      <BarraEstado />
      <ScrollView contentContainerStyle={[e.contenido, { gap: 24 }]}>
        <View style={{ gap: 8 }}>
          <Text style={T.titular}>{est.codigo}</Text>
          <AtributosEstacion est={est} />
        </View>
        {avance === null ? null : (
          <View style={e.tarjeta}>
            <ResumenAvanceEstacion avance={avance} />
          </View>
        )}

        {especialidades.map((esp) => (
          <Grupo key={esp.id} titulo={tipoOracion(esp.nombre)}>
            {esp.metodos.map(filaMetodo)}
            {esp.metodos.length === 0 ? (
              <View style={{ padding: 16 }}>
                <Text style={T.suave}>Ningún método habilitado todavía en esta estación.</Text>
              </View>
            ) : null}
          </Grupo>
        ))}

        {eventos.length > 0 ? (
          <Grupo
            titulo="Registros complementarios"
            nota="Registros oportunos: no cuentan como esfuerzo del método."
          >
            {eventos.map(filaMetodo)}
          </Grupo>
        ) : null}

        <Boton
          variante="secundario"
          texto="Ver en el mapa"
          alPresionar={() => router.push({ pathname: '/mapa', params: { estacionId: id } })}
        />
        <Boton
          variante="secundario"
          texto="Registrar alerta en esta estación"
          alPresionar={() => router.push({ pathname: '/alerta/nueva', params: { estacionId: id } })}
        />

        {porConfirmar.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Text style={T.subtitulo}>Por confirmar ({porConfirmar.length})</Text>
            <Text style={T.suave}>
              Métodos condicionales cuya aplicación en esta estación aún no se confirma.
              Coordinación los habilita desde la web.
            </Text>
            {abiertas.has('confirmar') ? (
              <View style={{ gap: 6 }}>
                {porConfirmar.map((m) => (
                  <View
                    key={m.metodo.id}
                    style={{
                      flexDirection: 'row',
                      gap: 10,
                      alignItems: 'center',
                      paddingVertical: 6,
                    }}
                  >
                    <View
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        borderWidth: 2,
                        borderColor: C.suave,
                      }}
                    />
                    <Text style={[T.cuerpo, { flex: 1 }]}>{tipoOracion(m.metodo.nombre)}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Boton
                variante="secundario"
                texto="Ver métodos por confirmar"
                alPresionar={() => setAbiertas(new Set([...abiertas, 'confirmar']))}
              />
            )}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
