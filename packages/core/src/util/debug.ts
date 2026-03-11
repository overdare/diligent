// @summary Debug logger: only emits output when DILIGENT_LOG env var is set

export const debug: (...args: Parameters<typeof console.log>) => void = process.env.DILIGENT_LOG
  ? (...args) => console.log(...args)
  : () => {};
