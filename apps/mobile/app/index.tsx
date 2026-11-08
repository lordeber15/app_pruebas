import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  agendaDeEstaciones,
  descargarPaqueteCampo,
  fechaLocal,
  leerPaquete,
  resumenPorEstacion,
  type EstacionDelDia,
  type Paquete,
} from '../src/campo.ts';
import { avancesDeEstacionesLocales, type AvanceEstacionLocal } from '../src/avance.ts';
import { ResumenAvanceEstacion } from '../src/avance-vista.tsx';
import { useApp } from '../src/estado.ts';
import { CLAVES, llavero } from '../src/plataforma.ts';
import { ErrorServidor } from '../src/sesion.ts';
import { sincronizar } from '../src/sync.ts';
import { abrirJornada, cerrarJornada, jornadaAbierta } from '../src/jornada.ts';
import { Aviso, BarraEstado, Boton, e, Etiqueta, Fila, Grupo, Separador, T } from '../src/ui.tsx';

type Ruta = '/servidor' | '/entrar' | '/desbloquear';

const FORMATO_DIA = new Intl.DateTimeFormat('es-PE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const diaLegible = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const texto = FORMATO_DIA.format(new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};
const FORMATO_HORA = new Intl.DateTimeFormat('es-PE', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** Fila de estación: código grande, lo que la distingue (UV, ZA/EF) y lo hecho en este celular. */
const FilaEstacion = ({
  item,
  resumen,
  avance,
}: {
  item: EstacionDelDia;
  resumen: { en_curso: number; cerradas: number } | undefined;
  avance: AvanceEstacionLocal | undefined;
}) => {
  const est = item.estacion;
  return (
    <Fila
      alPresionar={() => router.push({ pathname: '/estacion/[id]', params: { id: est.id } })}
      etiquetaAccesible={`Estación ${est.codigo}`}
      derecha={
        resumen === undefined ? null : (
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            {resumen.en_curso > 0 ? (
              <Etiqueta tono="atencion" texto={`${String(resumen.en_curso)} en curso`} />
            ) : null}
            {resumen.cerradas > 0 ? (
              <Etiqueta tono="ok" texto={`${String(resumen.cerradas)} cerradas`} />
            ) : null}
          </View>
        )
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text style={T.titulo}>{est.codigo}</Text>
        {est.za_ef === null ? null : <Etiqueta tono="tinta" texto={`ZA/EF ${est.za_ef}`} />}
        {item.estado_fila === 'pendiente_validacion' ? (
          <Etiqueta tono="atencion" texto="Programación por validar" />
        ) : null}
        {item.estado_fila === 'reprogramada' ? <Etiqueta texto="Reprogramada" /> : null}
      </View>
      <Text style={T.suave} numberOfLines={2}>
        {[
          est.uv,
          est.aid_aii,
          item.actividad_especial === null
            ? null
            : `Actividad especial: ${item.actividad_especial}`,
        ]
          .filter((x) => x !== null && x !== '')
          .join(' · ')}
      </Text>
      {avance === undefined ? null : <ResumenAvanceEstacion avance={avance} compacto />}
    </Fila>
  );
};

export default function Inicio() {
  const insets = useSafeAreaInsets();
  const app = useApp();
  const [ruta, setRuta] = useState<Ruta | 'lista' | 'cargando'>('cargando');
  const [datos, setDatos] = useState<{ descargado_en: string; paquete: Paquete } | null>(null);
  const [resumen, setResumen] = useState<Map<string, { en_curso: number; cerradas: number }>>(
    new Map(),
  );
  const [avances, setAvances] = useState<Map<string, AvanceEstacionLocal>>(new Map());
  const [jornada, setJornada] = useState<{ id: string } | null>(null);
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verAnteriores, setVerAnteriores] = useState(false);

  const cargar = useCallback(async () => {
    if ((await llavero.leer(CLAVES.servidor)) === null) {
      setRuta('/servidor');
      return;
    }
    if ((await llavero.leer(CLAVES.dispositivo)) === null) {
      setRuta('/entrar');
      return;
    }
    if (!useApp.getState().desbloqueado) {
      setRuta('/desbloquear');
      return;
    }
    const paquete = await leerPaquete();
    setDatos(paquete);
    setAvances(paquete === null ? new Map() : await avancesDeEstacionesLocales(paquete.paquete));
    setResumen(new Map((await resumenPorEstacion()).map((r) => [r.estacion_id, r])));
    setJornada(await jornadaAbierta());
    setRuta('lista');
  }, []);

  useFocusEffect(
    useCallback(() => {
      void cargar();
    }, [cargar, app.version]),
  );

  const agenda = useMemo(() => {
    if (datos === null) return null;
    const { porFecha } = agendaDeEstaciones(datos.paquete);
    const hoy = fechaLocal();
    const fechas = [...porFecha.keys()].sort();
    return {
      hoy,
      deHoy: porFecha.get(hoy) ?? [],
      proximas: fechas
        .filter((f) => f > hoy)
        .map((f) => ({ fecha: f, items: porFecha.get(f) ?? [] })),
      anteriores: fechas
        .filter((f) => f < hoy)
        .reverse()
        .map((f) => ({ fecha: f, items: porFecha.get(f) ?? [] })),
    };
  }, [datos]);

  const descargar = async () => {
    setDescargando(true);
    setError(null);
    try {
      await descargarPaqueteCampo();
    } catch (err) {
      setError(
        err instanceof ErrorServidor && err.estado === 403
          ? 'Su usuario todavía no pertenece a una brigada. Pida a Coordinación que lo agregue.'
          : 'No se pudo descargar el paquete. Revise la conexión e intente de nuevo.',
      );
    } finally {
      setDescargando(false);
    }
  };

  if (ruta === 'cargando') return <View style={e.pantalla} />;
  if (ruta !== 'lista') return <Redirect href={ruta} />;

  const brigadas = datos?.paquete.brigadas.map((b) => b.codigo ?? b.nombre).join(', ') ?? '';

  return (
    <View style={[e.pantalla, { paddingBottom: insets.bottom }]}>
      <BarraEstado />
      <ScrollView contentContainerStyle={[e.contenido, { gap: 24 }]} refreshControl={undefined}>
        {app.ultimoError === null ? null : <Aviso tipo="atencion">{app.ultimoError}</Aviso>}
        {error === null ? null : <Aviso>{error}</Aviso>}

        {datos === null ? (
          <View style={{ gap: 12, paddingTop: 8 }}>
            <Text style={T.titular}>Prepare su trabajo de campo</Text>
            <Text style={T.cuerpo}>
              Descargue el paquete de su brigada: cronograma, estaciones y métodos. Después podrá
              trabajar sin señal.
            </Text>
            <Boton
              texto="Descargar paquete de campo"
              ocupado={descargando}
              deshabilitado={!app.conectado}
              alPresionar={() => void descargar()}
            />
            {!app.conectado ? (
              <Text style={T.suave}>Necesita conexión solo para esta descarga.</Text>
            ) : null}
          </View>
        ) : (
          <>
            <View style={{ gap: 4 }}>
              <Text style={T.etiqueta}>
                {brigadas === '' ? 'Sin brigada' : `Brigada ${brigadas}`}
              </Text>
              <Text style={T.titular}>{diaLegible(agenda?.hoy ?? fechaLocal())}</Text>
              <Text style={T.suave}>
                Paquete del {FORMATO_HORA.format(new Date(datos.descargado_en))}
              </Text>
            </View>

            {agenda !== null && agenda.deHoy.length > 0 ? (
              <Grupo
                titulo="Estaciones de hoy"
                nota="El avance es según lo registrado en este celular."
              >
                {agenda.deHoy.map((it, i) => (
                  <View key={it.estacion.id}>
                    {i > 0 ? <Separador /> : null}
                    <FilaEstacion
                      item={it}
                      resumen={resumen.get(it.estacion.id)}
                      avance={avances.get(it.estacion.id)}
                    />
                  </View>
                ))}
              </Grupo>
            ) : (
              <View style={[e.tarjeta, { gap: 4 }]}>
                <Text style={T.subtitulo}>Hoy no tiene estaciones programadas</Text>
                <Text style={T.suave}>Abajo están las próximas fechas del cronograma vigente.</Text>
              </View>
            )}

            {agenda?.proximas.slice(0, 7).map((d) => (
              <Grupo key={d.fecha} titulo={diaLegible(d.fecha)}>
                {d.items.map((it, i) => (
                  <View key={it.estacion.id}>
                    {i > 0 ? <Separador /> : null}
                    <FilaEstacion
                      item={it}
                      resumen={resumen.get(it.estacion.id)}
                      avance={avances.get(it.estacion.id)}
                    />
                  </View>
                ))}
              </Grupo>
            ))}

            {agenda !== null && agenda.anteriores.length > 0 ? (
              verAnteriores ? (
                agenda.anteriores.map((d) => (
                  <Grupo key={d.fecha} titulo={diaLegible(d.fecha)} nota="Fecha pasada">
                    {d.items.map((it, i) => (
                      <View key={it.estacion.id}>
                        {i > 0 ? <Separador /> : null}
                        <FilaEstacion
                          item={it}
                          resumen={resumen.get(it.estacion.id)}
                          avance={avances.get(it.estacion.id)}
                        />
                      </View>
                    ))}
                  </Grupo>
                ))
              ) : (
                <Boton
                  variante="secundario"
                  texto={`Ver fechas anteriores (${String(agenda.anteriores.length)})`}
                  alPresionar={() => setVerAnteriores(true)}
                />
              )
            ) : null}

            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={T.subtitulo}>
                    {jornada === null ? 'Jornada cerrada' : 'Jornada abierta'}
                  </Text>
                  <Text style={T.suave}>
                    {jornada === null
                      ? 'Ábrala al empezar el día.'
                      : 'Ciérrela al terminar el día.'}
                  </Text>
                </View>
                <Boton
                  texto={jornada === null ? 'Abrir' : 'Cerrar'}
                  variante={jornada === null ? 'principal' : 'secundario'}
                  alPresionar={() =>
                    void (jornada === null ? abrirJornada() : cerrarJornada(jornada.id))
                  }
                />
              </View>
              <Boton
                variante="secundario"
                texto="Mapa de estaciones"
                alPresionar={() => router.push('/mapa')}
              />
              <Boton
                variante="secundario"
                texto="Registrar alerta"
                alPresionar={() => router.push('/alerta/nueva')}
              />
              <Boton
                variante="secundario"
                texto="Mis alertas"
                alPresionar={() => router.push('/alertas')}
              />
              <Boton
                variante="secundario"
                texto="Actualizar cronograma y métodos"
                deshabilitado={!app.conectado}
                ocupado={app.sincronizando || descargando}
                alPresionar={() => void sincronizar({ paquete: true })}
              />
              <Boton
                variante="secundario"
                texto="Cambiar contraseña"
                deshabilitado={!app.conectado}
                alPresionar={() => router.push('/contrasena')}
              />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
