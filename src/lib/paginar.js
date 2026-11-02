// Supabase devuelve como máximo 1000 filas por consulta: con más leads, el resto quedaba afuera sin aviso
// (la Agenda no mostraba citas, el Dashboard contaba de menos). Esto trae todas las páginas.
// `armarConsulta` tiene que devolver una consulta NUEVA en cada llamada y con orden fijo (para paginar bien).
export async function traerTodos(armarConsulta, tamano = 1000) {
  const filas = []
  for (let desde = 0; ; desde += tamano) {
    const { data, error } = await armarConsulta().range(desde, desde + tamano - 1)
    if (error) return { data: filas.length ? filas : null, error }
    filas.push(...(data || []))
    if (!data || data.length < tamano) return { data: filas, error: null }
  }
}
