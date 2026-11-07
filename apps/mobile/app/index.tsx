import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { leerEstadoSync } from '../src/bd.ts';
import { useApp } from '../src/estado.ts';
import { CLAVES, llavero } from '../src/plataforma.ts';
import { sincronizar } from '../src/sync.ts';
import { abrirJornada, cerrarJornada, jornadaAbierta, misTareas } from '../src/tareas.ts';
import { Aviso, BarraEstado, Boton, C, e, Texto } from '../src/ui.tsx';

type Tarea = Awaited<ReturnType<typeof misTareas>>[number];
type Ruta = '/servidor' | '/entrar' | '/desbloquear';

/** Texto y color del estado; el texto siempre dice lo mismo que el color. */
const estadoVisible = (t: Tarea): { texto: string; color: string } => {
  if (t.revocada === 1) return { texto: 'Revocada: ya no está a su cargo', color: C.oxido };
  if (t.estado === 'validada') return { texto: 'Validada', color: C.liquenOscuro };
  if (t.estado_local === 'completada') {
    if (t.estado === 'completada') return { texto: 'Completada y recibida', color: C.liquen };
    if (t.estado === 'en_transito') return { texto: 'Completada: fotos en camino', color: C.ocre };
    return { texto: 'Completada: falta enviar', color: C.ocre };
  }
  return { texto: 'Por hacer', color: C.tinta };
};

export default function Inicio() {
  const insets = useSafeAreaInsets();
  const app = useApp();
  const [ruta, setRuta] = useState<Ruta | 'lista' | 'cargando'>('cargando');
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [jornada, setJornada] = useState<{ id: string } | null>(null);
  const [nuevas, setNuevas] = useState(0);

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
    setTareas(await misTareas());
    setJornada(await jornadaAbierta());
    setNuevas(Number((await leerEstadoSync('disponibles')) ?? '0'));
    setRuta('lista');
  }, []);

  useFocusEffect(
    useCallback(() => {
      void cargar();
    }, [cargar, app.version]),
  );

  if (ruta === 'cargando') return <View style={e.pantalla} />;
  if (ruta !== 'lista') return <Redirect href={ruta} />;

  return (
    <View style={[e.pantalla, { paddingBottom: insets.bottom }]}>
      <BarraEstado />
      <FlatList
        data={tareas}
        keyExtractor={(t) => t.id}
        contentContainerStyle={e.contenido}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            {app.ultimoError === null ? null : <Aviso tipo="atencion">{app.ultimoError}</Aviso>}
            <View
              style={[
                e.tarjeta,
                { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 17, fontWeight: '700', color: C.tinta }}>
                  {jornada === null ? 'Jornada cerrada' : 'Jornada abierta'}
                </Text>
                <Texto suave>
                  {jornada === null
                    ? 'Ábrala al empezar a trabajar.'
                    : 'Ciérrela al terminar el día.'}
                </Texto>
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
              texto={
                nuevas > 0 ? `Descargar tareas nuevas (${String(nuevas)})` : 'Buscar tareas nuevas'
              }
              variante={nuevas > 0 ? 'principal' : 'secundario'}
              alPresionar={() => router.push('/disponibles')}
              deshabilitado={!app.conectado}
            />
            {!app.conectado ? (
              <Texto suave>
                Sin conexión: puede trabajar sus tareas descargadas. Para descargar nuevas necesita
                señal.
              </Texto>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={[e.tarjeta, { alignItems: 'center', paddingVertical: 28 }]}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: C.tinta }}>
              No tiene tareas descargadas
            </Text>
            <Texto suave>Con conexión, toque Buscar tareas nuevas.</Texto>
          </View>
        }
        renderItem={({ item }) => {
          const ev = estadoVisible(item);
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/tarea/[id]', params: { id: item.id } })}
              style={({ pressed }) => [e.tarjeta, { opacity: pressed ? 0.8 : 1, minHeight: 72 }]}
            >
              <Text style={{ fontSize: 18, fontWeight: '700', color: C.tinta }}>{item.titulo}</Text>
              <Text style={{ fontSize: 15, fontWeight: '600', color: ev.color }}>{ev.texto}</Text>
              <Texto suave>
                {item.fotos} {item.fotos === 1 ? 'foto' : 'fotos'}, {item.evidencias}{' '}
                {item.evidencias === 1 ? 'punto' : 'puntos'} de evidencia
              </Texto>
            </Pressable>
          );
        }}
        refreshing={app.sincronizando}
        onRefresh={() => void sincronizar()}
      />
    </View>
  );
}
