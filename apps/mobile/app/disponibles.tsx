import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { guardarEstadoSync } from '../src/bd.ts';
import { ErrorServidor } from '../src/sesion.ts';
import { descargar, listarDisponibles, type Disponible } from '../src/tareas.ts';
import { Aviso, BarraEstado, Boton, C, e, Texto } from '../src/ui.tsx';

/** RN-25: el usuario elige qué tareas lleva; solo esas entran al paquete. */
export default function Disponibles() {
  const insets = useSafeAreaInsets();
  const [tareas, setTareas] = useState<Disponible[] | null>(null);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    listarDisponibles()
      .then((r) => {
        setTareas(r.tareas);
        setElegidas(new Set(r.tareas.map((t) => t.id)));
      })
      .catch((err: unknown) =>
        setError(
          err instanceof ErrorServidor ? err.message : 'No se pudieron consultar las tareas.',
        ),
      );
  }, []);

  const alternar = (id: string) => {
    const s = new Set(elegidas);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setElegidas(s);
  };

  const bajar = async () => {
    setOcupado(true);
    setError(null);
    try {
      const r = await descargar([...elegidas]);
      await guardarEstadoSync('disponibles', '0');
      if (r.rechazadas > 0) setError(`${String(r.rechazadas)} tareas ya no estaban disponibles.`);
      router.back();
    } catch (err) {
      setError(err instanceof ErrorServidor ? err.message : 'No se pudo descargar.');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <View style={[e.pantalla, { paddingBottom: insets.bottom }]}>
      <BarraEstado />
      <FlatList
        data={tareas ?? []}
        keyExtractor={(t) => t.id}
        contentContainerStyle={e.contenido}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            {tareas === null && error === null ? (
              <Texto suave>Consultando sus tareas…</Texto>
            ) : null}
            {error === null ? null : <Aviso>{error}</Aviso>}
            {tareas !== null && tareas.length > 0 ? (
              <Texto suave>
                Marque las que llevará al campo. Quedarán reservadas en este celular.
              </Texto>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          tareas === null ? undefined : <Texto suave>No tiene tareas nuevas asignadas.</Texto>
        }
        renderItem={({ item }) => {
          const marcada = elegidas.has(item.id);
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: marcada }}
              onPress={() => alternar(item.id)}
              style={[
                e.tarjeta,
                {
                  flexDirection: 'row',
                  gap: 12,
                  alignItems: 'center',
                  borderColor: marcada ? C.liquen : C.linea,
                  borderWidth: marcada ? 2 : 1,
                },
              ]}
            >
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  borderWidth: 2,
                  borderColor: C.liquen,
                  backgroundColor: marcada ? C.liquen : C.hoja,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {marcada ? <Text style={{ color: '#fff', fontWeight: '900' }}>✓</Text> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 17, fontWeight: '700', color: C.tinta }}>
                  {item.titulo}
                </Text>
                <Texto suave>
                  {item.proyecto.nombre}, {item.cuaderno.titulo}
                </Texto>
              </View>
            </Pressable>
          );
        }}
        ListFooterComponent={
          tareas !== null && tareas.length > 0 ? (
            <Boton
              texto={`Descargar ${String(elegidas.size)} ${elegidas.size === 1 ? 'tarea' : 'tareas'}`}
              alPresionar={() => void bajar()}
              ocupado={ocupado}
              deshabilitado={elegidas.size === 0}
            />
          ) : undefined
        }
      />
    </View>
  );
}
