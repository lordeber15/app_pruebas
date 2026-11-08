import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../src/estado.ts';
import {
  borrarCopiaMapa,
  descargarMapa,
  ErrorMapa,
  leerCatalogo,
  proyectosDelPaquete,
  refrescarMapas,
  ultimoRefresco,
  useDescargaMapa,
} from '../src/mapas.ts';
import {
  accionesMapa,
  accionUsaRed,
  estadoLocalMapa,
  ETIQUETA_ESTADO_LOCAL,
  ETIQUETA_ESTADO_SERVIDOR,
  porcentaje,
  textoMB,
  type AccionMapa,
  type EstadoLocalMapa,
  type FilaMapaLocal,
} from '../src/mapas-logica.ts';
import { ErrorServidor } from '../src/sesion.ts';
import {
  Aviso,
  BarraEstado,
  BarraProgreso,
  Boton,
  e,
  Etiqueta,
  Grupo,
  Separador,
  T,
} from '../src/ui.tsx';

/**
 * Mapas sin conexión (RF-M05, CA-08): áreas que el servidor preparó para la brigada o que marcó
 * un usuario. Se descargan solo con WiFi no medida y después el mapa se ve en modo avión. Sin
 * señal se muestra lo guardado en el celular.
 */

const FORMATO_FECHA = new Intl.DateTimeFormat('es-PE', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const fecha = (iso: string | null | undefined): string | null =>
  iso === null || iso === undefined ? null : FORMATO_FECHA.format(new Date(iso));

const TONO_LOCAL: Readonly<Record<EstadoLocalMapa, 'ok' | 'atencion' | 'neutro' | 'error'>> = {
  descargado: 'ok',
  desactualizado: 'atencion',
  descargando: 'atencion',
  interrumpido: 'error',
  no_descargado: 'neutro',
};

const TEXTO_ACCION: Readonly<Record<AccionMapa, string>> = {
  descargar: 'Descargar',
  actualizar: 'Actualizar',
  reintentar: 'Reintentar',
  borrar: 'Borrar copia',
};

const mensajeDe = (err: unknown): string =>
  err instanceof ErrorMapa || err instanceof ErrorServidor
    ? err.message
    : 'No se pudo completar la acción. Intente de nuevo.';

const AreaMapa = ({
  fila,
  wifi,
  alAccion,
}: {
  fila: FilaMapaLocal;
  wifi: boolean;
  alAccion: (a: AccionMapa) => void;
}) => {
  const descarga = useDescargaMapa();
  const estado = estadoLocalMapa(fila, descarga.id);
  const s = fila.servidor;
  const nombre = s?.nombre ?? fila.copia?.nombre ?? 'Área';
  const acciones = accionesMapa(fila, estado);
  const pct = estado === 'descargando' ? porcentaje(descarga.bytes, descarga.total) : null;
  const tamano = s?.tamano ?? fila.copia?.tamano ?? null;
  const detalle = [
    s?.brigada_nombre === null || s?.brigada_nombre === undefined
      ? null
      : `Brigada ${s.brigada_nombre}`,
    s?.origen === 'brigada'
      ? 'Área de las estaciones'
      : s?.solicitado_por_nombre === null || s?.solicitado_por_nombre === undefined
        ? null
        : `Marcada por ${s.solicitado_por_nombre}`,
    textoMB(tamano),
  ]
    .filter((x) => x !== null)
    .join(' · ');
  const version =
    s === null
      ? null
      : `Versión ${String(s.version)}${s.generado_en === null ? '' : ` del ${fecha(s.generado_en) ?? ''}`}`;

  return (
    <View style={{ padding: 16, gap: 8 }}>
      <Text style={T.titulo}>{nombre}</Text>
      {detalle === '' ? null : <Text style={T.suave}>{detalle}</Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {s === null ? (
          <Etiqueta texto="Ya no está en el servidor" />
        ) : (
          <Etiqueta
            tono={s.estado === 'listo' ? 'ok' : s.estado === 'error' ? 'error' : 'atencion'}
            texto={ETIQUETA_ESTADO_SERVIDOR[s.estado]}
          />
        )}
        <Etiqueta tono={TONO_LOCAL[estado]} texto={ETIQUETA_ESTADO_LOCAL[estado]} />
      </View>
      {version === null ? null : <Text style={T.suave}>{version}</Text>}
      {fila.copia === null ? null : (
        <Text style={T.suave}>
          {`En el celular: versión ${String(fila.copia.version)}, descargada el ${fecha(fila.copia.descargado_en) ?? ''}`}
        </Text>
      )}
      {s?.estado === 'error' && s.error !== null ? <Aviso>{s.error}</Aviso> : null}
      {estado === 'descargando' ? (
        <View style={{ gap: 6 }} accessibilityLiveRegion="polite">
          <Text style={T.cuerpo}>
            {descarga.fase === 'verificando'
              ? 'Verificando el archivo…'
              : pct === null
                ? `Descargando: ${textoMB(descarga.bytes)}`
                : `Descargando: ${String(pct)} % (${textoMB(descarga.bytes)} de ${textoMB(descarga.total)})`}
          </Text>
          <BarraProgreso
            porcentaje={descarga.fase === 'verificando' ? 100 : pct}
            etiqueta="Avance de la descarga"
          />
        </View>
      ) : null}
      {fila.error === null || estado === 'descargando' ? null : (
        <Aviso tipo="atencion">{fila.error}</Aviso>
      )}
      {acciones.length === 0 ? null : (
        <View style={{ gap: 8 }}>
          {acciones.map((a) => (
            <Boton
              key={a}
              texto={TEXTO_ACCION[a]}
              variante={a === 'borrar' ? 'secundario' : 'principal'}
              deshabilitado={
                (accionUsaRed(a) && !wifi) || (accionUsaRed(a) && descarga.id !== null)
              }
              alPresionar={() => alAccion(a)}
            />
          ))}
        </View>
      )}
    </View>
  );
};

export default function MapasSinConexion() {
  const insets = useSafeAreaInsets();
  const conectado = useApp((s) => s.conectado);
  const wifi = useApp((s) => s.wifi);
  const version = useApp((s) => s.version);
  const [filas, setFilas] = useState<FilaMapaLocal[] | null>(null);
  const [sinPaquete, setSinPaquete] = useState(false);
  const [refrescado, setRefrescado] = useState<string | null>(null);
  const [consultando, setConsultando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [errorLectura, setErrorLectura] = useState<string | false>(false);
  const [intento, setIntento] = useState(0);

  const leerLocal = useCallback(async () => {
    setFilas(await leerCatalogo());
    setRefrescado(await ultimoRefresco());
  }, []);

  // Al abrir: primero lo local (funciona sin señal); con señal, se pregunta al servidor.
  useFocusEffect(
    useCallback(() => {
      const c = { vigente: true };
      const sigue = () => c.vigente;
      void (async () => {
        try {
          setErrorLectura(false);
          const proyectos = await proyectosDelPaquete();
          if (!sigue()) return;
          setSinPaquete(proyectos.length === 0);
          await leerLocal();
          if (!conectado || proyectos.length === 0) return;
          setConsultando(true);
          try {
            await refrescarMapas();
            if (sigue()) setError(null);
          } catch (err) {
            if (sigue()) setError(mensajeDe(err));
          } finally {
            if (sigue()) setConsultando(false);
          }
          if (sigue()) await leerLocal();
        } catch (err) {
          console.warn('mapas: lectura local', err);
          if (sigue()) setErrorLectura(err instanceof Error ? err.message : String(err));
        }
      })();
      return () => {
        c.vigente = false;
      };
    }, [conectado, leerLocal, intento]),
  );

  // Cambios locales (descarga terminada, copia borrada): se relee sin volver a la red.
  useFocusEffect(
    useCallback(() => {
      void leerLocal().catch((err: unknown) => {
        console.warn('mapas: lectura local', err);
        setErrorLectura(err instanceof Error ? err.message : String(err));
      });
    }, [leerLocal, version]),
  );

  const accion = (id: string, a: AccionMapa) => {
    setAviso(null);
    void (async () => {
      try {
        if (a === 'borrar') {
          await borrarCopiaMapa(id);
          setAviso('Se borró la copia de este celular. El área sigue en el servidor.');
          return;
        }
        const r = await descargarMapa(id);
        setAviso(
          r === 'pausado'
            ? 'Se pausó la descarga porque se perdió la WiFi. Toque «Reintentar» con WiFi: seguirá desde donde quedó.'
            : 'Mapa descargado y verificado. Ya puede verlo sin señal.',
        );
      } catch (err) {
        setAviso(mensajeDe(err));
      } finally {
        await leerLocal();
      }
    })();
  };

  const encabezado = (
    <>
      <Stack.Screen options={{ title: 'Mapas sin conexión' }} />
      <BarraEstado />
    </>
  );

  if (errorLectura)
    return (
      <View style={[e.pantalla, { paddingBottom: insets.bottom }]}>
        {encabezado}
        <View style={e.contenido}>
          <Aviso>No se pudieron leer los mapas guardados en el celular.</Aviso>
          <Boton texto="Intentar de nuevo" alPresionar={() => setIntento((n) => n + 1)} />
        </View>
      </View>
    );

  if (filas === null)
    return (
      <View style={[e.pantalla, { alignItems: 'center', justifyContent: 'center', gap: 12 }]}>
        {encabezado}
        <ActivityIndicator size="large" />
        <Text style={T.cuerpo}>Leyendo los mapas del celular…</Text>
      </View>
    );

  if (sinPaquete)
    return (
      <View style={[e.pantalla, { paddingBottom: insets.bottom }]}>
        {encabezado}
        <View style={[e.contenido, { gap: 12 }]}>
          <Text style={T.titular}>Primero el paquete de campo</Text>
          <Text style={T.cuerpo}>
            Descargue el paquete de campo de su brigada desde Inicio. Después podrá descargar los
            mapas de sus áreas.
          </Text>
          <Boton variante="secundario" texto="Volver" alPresionar={() => router.back()} />
        </View>
      </View>
    );

  const ocupado = filas.reduce((n, f) => n + (f.copia?.tamano ?? 0), 0);

  return (
    <View style={[e.pantalla, { paddingBottom: insets.bottom }]}>
      {encabezado}
      <ScrollView contentContainerStyle={[e.contenido, { gap: 16 }]}>
        <Aviso tipo={wifi ? 'ok' : 'atencion'}>
          {wifi
            ? 'Conectado por WiFi: puede descargar mapas.'
            : 'Los mapas se descargan solo con WiFi (no con datos móviles). Conéctese a una red WiFi para descargar.'}
        </Aviso>
        {conectado ? null : (
          <Text style={T.suave}>
            {`Sin conexión: se muestra lo guardado en este celular.${
              refrescado === null ? '' : ` Última consulta al servidor: ${fecha(refrescado) ?? ''}.`
            }`}
          </Text>
        )}
        {consultando ? (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <ActivityIndicator />
            <Text style={T.suave}>Consultando el servidor…</Text>
          </View>
        ) : null}
        {error === null ? null : <Aviso tipo="atencion">{error}</Aviso>}
        {aviso === null ? null : <Aviso tipo="ok">{aviso}</Aviso>}

        {filas.length === 0 ? (
          <View style={[e.tarjeta, { gap: 6 }]}>
            <Text style={T.subtitulo}>Todavía no hay áreas</Text>
            <Text style={T.suave}>
              {conectado
                ? 'Coordinación prepara el área de su brigada. También puede marcar un área en el mapa.'
                : 'Conéctese para ver las áreas que preparó el servidor.'}
            </Text>
          </View>
        ) : (
          <Grupo
            titulo="Áreas"
            nota={`Ocupan ${textoMB(ocupado)} en este celular. Borrar quita solo la copia local.`}
          >
            {filas.map((f, i) => (
              <View key={f.id}>
                {i > 0 ? <Separador /> : null}
                <AreaMapa fila={f} wifi={wifi} alAccion={(a) => accion(f.id, a)} />
              </View>
            ))}
          </Grupo>
        )}

        <View style={{ gap: 8 }}>
          <Boton
            variante="secundario"
            texto="Marcar un área"
            alPresionar={() => router.push({ pathname: '/mapa', params: { seleccionar: '1' } })}
          />
          {conectado ? null : (
            <Text style={T.suave}>Para pedir un área nueva necesita conexión.</Text>
          )}
          {conectado ? (
            <Boton
              variante="secundario"
              texto="Consultar de nuevo al servidor"
              ocupado={consultando}
              alPresionar={() => setIntento((n) => n + 1)}
            />
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
