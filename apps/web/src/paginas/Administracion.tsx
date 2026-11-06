import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Usuario } from '../api.ts';
import {
  AvisoError,
  Boton,
  Campo,
  Cargando,
  claseEntrada,
  Dialogo,
  Encabezado,
  fechaHora,
  Tabla,
  td,
  th,
  Vacio,
} from '../componentes/Ui.tsx';
import { useYo } from '../sesion.ts';
import { FormularioDialogo } from './Proyectos.tsx';

const ROL: Readonly<Record<Usuario['rol_global'], string>> = {
  supervisor: 'Supervisor',
  admin: 'Administrador',
  ninguno: 'Personal de campo',
};

/** La contraseña temporal se muestra una sola vez; no queda guardada en ningún lado. */
const ContrasenaTemporal = ({
  datos,
  alCerrar,
}: {
  datos: { nombre: string; usuario: string; clave: string } | null;
  alCerrar: () => void;
}) => (
  <Dialogo abierto={datos !== null} titulo="Contraseña temporal" alCerrar={alCerrar}>
    {datos === null ? null : (
      <div className="flex flex-col gap-3 text-sm">
        <p>
          Entréguela a <strong>{datos.nombre}</strong> por un medio seguro. No se volverá a mostrar.
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border border-linea bg-papel p-3">
          <dt className="text-tinta-suave">Documento</dt>
          <dd className="font-semibold">{datos.usuario}</dd>
          <dt className="text-tinta-suave">Contraseña</dt>
          <dd className="cifras select-all text-lg font-bold tracking-wide">{datos.clave}</dd>
        </dl>
        <Boton onClick={alCerrar}>Ya la anoté</Boton>
      </div>
    )}
  </Dialogo>
);

