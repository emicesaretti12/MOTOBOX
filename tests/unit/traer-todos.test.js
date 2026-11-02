import { describe, it, expect } from 'vitest'
import { traerTodos } from '../../src/lib/paginar.js'

describe('traerTodos', () => {
  it('pide páginas de 1000 hasta que viene una incompleta', async () => {
    const total = 2350
    const pedidos = []
    const armar = () => ({
      range: async (desde, hasta) => {
        pedidos.push([desde, hasta])
        const n = Math.max(0, Math.min(hasta, total - 1) - desde + 1)
        return { data: Array.from({ length: n }, (_, i) => desde + i), error: null }
      },
    })
    const { data, error } = await traerTodos(armar)
    expect(error).toBeNull()
    expect(data).toHaveLength(total)
    expect(pedidos).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })
})
