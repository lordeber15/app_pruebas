import { CONTRASENA_MAX, cumpleContrasena, REQUISITOS_CONTRASENA } from '@campo/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { AvisoError, Boton, Campo, claseEntrada } from '../componentes/Ui.tsx';

/** Marca de cada requisito: visto bueno o círculo vacío, además del texto (WCAG 1.4.1). */
const Marca = ({ ok }: { ok: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
    {ok ? (
      <>
        <circle cx="8" cy="8" r="7" fill="#2e5e4e" />
        <path d="M4.5 8.2 7 10.6 11.6 5.6" fill="none" stroke="#fff" strokeWidth="1.8" />
      </>
    ) : (
      <circle cx="8" cy="8" r="6.2" fill="none" stroke="#4a5a54" strokeWidth="1.6" />
    )}
  </svg>
);

/**
 * Cambio de la propia contraseña. En el primer ingreso (contraseña temporal) es lo único que se
 * puede hacer; después queda en el menú. La API vuelve a validar la misma política de core.
 */
export const CambiarContrasena = ({ primerIngreso }: { primerIngreso: boolean }) => {
  const qc = useQueryClient();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [ocupado, setOcupado] = useState(false);
  const [listo, setListo] = useState(false);

  const coincide = nueva !== '' && nueva === repetida;
  const valida = cumpleContrasena(nueva) && coincide && actual !== '' && nueva !== actual;

  const enviar = async (ev: React.SyntheticEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (!valida) return;
    setError(null);
    setOcupado(true);
    try {
      await api.post('/yo/contrasena', { actual, nueva });
      setActual('');
      setNueva('');
      setRepetida('');
      setListo(true);
      await qc.invalidateQueries();
    } catch (e) {
      setError(e);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="flex max-w-md flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight">
        {primerIngreso ? 'Cree su contraseña' : 'Cambiar contraseña'}
      </h1>
      <p className="text-sm text-tinta-suave">
        {primerIngreso
          ? 'Entró con una contraseña temporal. Elija una propia para continuar; la temporal deja de servir.'
          : 'Al cambiarla se cierran sus otras sesiones. Su celular vuelve a entrar solo.'}
      </p>
      {listo ? (
        <p role="status" className="rounded-md border border-liquen bg-liquen-claro p-3 text-sm">
          Su contraseña se cambió.
        </p>
      ) : null}
      <form onSubmit={(ev) => void enviar(ev)} className="flex flex-col gap-4" noValidate>
        <Campo etiqueta={primerIngreso ? 'Contraseña temporal' : 'Contraseña actual'}>
          {(id) => (
            <input
              id={id}
              type="password"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              autoComplete="current-password"
              maxLength={CONTRASENA_MAX}
              required
              className={claseEntrada}
            />
          )}
        </Campo>
        <Campo etiqueta="Contraseña nueva">
          {(id) => (
            <input
              id={id}
              type="password"
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
              autoComplete="new-password"
              maxLength={CONTRASENA_MAX}
              aria-describedby="requisitos-contrasena"
              required
              className={claseEntrada}
            />
          )}
        </Campo>
        <ul id="requisitos-contrasena" className="flex flex-col gap-1 text-sm" aria-live="polite">
          {REQUISITOS_CONTRASENA.map((r) => {
            const ok = r.cumple(nueva);
            return (
              <li key={r.clave} className="flex items-center gap-2">
                <Marca ok={ok} />
                <span className={ok ? 'text-tinta' : 'text-tinta-suave'}>
                  {r.texto}
                  <span className="sr-only">{ok ? ': cumple' : ': falta'}</span>
                </span>
              </li>
            );
          })}
        </ul>
        <Campo etiqueta="Repita la contraseña nueva">
          {(id) => (
            <input
              id={id}
              type="password"
              value={repetida}
              onChange={(e) => setRepetida(e.target.value)}
              autoComplete="new-password"
              maxLength={CONTRASENA_MAX}
              required
              className={claseEntrada}
            />
          )}
        </Campo>
        {repetida !== '' && !coincide ? (
          <p className="text-sm font-medium text-oxido">Las dos contraseñas no coinciden.</p>
        ) : null}
        {nueva !== '' && nueva === actual ? (
          <p className="text-sm font-medium text-oxido">La nueva debe ser distinta de la actual.</p>
        ) : null}
        <AvisoError error={error} />
        <Boton type="submit" ocupado={ocupado} disabled={!valida}>
          Guardar contraseña
        </Boton>
      </form>
    </div>
  );
};