export const Usuarios = () => {
  const yo = useYo();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['usuarios'],
    queryFn: () => api.get<{ usuarios: Usuario[] }>('/admin/usuarios'),
  });
  const [nuevo, setNuevo] = useState({
    tipo: 'DNI',
    numero: '',
    nombre: '',
    rol: 'ninguno' as Usuario['rol_global'],
  });
  const [temporal, setTemporal] = useState<{
    nombre: string;
    usuario: string;
    clave: string;
  } | null>(null);
  const invalidar = () => qc.invalidateQueries({ queryKey: ['usuarios'] });
  const cambiar = useMutation({
    mutationFn: ({ id, estado }: { id: string; estado: 'activo' | 'inactivo' }) =>
      api.patch(`/admin/usuarios/${id}`, { estado }),
    onSuccess: invalidar,
  });
  const restablecer = useMutation({
    mutationFn: (u: Usuario) =>
      api.post<{ contrasena_temporal: string }>(`/admin/usuarios/${u.id}/contrasena`),
    onSuccess: (r, u) =>
      setTemporal({
        nombre: u.nombre,
        usuario: `${u.tipo_documento} ${u.num_documento}`,
        clave: r.contrasena_temporal,
      }),
  });

  return (
    <>
      <Encabezado titulo="Usuarios">
        <FormularioDialogo
          titulo="Nuevo usuario"
          boton="Crear usuario"
          abrir="Nuevo usuario"
          alGuardar={async () => {
            const r = await api.post<{ contrasena_temporal: string }>('/admin/usuarios', {
              tipo_documento: nuevo.tipo,
              num_documento: nuevo.numero,
              nombre: nuevo.nombre,
              rol_global: nuevo.rol,
            });
            setTemporal({
              nombre: nuevo.nombre,
              usuario: `${nuevo.tipo} ${nuevo.numero}`,
              clave: r.contrasena_temporal,
            });
            setNuevo({ ...nuevo, numero: '', nombre: '' });
            await invalidar();
          }}
        >
          <div className="grid grid-cols-[8rem_1fr] gap-3">
            <Campo etiqueta="Documento">
              {(id) => (
                <select
                  id={id}
                  value={nuevo.tipo}
                  onChange={(e) => setNuevo({ ...nuevo, tipo: e.target.value })}
                  className={claseEntrada}
                >
                  <option value="DNI">DNI</option>
                  <option value="CE">CE</option>
                  <option value="PAS">Pasaporte</option>
                </select>
              )}
            </Campo>
            <Campo etiqueta="Número">
              {(id) => (
                <input
                  id={id}
                  value={nuevo.numero}
                  onChange={(e) => setNuevo({ ...nuevo, numero: e.target.value })}
                  required
                  className={claseEntrada}
                />
              )}
            </Campo>
          </div>
          <Campo etiqueta="Nombre completo">
            {(id) => (
              <input
                id={id}
                value={nuevo.nombre}
                onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
                required
                className={claseEntrada}
              />
            )}
          </Campo>
          <Campo
            etiqueta="Rol"
            ayuda="Jefes, especialistas y logísticos son personal de campo: su rol se fija al sumarlos a una cuadrilla."
          >
            {(id) => (
              <select
                id={id}
                value={nuevo.rol}
                onChange={(e) =>
                  setNuevo({ ...nuevo, rol: e.target.value as Usuario['rol_global'] })
                }
                className={claseEntrada}
              >
                <option value="ninguno">Personal de campo</option>
                <option value="supervisor">Supervisor</option>
                <option value="admin">Administrador</option>
              </select>
            )}
          </Campo>
        </FormularioDialogo>
      </Encabezado>
      {q.isPending ? <Cargando que="los usuarios" /> : null}
      <AvisoError error={q.error ?? cambiar.error ?? restablecer.error} />
      {q.data?.usuarios.length === 0 ? <Vacio titulo="Sin usuarios" /> : null}
      {q.data !== undefined && q.data.usuarios.length > 0 ? (
        <Tabla titulo="Usuarios">
          <thead>
            <tr>
              <th className={th}>Nombre</th>
              <th className={th}>Documento</th>
              <th className={th}>Rol</th>
              <th className={th}>Estado</th>
              <th className={th}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {q.data.usuarios.map((u) => (
              <tr key={u.id}>
                <td className={`${td} font-semibold`}>{u.nombre}</td>
                <td className={`${td} cifras`}>
                  {u.tipo_documento} {u.num_documento}
                </td>
                <td className={td}>{ROL[u.rol_global]}</td>
                <td className={td}>{u.estado === 'activo' ? 'Activo' : 'Inactivo'}</td>
                <td className={td}>
                  {u.id === yo.data?.id ? (
                    <span className="text-tinta-suave">Su cuenta</span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Boton variante="secundario" onClick={() => restablecer.mutate(u)}>
                        Nueva contraseña
                      </Boton>
                      <Boton
                        variante="secundario"
                        onClick={() =>
                          cambiar.mutate({
                            id: u.id,
                            estado: u.estado === 'activo' ? 'inactivo' : 'activo',
                          })
                        }
                      >
                        {u.estado === 'activo' ? 'Desactivar' : 'Activar'}
                      </Boton>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      ) : null}
      <ContrasenaTemporal datos={temporal} alCerrar={() => setTemporal(null)} />
    </>
  );
};

interface Dispositivo {
  id: string;
  plataforma: 'android' | 'ios';
  version_app: string;
  estado: 'activo' | 'baja_pendiente' | 'baja';
  ultimo_sync_en: string | null;
  creado_en: string;
  usuario_nombre: string;
}

const ESTADO_DISP: Readonly<Record<Dispositivo['estado'], string>> = {
  activo: 'Activo',
  baja_pendiente: 'Baja pendiente (se borra al conectarse)',
  baja: 'Dado de baja',
};

export const Dispositivos = () => {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['dispositivos'],
    queryFn: () => api.get<{ dispositivos: Dispositivo[] }>('/admin/dispositivos'),
  });
  const baja = useMutation({
    mutationFn: (id: string) => api.post(`/admin/dispositivos/${id}/baja`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dispositivos'] }),
  });
  return (
    <>
      <Encabezado titulo="Dispositivos" />
      <p className="-mt-3 mb-4 max-w-prose text-sm text-tinta-suave">
        Celulares activados. Al dar de baja uno, en su siguiente conexión se borran su paquete de
        campo y su sesión.
      </p>
      {q.isPending ? <Cargando que="los dispositivos" /> : null}
      <AvisoError error={q.error ?? baja.error} />
      {q.data?.dispositivos.length === 0 ? <Vacio titulo="Aún no hay celulares activados" /> : null}
      {q.data !== undefined && q.data.dispositivos.length > 0 ? (
        <Tabla titulo="Dispositivos">
          <thead>
            <tr>
              <th className={th}>Persona</th>
              <th className={th}>Celular</th>
              <th className={th}>Última sincronización</th>
              <th className={th}>Estado</th>
              <th className={th}>Acción</th>
            </tr>
          </thead>
          <tbody>
            {q.data.dispositivos.map((d) => (
              <tr key={d.id}>
                <td className={`${td} font-semibold`}>{d.usuario_nombre}</td>
                <td className={td}>
                  {d.plataforma === 'android' ? 'Android' : 'iPhone'}, versión {d.version_app}
                </td>
                <td className={`${td} cifras`}>{fechaHora(d.ultimo_sync_en)}</td>
                <td className={td}>{ESTADO_DISP[d.estado]}</td>
                <td className={td}>
                  {d.estado === 'activo' ? (
                    <Boton variante="peligro" onClick={() => baja.mutate(d.id)}>
                      Dar de baja
                    </Boton>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      ) : null}
    </>
  );
};
