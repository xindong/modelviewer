import { rmSync } from 'node:fs'

rmSync(new URL('../dist-dts', import.meta.url), { recursive: true, force: true })
