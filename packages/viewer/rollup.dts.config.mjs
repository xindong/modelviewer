import dts from 'rollup-plugin-dts'

const external = [/^three(\/|$)/, /^fflate(\/|$)/, /^occt-import-js(\/|$)/]
const tsconfig = 'tsconfig.dts.json'

export default [
  {
    input: 'dist-dts/index.d.ts',
    output: { file: 'dist/index.d.ts', format: 'es' },
    plugins: [dts({ tsconfig })],
    external,
  },
  {
    input: 'dist-dts/core/index.d.ts',
    output: { file: 'dist/core/index.d.ts', format: 'es' },
    plugins: [dts({ tsconfig })],
    external,
  },
]
